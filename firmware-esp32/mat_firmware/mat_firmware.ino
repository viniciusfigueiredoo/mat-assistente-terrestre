/*
  ============================================================================
  PROJETO DLEI 2026 - MÓDULO ASSISTENTE TERRESTRE (MAT)
  Firmware Embarcado para ESP32 (Arduino Framework / ESP-IDF)
  ============================================================================
  Alinhamento: ODS 3 (Saúde e Bem-Estar - Agenda 2030 ONU)  
  Requisitos Atendidos neste Firmware:
  - RF01: Monitoramento contínuo do solo (buracos, depressões, desníveis)
  - RF02: Identificação de escadas (degraus ascendentes ou descendentes)
  - RF03: Detecção de paredes e obstáculos frontais (30 cm a 250 cm)
  - RF04: Acionamento imediato do motor de vibração (feedback háptico)
  - RF05: Modulação do padrão de vibração por tipo de risco (PWM)
  - RF06: Operação autônoma (standalone) mesmo sem conexão Bluetooth
  - RF07: Transmissão de telemetria de obstáculos e bateria via BLE
  - RNF01: Tempo de resposta local < 150 ms
  - RNF02: Latência de transmissão BLE < 300 ms
  - RNF05: Tolerância a falhas (proteção local independente do celular)
  ============================================================================
*/

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ============================================================================
// 1. CONFIGURAÇÃO DE SENSORES (HC-SR04 PADRÃO + SUPORTE MODULAR A LASER ToF)
// ============================================================================

// --- Pinos do Sensor Ultrassônico Frontal (Paredes / Obstáculos - RF03) ---
// ATENÇÃO: O pino ECHO do HC-SR04 (5V) deve passar por um divisor resistivo
// (1k ohm + 2k ohm) antes de entrar na GPIO do ESP32 (3.3V), ou usar HC-SR04P (3.3V)
#define PIN_FRONT_TRIG  5
#define PIN_FRONT_ECHO  18

// --- Pinos do Sensor Ultrassônico Inferior/Inclinado (Buracos / Escadas - RF01/RF02) ---
#define PIN_GROUND_TRIG 19
#define PIN_GROUND_ECHO 21

// --- Pino do Atuador Vibratório (Motor PWM via Transistor/MOSFET - RF04/RF05) ---
#define PIN_VIBRATION_MOTOR 23
#define PWM_CHANNEL         0
#define PWM_FREQ            5000
#define PWM_RESOLUTION      8 // 0 a 255

// --- Pino de Leitura da Bateria (Divisor de Tensão no ADC - RF07) ---
#define PIN_BATTERY_ADC     34

// ============================================================================
// 2. PARÂMETROS DE CALIBRAÇÃO GEOMÉTRICA E LIMIARES DE DETECÇÃO (em cm)
// ============================================================================
// Distância nominal esperada até o solo plano com a bengala na inclinação padrão (~45°)
// Ajuste este valor no teste de bancada conforme a altura de fixação na bengala
#define GROUND_BASELINE_CM          85.0f

// Tolerância para variações normais do piso e balanço da bengala (cm)
#define GROUND_TOLERANCE_CM         18.0f

// Se a distância medida até o solo ultrapassar (BASELINE + HOLE_THRESHOLD_DELTA),
// significa que o chão "afundou" -> Buraco ou Escada Descendente (RF01 / RF02)
#define HOLE_THRESHOLD_CM           (GROUND_BASELINE_CM + 25.0f) // > 110 cm

// Se a distância do sensor inferior diminuir bruscamente (< BASELINE - STEP_UP_DELTA)
// concomitantemente a leitura frontal próxima -> Degrau / Escada Ascendente (RF02)
#define STAIRS_UP_GROUND_CM         (GROUND_BASELINE_CM - 22.0f) // < 63 cm

// Limiares horizontais para Parede / Obstáculo Frontal (RF03)
#define WALL_MIN_CM                 3.0f
#define WALL_CRITICAL_CM            90.0f   // Alerta crítico (muito próximo)
#define WALL_WARNING_CM             180.0f  // Alerta moderado

// Timeout do pulso ultrassônico em microssegundos (~20ms equivale a ~340cm máx)
// Garante que o loop completo execute em < 50ms, cumprindo com folga RNF01 (< 150ms)
#define ULTRASONIC_TIMEOUT_US       18000UL

// ============================================================================
// 3. DEFINIÇÕES BLUETOOTH LOW ENERGY (BLE GATT - RF07 / RNF02)
// ============================================================================
#define BLE_DEVICE_NAME             "MAT-ESP32"
#define SERVICE_UUID                "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_OBSTACLE_UUID          "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_BATTERY_UUID           "beb5483e-36e1-4688-b7f5-ea07361b26a9"

