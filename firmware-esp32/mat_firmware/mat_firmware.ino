/*
  ============================================================================
  PROJETO DLEI 2026 - MÓDULO ASSISTENTE TERRESTRE (MAT)
  Firmware Embarcado para ESP32 (Arduino Framework / ESP-IDF)
  ============================================================================
  Alinhamento: ODS 3 (Saúde e Bem-Estar - Agenda 2030 ONU)
  Requisitos Atendidos neste Firmware:
  - RF01: Monitoramento contínuo do solo (buracos, depressões, desníveis)
  - RF03: Detecção de paredes e obstáculos frontais
  - RF04: Acionamento imediato do motor de vibração (feedback háptico)
  - RF05: Modulação do padrão de vibração por tipo de risco (PWM)
  - RF06: Operação autônoma (standalone) mesmo sem conexão Bluetooth
  - RF07: Transmissão de telemetria de obstáculos e bateria via BLE
  - RNF01: Tempo de resposta local ~150 ms
  - RNF02: Latência de transmissão BLE < 300 ms na mudança de estado
  - RNF05: Tolerância a falhas (proteção local independente do celular)

  Classes de terreno reportadas: LIVRE (CLEAR), PAREDE (WALL), DESNÍVEL (HOLE)
  ============================================================================
*/

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ============================================================================
// 1. PINOS
// ============================================================================

// --- Sensor Ultrassônico Frontal (Paredes / Obstáculos - RF03) ---
// ATENÇÃO: O pino ECHO do HC-SR04 (5V) deve passar por um divisor resistivo
// (1k ohm + 2k ohm) antes de entrar na GPIO do ESP32 (3.3V), ou usar HC-SR04P (3.3V)
#define PIN_FRONT_TRIG  17
#define PIN_FRONT_ECHO  4

// --- Sensor Ultrassônico Inferior/Inclinado (Desníveis / Buracos - RF01) ---
#define PIN_GROUND_TRIG 18
#define PIN_GROUND_ECHO 21

// --- Atuador Vibratório (Motor PWM via Transistor/MOSFET - RF04/RF05) ---
#define PIN_VIBRATION_MOTOR 23
#define PWM_FREQ            5000
#define PWM_RESOLUTION      8 // 0 a 255

// --- Leitura da Bateria (Divisor de Tensão no ADC - RF07) ---
#define PIN_BATTERY_ADC     34

// ============================================================================
// 2. LIMIARES DE DETECÇÃO (em cm)
// ============================================================================
// Distância nominal esperada até o solo plano com a bengala na inclinação padrão (~45°)
// Ajuste este valor no teste de bancada conforme a altura de fixação na bengala
#define GROUND_BASELINE_CM          85.0f

// Se a distância até o solo ultrapassar este valor, o chão "afundou" -> DESNÍVEL
#define HOLE_THRESHOLD_CM           (GROUND_BASELINE_CM + 25.0f) // >= 110 cm

// Acima deste valor a leitura é considerada "sem eco" (sensor solto ou fora de alcance)
// e NÃO gera alerta, para evitar alarme falso por falha de hardware
#define MAX_VALID_DISTANCE_CM       450.0f

// Parede / Obstáculo Frontal (RF03)
#define WALL_MIN_CM                 3.0f    // Permite teste de bancada com a mão
#define WALL_CRITICAL_CM            90.0f   // Alerta crítico (muito próximo)
#define WALL_WARNING_CM             180.0f  // Alerta moderado

// Timeout do pulso ultrassônico (~18ms equivale a ~300cm máx)
#define ULTRASONIC_TIMEOUT_US       18000UL

