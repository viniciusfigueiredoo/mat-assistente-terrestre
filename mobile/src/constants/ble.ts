import { ObstacleKind } from '../types/mat';

// Constantes BLE GATT sincronizadas com firmware-esp32/mat_firmware/mat_firmware.ino
export const MAT_BLE_CONFIG = {
  DEVICE_NAME: 'MAT-ESP32',
  SERVICE_UUID: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
  CHAR_OBSTACLE_UUID: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
  CHAR_BATTERY_UUID: 'beb5483e-36e1-4688-b7f5-ea07361b26a9',
  RECONNECT_INTERVAL_MS: 4000,
};

// Mensagens e paleta de alto contraste para cada tipo de obstáculo (RF07, RF12)
export const OBSTACLE_METADATA: Record<
  ObstacleKind,
  {
    title: string;
    shortDescription: string;
    ttsAlert: (distMeters: string) => string;
    badgeColor: string;
    backgroundColor: string;
    borderColor: string;
    textColor: string;
  }
> = {
  CLEAR: {
    title: 'Caminho Livre',
    shortDescription: 'Nenhum obstáculo detectado à frente.',
    ttsAlert: () => 'Caminho livre.',
    badgeColor: '#10B981',
    backgroundColor: '#064E3B',
    borderColor: '#10B981',
    textColor: '#ECFDF5',
  },
  HOLE: {
    title: 'Desnível / Buraco',
    shortDescription: 'Desnível ou buraco detectado no solo à frente!',
    ttsAlert: (distMeters) =>
      `Atenção! Desnível ou buraco a ${distMeters} metros à frente.`,
    badgeColor: '#F43F5E',
    backgroundColor: '#4C0519',
    borderColor: '#FB7185',
    textColor: '#FFE4E6',
  },
  STAIRS: {
    title: 'Desnível / Buraco',
    shortDescription: 'Desnível no solo detectado.',
    ttsAlert: (distMeters) =>
      `Atenção! Desnível ou buraco a ${distMeters} metros à frente.`,
    badgeColor: '#F43F5E',
    backgroundColor: '#4C0519',
    borderColor: '#FB7185',
    textColor: '#FFE4E6',
  },
  WALL: {
    title: 'Parede / Obstáculo',
    shortDescription: 'Parede ou obstáculo frontal detectado.',
    ttsAlert: (distMeters) =>
      `Cuidado! Parede ou obstáculo a ${distMeters} metros à frente.`,
    badgeColor: '#EF4444',
    backgroundColor: '#450A0A',
    borderColor: '#F87171',
    textColor: '#FEE2E2',
  },
};