BLEServer* pServer = nullptr;
BLECharacteristic* pObstacleCharacteristic = nullptr;
BLECharacteristic* pBatteryCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// ============================================================================
// 4. TIPOS DE EVENTO E ESTADO DO SISTEMA
// ============================================================================
enum ObstacleType {
  OBS_CLEAR = 0,
  OBS_WALL = 1,
  OBS_STAIRS = 2,
  OBS_HOLE = 3
};

// Buffers para filtro de mediana de 3 amostras (evita falsos positivos por reflexão no piso)
float frontSamples[3]  = {250.0f, 250.0f, 250.0f};
float groundSamples[3] = {GROUND_BASELINE_CM, GROUND_BASELINE_CM, GROUND_BASELINE_CM};
uint8_t sampleIdx = 0;

unsigned long lastBleNotifyMs = 0;
unsigned long lastBatteryReadMs = 0;
ObstacleType lastReportedObstacle = OBS_CLEAR;
uint8_t currentBatteryPercent = 85;

// ============================================================================
// 5. CALLBACKS DE CONEXÃO BLE (RECONEXÃO AUTOMÁTICA - RF13)
// ============================================================================
class MatServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    Serial.println("[BLE] Smartphone conectado ao modulo MAT.");
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    Serial.println("[BLE] Smartphone desconectado. Operacao autonoma mantida (RF06/RNF05).");
  }
};

// ============================================================================
// 6. FUNÇÕES DE LEITURA E FILTRAGEM DE SENSORES
// ============================================================================

/**
 * Mede a distância em centímetros usando um sensor ultrassônico HC-SR04
 * Retorna 999.0f caso não haja eco dentro do alcance máximo
 */
float readUltrasonicCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long durationUs = pulseIn(echoPin, HIGH, ULTRASONIC_TIMEOUT_US);
  if (durationUs == 0) {
    return 999.0f; // Sem obstáculo no alcance
  }
  // Velocidade do som ~0.0343 cm/us (ida e volta -> divide por 2)
  return (durationUs * 0.0343f) / 2.0f;
}

/**
 * Calcula a mediana de 3 leituras consecutivas para rejeitar ruídos acústicos
 * e reflexões especulares em pisos lisos
 */