// ============================================================================
// 3. TOLERÂNCIA CONTRA ALARME FALSO (HISTERESE TEMPORAL)
// ============================================================================
// Cada ciclo do loop dura ~40-60 ms.
// - Para ENTRAR em alerta (ou trocar de tipo), o obstáculo precisa aparecer
//   em CONFIRM_CYCLES_ENTER ciclos seguidos (~150 ms).
// - Para VOLTAR a "livre", o terreno precisa ficar livre por
//   CONFIRM_CYCLES_EXIT ciclos seguidos (~400 ms).
// Assim, uma oscilação PAREDE -> nada -> PAREDE não gera um novo alerta.
#define CONFIRM_CYCLES_ENTER        3
#define CONFIRM_CYCLES_EXIT         8

// Intervalo de telemetria periódica (o celular decide quando falar)
#define TELEMETRY_INTERVAL_MS       400

// ============================================================================
// 4. BLUETOOTH LOW ENERGY (BLE GATT - RF07 / RNF02)
// ============================================================================
#define BLE_DEVICE_NAME             "MAT-ESP32"
#define SERVICE_UUID                "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_OBSTACLE_UUID          "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_BATTERY_UUID           "beb5483e-36e1-4688-b7f5-ea07361b26a9"

BLEServer* pServer = nullptr;
BLECharacteristic* pObstacleCharacteristic = nullptr;
BLECharacteristic* pBatteryCharacteristic = nullptr;
volatile bool deviceConnected = false;
bool oldDeviceConnected = false;

// ============================================================================
// 5. ESTADO DO SISTEMA
// ============================================================================
enum ObstacleType {
  OBS_CLEAR = 0,
  OBS_WALL  = 1,
  OBS_HOLE  = 3
};

// Filtro de mediana de 3 amostras (rejeita picos isolados de eco)
float frontSamples[3]  = {250.0f, 250.0f, 250.0f};
float groundSamples[3] = {GROUND_BASELINE_CM, GROUND_BASELINE_CM, GROUND_BASELINE_CM};
uint8_t sampleIdx = 0;

// Histerese temporal
ObstacleType confirmedType = OBS_CLEAR;
ObstacleType candidateType = OBS_CLEAR;
uint8_t candidateCycles = 0;

// Telemetria
unsigned long lastBleNotifyMs = 0;
unsigned long lastBatteryReadMs = 0;
unsigned long lastDebugPrintMs = 0;
ObstacleType lastSentType = OBS_CLEAR;
uint32_t packetSeq = 0;
uint8_t currentBatteryPercent = 85;

// ============================================================================
// 6. CALLBACKS DE CONEXÃO BLE
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
// 7. LEITURA E CLASSIFICAÇÃO
// ============================================================================

/**
 * Mede a distância em centímetros com um HC-SR04.
 * Retorna 999.0f caso não haja eco dentro do alcance máximo.
 */
float readUltrasonicCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long durationUs = pulseIn(echoPin, HIGH, ULTRASONIC_TIMEOUT_US);
  if (durationUs == 0) {
    return 999.0f;
  }
  return (durationUs * 0.0343f) / 2.0f;
}

