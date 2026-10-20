import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteHistoryEntry } from '../types/mat';

const KEYS = {
  LAST_PAIRED_ESP32_ID: '@mat_dlei2026:last_esp32_id',
  ROUTE_HISTORY: '@mat_dlei2026:route_history',
};

// Serviço de Armazenamento Local (Sem necessidade de login/cadastro)
// Salva o último módulo ESP32 conectado (RF13) e histórico de rotas
export const storageService = {
  // Salva o ID/MAC do último módulo MAT (ESP32) pareado para reconexão automática (RF13)
  async saveLastPairedEsp32Id(deviceId: string): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS.LAST_PAIRED_ESP32_ID, deviceId);
    } catch (error) {
      console.warn('[Storage] Erro ao salvar ID do ESP32:', error);
    }
  },

  async getLastPairedEsp32Id(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(KEYS.LAST_PAIRED_ESP32_ID);
    } catch {
      return null;
    }
  },

  // Registra uma rota confirmada no histórico local do aparelho
  async addRouteHistory(entry: Omit<RouteHistoryEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.ROUTE_HISTORY);
      const list: RouteHistoryEntry[] = raw ? JSON.parse(raw) : [];
      const newEntry: RouteHistoryEntry = {
        ...entry,
        id: String(Date.now()),
        timestamp: new Date().toLocaleString('pt-BR'),
      };
      const updated = [newEntry, ...list].slice(0, 20);
      await AsyncStorage.setItem(KEYS.ROUTE_HISTORY, JSON.stringify(updated));
    } catch (error) {
      console.warn('[Storage] Erro ao salvar histórico de rota:', error);
    }
  },

  async getRouteHistory(): Promise<RouteHistoryEntry[]> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.ROUTE_HISTORY);
      return raw ? (JSON.parse(raw) as RouteHistoryEntry[]) : [];
    } catch {
      return [];
    }
  },
};
