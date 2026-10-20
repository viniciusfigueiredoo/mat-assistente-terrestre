//Tipos e Interfaces Centrais do Aplicativo MAT (Projeto DLEI 2026)

export type ObstacleKind = 'CLEAR' | 'HOLE' | 'STAIRS' | 'WALL';

export type AppScreen =
  | 'VOICE_COMMAND'       // Tela 1: Pareamento & Comando de Voz (RF08, RF13)
  | 'ROUTE_CONFIRMATION'  // Tela 2: Confirmação de Rota por Gestos (RF09, RF10, RF11)
  | 'ACTIVE_NAVIGATION';  // Tela 3: Navegação Ativa & Alertas do Terreno (RF07, RF12)

export interface MatTelemetryPayload {
  type: ObstacleKind;
  dist: number;   // Distância principal do obstáculo em cm
  front: number;  // Leitura do HC-SR04 frontal em cm
  ground: number; // Leitura do HC-SR04 inferior (solo) em cm
  bat: number;    // Nível de bateria do módulo MAT (0-100%)
  timestamp?: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteStep {
  instruction: string;  // Instrução limpa em português para leitura por voz (TTS)
  distanceText: string; // Ex.: "50 m"
  distanceMeters: number;
  durationText: string;
  maneuver?: string;    // Ex.: "turn-left", "turn-right", "straight"
  endLocation?: Coordinates;
}

export interface CalculatedRoute {
  destinationName: string;
  destinationAddress: string;
  origin: Coordinates;
  destination: Coordinates;
  totalDistanceText: string; // Ex.: "350 m"
  totalDistanceMeters: number;
  totalDurationText: string; // Ex.: "5 min"
  totalDurationSeconds: number;
  steps: RouteStep[];
  provider: 'GOOGLE_MAPS' | 'OSM_FALLBACK';
}

export interface RouteHistoryEntry {
  id: string;
  destinationName: string;
  totalDistanceText: string;
  totalDurationText: string;
  timestamp: string;
}