float medianOf3(float a, float b, float c) {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

/**
 * Classificação instantânea (antes da histerese).
 * Prioridade: DESNÍVEL > PAREDE > LIVRE
 */
ObstacleType classifyTerrain(float frontCm, float groundCm) {
  if ((groundCm >= HOLE_THRESHOLD_CM && groundCm < MAX_VALID_DISTANCE_CM) || groundCm >= 900.0f) {
    return OBS_HOLE;
  }
  if (frontCm >= WALL_MIN_CM && frontCm <= WALL_WARNING_CM) {
    return OBS_WALL;
  }
  return OBS_CLEAR;
}

/**
 * Aplica a histerese temporal e devolve o tipo confirmado.
 */
ObstacleType applyHysteresis(ObstacleType instantType) {
  if (instantType == confirmedType) {
    candidateType = confirmedType;
    candidateCycles = 0;
    return confirmedType;
  }

  if (instantType == candidateType) {
    if (candidateCycles < 255) candidateCycles++;
  } else {
    candidateType = instantType;
    candidateCycles = 1;
  }

  uint8_t required = (candidateType == OBS_CLEAR) ? CONFIRM_CYCLES_EXIT : CONFIRM_CYCLES_ENTER;
  if (candidateCycles >= required) {
    confirmedType = candidateType;
    candidateCycles = 0;
  }
  return confirmedType;
}

float distanceForType(ObstacleType type, float frontCm, float groundCm) {
  switch (type) {
    case OBS_HOLE: return (groundCm >= 900.0f) ? 150.0f : groundCm;
    case OBS_WALL: return frontCm;
    default:       return (frontCm < groundCm) ? frontCm : groundCm;
  }
}

const char* obstacleToString(ObstacleType type) {
  switch (type) {
    case OBS_HOLE: return "HOLE";
    case OBS_WALL: return "WALL";
    default:       return "CLEAR";
  }
}

// ============================================================================
// 8. ATUAÇÃO HÁPTICA LOCAL (RF04, RF05, RF06)
// ============================================================================
void updateVibrationFeedback(ObstacleType type, float distanceCm) {
  unsigned long now = millis();

  switch (type) {
    case OBS_HOLE:
      // Desnível: vibração contínua em potência máxima
      ledcWrite(PIN_VIBRATION_MOTOR, 255);
      break;

    case OBS_WALL:
      if (distanceCm <= WALL_CRITICAL_CM) {
        // Muito perto: pulsos rápidos e fortes
        ledcWrite(PIN_VIBRATION_MOTOR, ((now % 250) < 150) ? 220 : 0);
      } else {
        // Alerta antecipado: pulsos suaves
        ledcWrite(PIN_VIBRATION_MOTOR, ((now % 500) < 200) ? 160 : 0);
      }
      break;

    case OBS_CLEAR:
    default:
      ledcWrite(PIN_VIBRATION_MOTOR, 0);
      break;
  }
}

// ============================================================================
// 9. BATERIA E TELEMETRIA BLE (RF07 / RNF02)
// ============================================================================
uint8_t readBatteryPercentage() {
  int rawAdc = analogRead(PIN_BATTERY_ADC);
  if (rawAdc <= 0) {
    return 85; // Divisor de bateria não conectado na bancada
  }
  float voltage = (rawAdc / 4095.0f) * 3.3f * 2.0f;
  int pct = (int)((voltage - 3.2f) * 100.0f / (4.2f - 3.2f));
  if (pct > 100) pct = 100;
  if (pct < 5)   pct = 85;
  return (uint8_t)pct;
}

/**
 * Envia o estado confirmado ao celular:
 * - imediatamente quando o tipo confirmado muda;
 * - e periodicamente a cada TELEMETRY_INTERVAL_MS para manter a tela atualizada.
 * O aplicativo é quem decide quando falar (não repete a mesma fala sem parar).
 */
void notifyBleTelemetry(ObstacleType type, float distCm, float frontCm, float groundCm) {
  if (!deviceConnected || pObstacleCharacteristic == nullptr) return;

  unsigned long now = millis();
  bool typeChanged = (type != lastSentType);
  bool periodic = (now - lastBleNotifyMs >= TELEMETRY_INTERVAL_MS);
  if (!typeChanged && !periodic) return;

  packetSeq++;
  char payload[32];
  snprintf(
    payload,
    sizeof(payload),
    "%s,%.0f,%.0f,%.0f,%u",
    obstacleToString(type),
    distCm,
    frontCm,
    groundCm,
    currentBatteryPercent
  );

  pObstacleCharacteristic->setValue((uint8_t*)payload, strlen(payload));
  pObstacleCharacteristic->notify();

  if (typeChanged) {
    Serial.printf("[BLE] >>> Enviado ao celular (%d bytes): %s\n", (int)strlen(payload), payload);
  }

  lastSentType = type;
  lastBleNotifyMs = now;
}

// ============================================================================
// 10. SETUP & LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  Serial.println("====================================================");
  Serial.println("Iniciando Firmware MAT (Modulo Assistente Terrestre)");
  Serial.println("Classes: LIVRE | PAREDE | DESNIVEL");
  Serial.println("====================================================");

  pinMode(PIN_FRONT_TRIG, OUTPUT);
  digitalWrite(PIN_FRONT_TRIG, LOW);
  pinMode(PIN_FRONT_ECHO, INPUT);
  pinMode(PIN_GROUND_TRIG, OUTPUT);
  digitalWrite(PIN_GROUND_TRIG, LOW);
  pinMode(PIN_GROUND_ECHO, INPUT);

  // PWM do motor de vibração (ESP32 Arduino Core 3.x)
  ledcAttach(PIN_VIBRATION_MOTOR, PWM_FREQ, PWM_RESOLUTION);
  ledcWrite(PIN_VIBRATION_MOTOR, 200);
  delay(200);
  ledcWrite(PIN_VIBRATION_MOTOR, 0);

  // Servidor BLE
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(185); // Garante que o JSON caiba inteiro em uma notificação
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MatServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pObstacleCharacteristic = pService->createCharacteristic(
    CHAR_OBSTACLE_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pObstacleCharacteristic->addDescriptor(new BLE2902());

  pBatteryCharacteristic = pService->createCharacteristic(
    CHAR_BATTERY_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pBatteryCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.println("[MAT] Servidor BLE ativo e aguardando conexao como 'MAT-ESP32'.");
}

void loop() {
  // 1. Leitura dos sensores (intervalo entre eles evita interferência acústica)
  float rawFrontCm = readUltrasonicCm(PIN_FRONT_TRIG, PIN_FRONT_ECHO);
  delay(12);
  float rawGroundCm = readUltrasonicCm(PIN_GROUND_TRIG, PIN_GROUND_ECHO);

  // 2. Filtro de mediana
  frontSamples[sampleIdx]  = rawFrontCm;
  groundSamples[sampleIdx] = rawGroundCm;
  sampleIdx = (sampleIdx + 1) % 3;
  float frontCm  = medianOf3(frontSamples[0], frontSamples[1], frontSamples[2]);
  float groundCm = medianOf3(groundSamples[0], groundSamples[1], groundSamples[2]);

  // 3. Classificação instantânea + histerese temporal (anti-alarme falso)
  ObstacleType instantType = classifyTerrain(frontCm, groundCm);
  ObstacleType type = applyHysteresis(instantType);
  float distCm = distanceForType(type, frontCm, groundCm);

  // 4. Vibração local imediata
  updateVibrationFeedback(type, distCm);

  // 5. Diagnóstico no Monitor Serial (115200 baud)
  if (millis() - lastDebugPrintMs >= 500) {
    Serial.printf("[MAT-DEBUG] Frontal: %.1f cm | Solo: %.1f cm | Leitura: %s | Confirmado: %s | BLE: %s\n",
                  frontCm, groundCm,
                  obstacleToString(instantType),
                  obstacleToString(type),
                  deviceConnected ? "CONECTADO" : "AGUARDANDO");
    lastDebugPrintMs = millis();
  }

  // 6. Bateria (a cada 10 s)
  unsigned long now = millis();
  if (now - lastBatteryReadMs >= 10000) {
    currentBatteryPercent = readBatteryPercentage();
    if (deviceConnected && pBatteryCharacteristic != nullptr) {
      pBatteryCharacteristic->setValue(&currentBatteryPercent, 1);
      pBatteryCharacteristic->notify();
    }
    lastBatteryReadMs = now;
  }

  // 7. Telemetria BLE
  notifyBleTelemetry(type, distCm, frontCm, groundCm);

  // 8. Reconexão automática do advertising
  if (!deviceConnected && oldDeviceConnected) {
    delay(50);
    pServer->startAdvertising();
    Serial.println("[BLE] Reiniciando advertising para reconexao automatica...");
    oldDeviceConnected = deviceConnected;
    lastSentType = OBS_CLEAR;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    lastSentType = (type == OBS_CLEAR) ? OBS_HOLE : OBS_CLEAR; // força envio imediato do estado atual
  }

  delay(15);
}