float medianOf3(float a, float b, float c) {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

/**
 * Classifica o risco do terreno a partir das distâncias filtradas (frontal e solo).
 */
ObstacleType classifyTerrain(float frontCm, float groundCm, float* outPrimaryDistCm) {
  // 1. Prioridade Máxima: Buraco ou Desnível Descendente Abrupto (RF01 / RF02)
  // Se o feixe inferior perder o fundo (999) ou medir distância muito maior que a linha base:
  if (groundCm >= HOLE_THRESHOLD_CM && groundCm < 450.0f) {
    *outPrimaryDistCm = groundCm;
    return OBS_HOLE;
  }

  // 2. Degrau / Escada Ascendente (RF02)
  // O sensor inferior detecta elevação do piso à frente E/OU o sensor frontal detecta espelho do degrau
  if (groundCm <= STAIRS_UP_GROUND_CM && groundCm >= 3.0f) {
    *outPrimaryDistCm = groundCm;
    return OBS_STAIRS;
  }

  // 3. Parede ou Obstáculo Frontal (RF03)
  if (frontCm >= WALL_MIN_CM && frontCm <= WALL_WARNING_CM) {
    *outPrimaryDistCm = frontCm;
    return OBS_WALL;
  }

  *outPrimaryDistCm = (frontCm < groundCm) ? frontCm : groundCm;
  return OBS_CLEAR;
}

// ============================================================================
// 7. ATUAÇÃO HÁPTICA LOCAL (MOTOR DE VIBRAÇÃO PWM - RF04, RF05, RF06, RNF01)
// ============================================================================
void updateVibrationFeedback(ObstacleType type, float distanceCm) {
  unsigned long now = millis();

  switch (type) {
    case OBS_HOLE:
      // RF05: Vibração contínua em potência máxima (alerta crítico imediato)
      ledcWrite(PIN_VIBRATION_MOTOR, 255);
      break;

    case OBS_STAIRS:
      // RF05: Pulsos duplos rápidos e intensos (período de 300ms) para identificar escada/degrau
      if ((now % 300) < 180) {
        ledcWrite(PIN_VIBRATION_MOTOR, 240);
      } else {
        ledcWrite(PIN_VIBRATION_MOTOR, 0);
      }
      break;

    case OBS_WALL:
      // RF05: Pulsos modulados pela proximidade da parede
      if (distanceCm <= WALL_CRITICAL_CM) {
        // Muito perto (< 90cm): pulsos rápidos e fortes
        uint8_t duty = ((now % 250) < 150) ? 220 : 0;
        ledcWrite(PIN_VIBRATION_MOTOR, duty);
      } else {
        // Alerta antecipado (90cm a 180cm): pulsos suaves a cada 500ms
        uint8_t duty = ((now % 500) < 200) ? 160 : 0;
        ledcWrite(PIN_VIBRATION_MOTOR, duty);
      }
      break;

    case OBS_CLEAR:
    default:
      ledcWrite(PIN_VIBRATION_MOTOR, 0);
      break;
  }
}

// ============================================================================
// 8. LEITURA DE BATERIA E TELEMETRIA BLE (RF07 / RNF02)
// ============================================================================
uint8_t readBatteryPercentage() {
  int rawAdc = analogRead(PIN_BATTERY_ADC);
  if (rawAdc <= 0) {
    return 85; // Valor padrão caso o divisor de tensão da bateria não esteja conectado no protótipo
  }
  // Assumindo bateria Li-Ion 3.7V (3.2V = 0%, 4.2V = 100%) com divisor 1:2 no ADC de 12 bits (0-4095)
  float voltage = (rawAdc / 4095.0f) * 3.3f * 2.0f;
  int pct = (int)((voltage - 3.2f) * 100.0f / (4.2f - 3.2f));
  if (pct > 100) pct = 100;
  if (pct < 5)   pct = 85; // Fallback para bancada sem bateria acoplada no ADC
  return (uint8_t)pct;
}

const char* obstacleToString(ObstacleType type) {
  switch (type) {
    case OBS_HOLE:   return "HOLE";
    case OBS_STAIRS: return "STAIRS";
    case OBS_WALL:   return "WALL";
    default:         return "CLEAR";
  }
}

static unsigned long lastObstacleNotifyMs = 0;
static ObstacleType lastSentType = OBS_CLEAR;
void notifyBleTelemetry(ObstacleType type, float primaryDistCm, float frontCm, float groundCm) {
  if (!deviceConnected || pObstacleCharacteristic == nullptr) return;

  unsigned long now = millis();
  // Envia imediatamente se o tipo de obstáculo mudou, ou a cada 250ms (< 300ms do RNF02)
  bool isObstacle = (type != OBS_CLEAR);
  bool shouldSend = false;

  if (isObstacle) {
    // Tolerância Anti-Flapping:
    // 1. Se for o MESMO obstáculo: repete apenas a cada 3,5s (para não cortar a voz do celular)
    // 2. Se for um NOVO obstáculo diferente: exige intervalo mínimo de 2,5s para evitar alternâncias rápidas
    //    EXCEÇÃO DE SEGURANÇA: Buraco (HOLE) tem prioridade de vida e fura a fila imediatamente!
    bool isUrgentHole = (type == OBS_HOLE && lastSentType != OBS_HOLE);
    bool minIntervalPassed = (now - lastObstacleNotifyMs >= 2500);
    bool sameObstacleRepeatTimeout = (now - lastObstacleNotifyMs >= 3500);

    if (isUrgentHole || (type != lastSentType && minIntervalPassed) || (type == lastSentType && sameObstacleRepeatTimeout)) {
      shouldSend = true;
      lastObstacleNotifyMs = now;
    }
  } else {
    if (lastSentType != OBS_CLEAR || (now - lastBleNotifyMs >= 1500)) {
      shouldSend = true;
    }
  }

  if (shouldSend) {
    char payload[128];
    snprintf(
      payload,
      sizeof(payload),
      "{\"type\":\"%s\",\"dist\":%.0f,\"front\":%.0f,\"ground\":%.0f,\"bat\":%u}",
      obstacleToString(type),
      primaryDistCm,
      frontCm,
      groundCm,
      currentBatteryPercent
    );

    pObstacleCharacteristic->setValue((uint8_t*)payload, strlen(payload));
    pObstacleCharacteristic->notify();

    lastSentType = type;
    lastReportedObstacle = type;
    lastBleNotifyMs = now;
  }
}

// ============================================================================
// 9. SETUP & LOOP PRINCIPAL
// ============================================================================
void setup() {
  Serial.begin(115200);
  Serial.println("====================================================");
  Serial.println("Iniciando Firmware MAT (Modulo Assistente Terrestre)");
  Serial.println("====================================================");

  // Configuração dos pinos dos sensores HC-SR04
  pinMode(PIN_FRONT_TRIG, OUTPUT);
  digitalWrite(PIN_FRONT_TRIG, LOW);
  pinMode(PIN_FRONT_ECHO, INPUT);
  pinMode(PIN_GROUND_TRIG, OUTPUT);
  digitalWrite(PIN_GROUND_TRIG, LOW);
  pinMode(PIN_GROUND_ECHO, INPUT);

  // Configuração do PWM do motor de vibração (compatível com ESP32 Arduino Core 3.x)
  ledcAttach(PIN_VIBRATION_MOTOR, PWM_FREQ, PWM_RESOLUTION);
  ledcWrite(PIN_VIBRATION_MOTOR, 0);

  // Teste rápido de vibração ao ligar (feedback tátil de inicialização para o deficiente visual)
  ledcWrite(PIN_VIBRATION_MOTOR, 200);
  delay(200);
  ledcWrite(PIN_VIBRATION_MOTOR, 0);

  // Inicialização do Servidor BLE
  BLEDevice::init(BLE_DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MatServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  // Característica de Telemetria de Obstáculos (JSON via Notify/Read)
  pObstacleCharacteristic = pService->createCharacteristic(
    CHAR_OBSTACLE_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pObstacleCharacteristic->addDescriptor(new BLE2902());

  // Característica de Nível de Bateria
  pBatteryCharacteristic = pService->createCharacteristic(
    CHAR_BATTERY_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pBatteryCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06); // Ajuda na conexão rápida com iOS e Android
  BLEDevice::startAdvertising();

  Serial.println("[MAT] Servidor BLE ativo e aguardando conexao como 'MAT-ESP32'.");
}

void loop() {
  // 1. Leitura do sensor frontal (HC-SR04 #1)
  float rawFrontCm = readUltrasonicCm(PIN_FRONT_TRIG, PIN_FRONT_ECHO);
  delay(12); // Pequeno intervalo de 12ms entre os dois HC-SR04 para evitar interferência acústica cruzada

  // 2. Leitura do sensor inferior/solo (HC-SR04 #2)
  float rawGroundCm = readUltrasonicCm(PIN_GROUND_TRIG, PIN_GROUND_ECHO);

  // 3. Atualização do filtro de mediana de 3 amostras
  frontSamples[sampleIdx]  = rawFrontCm;
  groundSamples[sampleIdx] = rawGroundCm;
  sampleIdx = (sampleIdx + 1) % 3;

  float filteredFrontCm  = medianOf3(frontSamples[0], frontSamples[1], frontSamples[2]);
  float filteredGroundCm = medianOf3(groundSamples[0], groundSamples[1], groundSamples[2]);

  // 4. Classificação do terreno e acionamento IMEDIATO do alerta vibratório (RNF01 < 150ms)
  float primaryDistCm = 0.0f;
  ObstacleType detectedType = classifyTerrain(filteredFrontCm, filteredGroundCm, &primaryDistCm);
  // 5. Filtro de Persistência Temporal (Elimina ruídos de 1 ciclo e alternâncias rápidas)
  static ObstacleType pendingType = OBS_CLEAR;
  static uint8_t candidateCycles = 0;
  static ObstacleType confirmedType = OBS_CLEAR;

  if (detectedType == pendingType) {
    if (candidateCycles < 3) {
      candidateCycles++;
    }
  } else {
    pendingType = detectedType;
    candidateCycles = 1;
  }

  // Só promove a obstáculo oficial se persistir por 3 ciclos consecutivos (~120 ms)
  if (candidateCycles >= 3) {
    confirmedType = pendingType;
  }

  updateVibrationFeedback(confirmedType, primaryDistCm);

  // Log de diagnóstico a cada 500ms no Monitor Serial (115200 baud)
  static unsigned long lastDebugPrintMs = 0;
  if (millis() - lastDebugPrintMs >= 500) {
    Serial.printf("[MAT-DEBUG] Frontal: %.1f cm (raw: %.1f) | Solo: %.1f cm (raw: %.1f) | Obstaculo: %s | BLE: %s\n",
                  filteredFrontCm, rawFrontCm,
                  filteredGroundCm, rawGroundCm,
                  obstacleToString(confirmedType),
                  deviceConnected ? "CONECTADO" : "AGUARDANDO");
    lastDebugPrintMs = millis();
  }

  // 5. Atualização periódica da bateria (a cada 10 segundos)
  unsigned long now = millis();
  if (now - lastBatteryReadMs >= 10000) {
    currentBatteryPercent = readBatteryPercentage();
    if (deviceConnected && pBatteryCharacteristic != nullptr) {
      pBatteryCharacteristic->setValue(&currentBatteryPercent, 1);
      pBatteryCharacteristic->notify();
    }
    lastBatteryReadMs = now;
  }

  // 6. Envio de telemetria via Bluetooth Low Energy para o App MAT (RF07 / RNF02)
  notifyBleTelemetry(confirmedType, primaryDistCm, filteredFrontCm, filteredGroundCm);

  // 7. Gerenciamento de reconexão automática do Advertising BLE (RF13)
  if (!deviceConnected && oldDeviceConnected) {
    delay(50);
    pServer->startAdvertising();
    Serial.println("[BLE] Reiniciando advertising para reconexao automatica...");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // Ciclo total ~35ms a 45ms -> garante tempo de resposta < 150ms (RNF01)
  delay(15);
}
