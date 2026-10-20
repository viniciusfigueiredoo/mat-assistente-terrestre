import { Platform } from 'react-native';
import { MAT_BLE_CONFIG } from '../constants/ble';
import { MatTelemetryPayload, ObstacleKind } from '../types/mat';
import { storageService } from './storageService';

type TelemetryListener = (payload: MatTelemetryPayload) => void;
type ConnectionListener = (connected: boolean, deviceName: string, isSimulated: boolean) => void;

/**
 * Decodifica string x64 recebida da pilha BLE GATT nativa (`react-native-ble-plx`)
 * para não depender de bibliotecas externas mais pesadas
 */ 
function decodeBase64(b64: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = '';
  let i = 0;
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  while (i < clean.length) {
    const enc1 = chars.indexOf(clean.charAt(i++));
    const enc2 = chars.indexOf(clean.charAt(i++));
    const enc3 = chars.indexOf(clean.charAt(i++));
    const enc4 = chars.indexOf(clean.charAt(i++));

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    str += String.fromCharCode(chr1);
    if (enc3 !== 64) str += String.fromCharCode(chr2);
    if (enc4 !== 64) str += String.fromCharCode(chr3);
  }
  return str;
}

/**
 * Serviço de Comunicação Bluetooth Low Energy (BLE) com o ESP32 do Módulo MAT
 * Atende RF07 e RF13
 * Inclui também suporte a Simulação de Bancada quando o ESP32 físico não está presente
 */
class MatBleService {
  private bleManager: any = null;
  private connectedDevice: any = null;
  private isConnected = false;
  private isSimulatedMode = true;
  private currentBattery = 85;
  private telemetryListeners: Set<TelemetryListener> = new Set();
  private connectionListeners: Set<ConnectionListener> = new Set();
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.initNativeBleIfAvailable();
  }

  /**
   * Inicializa `react-native-ble-plx` apenas em builds nativos Android/iOS
   * No navegador Web ou Expo Go sem módulo nativo, ativa o Modo Simulador transparente
   */
  private initNativeBleIfAvailable(): void {
    if (Platform.OS === 'web') {
      this.isSimulatedMode = true;
      return;
    }
    try {
      // Importação dinâmica com segurança para evitar crash caso aberto no Expo Go padrão
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BleManager } = require('react-native-ble-plx');
      this.bleManager = new BleManager();
      this.isSimulatedMode = false;
    } catch {
      console.log('[BLE] Módulo nativo BLE indisponível neste ambiente. Modo Simulador MAT ativo.');
      this.isSimulatedMode = true;
    }
  }

  
  // Inicia busca e conexão automática com o ESP32 (`MAT-ESP32`) (RF13)
  
  async startAutoConnect(): Promise<void> {
    if (this.isSimulatedMode || !this.bleManager) {
      this.isConnected = true;
      this.notifyConnectionListeners();
      return;
    }

    this.scanAndConnect();

    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = setInterval(() => {
      if (!this.isConnected && !this.isSimulatedMode) {
        this.scanAndConnect();
      }
    }, MAT_BLE_CONFIG.RECONNECT_INTERVAL_MS);
  }

  private async scanAndConnect(): Promise<void> {
    if (!this.bleManager || this.isConnected) return;

    const savedDeviceId = await storageService.getLastPairedEsp32Id();

    this.bleManager.startDeviceScan(
      [MAT_BLE_CONFIG.SERVICE_UUID],
      { allowDuplicates: false },
      async (error: any, device: any) => {
        if (error) {
          console.warn('[BLE] Aviso na varredura BLE:', error.message);
          return;
        }

        const isMatDevice =
          device?.name === MAT_BLE_CONFIG.DEVICE_NAME ||
          device?.localName === MAT_BLE_CONFIG.DEVICE_NAME ||
          (savedDeviceId && device?.id === savedDeviceId);

        if (isMatDevice) {
          this.bleManager.stopDeviceScan();
          await this.connectToEsp32(device);
        }
      }
    );
  }

  private async connectToEsp32(device: any): Promise<void> {
    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      this.connectedDevice = connected;
      this.isConnected = true;
      this.isSimulatedMode = false;

      await storageService.saveLastPairedEsp32Id(connected.id);
      this.notifyConnectionListeners();

      connected.onDisconnected(() => {
        this.isConnected = false;
        this.connectedDevice = null;
        this.notifyConnectionListeners();
      });

      // Assina notificações em tempo real da Característica de Obstáculos (RF07 / RNF02)
      connected.monitorCharacteristicForService(
        MAT_BLE_CONFIG.SERVICE_UUID,
        MAT_BLE_CONFIG.CHAR_OBSTACLE_UUID,
        (err: any, characteristic: any) => {
          if (err || !characteristic?.value) return;
          try {
            const jsonStr = decodeBase64(characteristic.value);
            const parsed = JSON.parse(jsonStr) as MatTelemetryPayload;
            if (typeof parsed.bat === 'number') {
              this.currentBattery = parsed.bat;
            }
            this.emitTelemetry({
              ...parsed,
              timestamp: Date.now(),
            });
          } catch (parseErr) {
            console.warn('[BLE] Erro ao decodificar pacote do ESP32:', parseErr);
          }
        }
      );
    } catch (err) {
      console.warn('[BLE] Falha ao conectar ao ESP32:', err);
      this.isConnected = false;
      this.notifyConnectionListeners();
    }
  }

  /**
   * Permite simular o envio de um pacote BLE vindo do ESP32 (Buraco, Escada, Parede ou Livre)
   * para testes e validação da interface e voz sem precisar do hardware físico ligado
   */
  simulateEsp32Obstacle(type: ObstacleKind, distCm = 150): void {
    const payload: MatTelemetryPayload = {
      type,
      dist: distCm,
      front: type === 'WALL' ? distCm : 240,
      ground: type === 'HOLE' ? 135 : type === 'STAIRS' ? 55 : 85,
      bat: this.currentBattery,
      timestamp: Date.now(),
    };
    this.emitTelemetry(payload);
  }

  onTelemetry(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(
      this.isConnected,
      MAT_BLE_CONFIG.DEVICE_NAME,
      this.isSimulatedMode
    );
    return () => this.connectionListeners.delete(listener);
  }

  getBatteryLevel(): number {
    return this.currentBattery;
  }

  private emitTelemetry(payload: MatTelemetryPayload): void {
    this.telemetryListeners.forEach((cb) => cb(payload));
  }

  private notifyConnectionListeners(): void {
    this.connectionListeners.forEach((cb) =>
      cb(this.isConnected, MAT_BLE_CONFIG.DEVICE_NAME, this.isSimulatedMode)
    );
  }
}

export const bleService = new MatBleService();
