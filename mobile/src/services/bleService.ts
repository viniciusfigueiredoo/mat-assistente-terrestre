import { PermissionsAndroid, Platform } from 'react-native';
import { MAT_BLE_CONFIG } from '../constants/ble';
import { MatTelemetryPayload, ObstacleKind } from '../types/mat';
import { storageService } from './storageService';

type TelemetryListener = (payload: MatTelemetryPayload) => void;
type ConnectionListener = (connected: boolean, deviceName: string, isSimulated: boolean) => void;

/**
 * Solicita permissões de Bluetooth e Localização em tempo de execução no Android 12+ (API 31+)
 */
async function requestAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  try {
    const apiLevel =
      typeof Platform.Version === 'number'
        ? Platform.Version
        : parseInt(String(Platform.Version), 10);

    if (apiLevel >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return (
        results['android.permission.BLUETOOTH_SCAN'] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        results['android.permission.BLUETOOTH_CONNECT'] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (err) {
    console.warn('[BLE] Erro ao pedir permissões Android:', err);
    return false;
  }
}

/**
 * Decodifica string base64 recebida da pilha BLE GATT nativa (`react-native-ble-plx`)
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
 * Suporta:
 * 1. Conexão Nativa (Android / iOS via `react-native-ble-plx`)
 * 2. Conexão Web Bluetooth (Navegadores Chrome, Edge e Bluefy via `navigator.bluetooth`)
 * 3. Modo Simulador de Bancada para testes visuais quando o hardware não estiver presente
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
   */
  private initNativeBleIfAvailable(): void {
    if (Platform.OS === 'web') {
      this.isSimulatedMode = true;
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BleManager } = require('react-native-ble-plx');
      this.bleManager = new BleManager();
      this.isSimulatedMode = false;
    } catch {
      console.log('[BLE] Módulo nativo BLE indisponível neste ambiente. Modo Simulador MAT ativo.');
      this.isSimulatedMode = true;
    }
  }

  /**
   * Verifica se o navegador atual suporta a Web Bluetooth API
   */
  isWebBluetoothSupported(): boolean {
    return typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
  }

  /**
   * Inicia busca e conexão automática com o ESP32 (`MAT-ESP32`) no app nativo
   */
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

  /**
   * Conecta diretamente ao ESP32 físico via Web Bluetooth (usado no GitHub Pages / Navegador)
   * Requer gesto do usuário (clique no botão de Bluetooth)
   */
  async connectWebBluetooth(): Promise<boolean> {
    if (!this.isWebBluetoothSupported()) {
      return false;
    }

    try {
      const navBle = (navigator as any).bluetooth;
      let device: any = null;

      try {
        device = await navBle.requestDevice({
          filters: [
            { name: MAT_BLE_CONFIG.DEVICE_NAME },
            { namePrefix: 'MAT' },
            { services: [MAT_BLE_CONFIG.SERVICE_UUID] },
          ],
          optionalServices: [MAT_BLE_CONFIG.SERVICE_UUID],
        });
      } catch {
        // Fallback: se o filtro estrito falhar, permite listar dispositivos próximos
        device = await navBle.requestDevice({
          acceptAllDevices: true,
          optionalServices: [MAT_BLE_CONFIG.SERVICE_UUID],
        });
      }

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(MAT_BLE_CONFIG.SERVICE_UUID);
      const characteristic = await service.getCharacteristic(MAT_BLE_CONFIG.CHAR_OBSTACLE_UUID);

      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        try {
          const value = event.target.value;
          const decoder = new TextDecoder('utf-8');
          const jsonStr = decoder.decode(value);
          const parsed = JSON.parse(jsonStr) as MatTelemetryPayload;
          if (typeof parsed.bat === 'number') {
            this.currentBattery = parsed.bat;
          }
          this.emitTelemetry({
            ...parsed,
            timestamp: Date.now(),
          });
        } catch (e) {
          console.warn('[WebBLE] Erro ao decodificar pacote do ESP32:', e);
        }
      });

      this.connectedDevice = device;
      this.isConnected = true;
      this.isSimulatedMode = false;
      this.notifyConnectionListeners();

      device.addEventListener('gattserverdisconnected', () => {
        this.isConnected = false;
        this.connectedDevice = null;
        this.isSimulatedMode = true;
        this.notifyConnectionListeners();
      });

      return true;
    } catch (err) {
      console.warn('[WebBLE] Conexão cancelada ou falhou:', err);
      return false;
    }
  }

  private async scanAndConnect(): Promise<void> {
    if (!this.bleManager || this.isConnected) return;

    const hasPermissions = await requestAndroidBlePermissions();
    if (!hasPermissions) {
      console.warn('[BLE] Permissões Bluetooth não concedidas no Android.');
      return;
    }

    const savedDeviceId = await storageService.getLastPairedEsp32Id();

    this.bleManager.startDeviceScan(
      null, // Varre sem filtro de UUID estrito no anúncio para garantir descoberta imediata
      { allowDuplicates: false },
      async (error: any, device: any) => {
        if (error) {
          console.warn('[BLE] Aviso na varredura BLE:', error.message);
          return;
        }

        const devName = (device?.name || device?.localName || '').trim();
        const isMatDevice =
          devName === MAT_BLE_CONFIG.DEVICE_NAME ||
          devName.includes('MAT-ESP32') ||
          (Array.isArray(device?.serviceUUIDs) &&
            device.serviceUUIDs.some((uuid: string) =>
              uuid.toLowerCase().includes('4fafc201')
            )) ||
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

  isSimulated(): boolean {
    return this.isSimulatedMode;
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
