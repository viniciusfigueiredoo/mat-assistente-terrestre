# Firmware Embarcado — Módulo Assistente Terrestre (MAT) no ESP32

Este diretório contém o código-fonte embarcado (`mat_firmware/mat_firmware.ino`) desenvolvido para o microcontrolador **ESP32** acoplado à bengala longa do usuário.

---

## 1. Esquema de Ligação (Pinout do ESP32)

| Componente | Pino no Componente | Pino no ESP32 (GPIO) | Observação Elétrica |
| :--- | :--- | :--- | :--- |
| **HC-SR04 Frontal** *(Paredes / Obstáculos — RF03)* | `VCC` | `5V (VIN)` | Alimentação de 5V (ou 3.3V se for modelo `HC-SR04P`) |
| **HC-SR04 Frontal** | `TRIG` | `GPIO 5` | Saída digital direta do ESP32 (3.3V é reconhecido como nível ALTO pelo HC-SR04) |
| **HC-SR04 Frontal** | `ECHO` | `GPIO 18` | **Usar divisor de tensão** ($1\,\text{k}\Omega$ + $2\,\text{k}\Omega$) se alimentado em 5V |
| **HC-SR04 Frontal** | `GND` | `GND` | Terra comum |
| **HC-SR04 Inferior** *(Solo / Buracos / Escadas — RF01, RF02)* | `VCC` | `5V (VIN)` | Alimentação de 5V (ou 3.3V se for modelo `HC-SR04P`) |
| **HC-SR04 Inferior** | `TRIG` | `GPIO 19` | Saída digital direta |
| **HC-SR04 Inferior** | `ECHO` | `GPIO 21` | **Usar divisor de tensão** ($1\,\text{k}\Omega$ + $2\,\text{k}\Omega$) se alimentado em 5V |
| **HC-SR04 Inferior** | `GND` | `GND` | Terra comum |
| **Motor de Vibração (PWM)** *(Feedback Háptico — RF04, RF05)* | Sinal (Base/Gate) | `GPIO 23` | Acionar via transistor NPN (`2N2222`/`BC548`) ou módulo MOSFET com diodo de roda livre (`1N4007`) |
| **Leitura de Bateria** *(RF07)* | Divisor de Tensão | `GPIO 34 (ADC1)` | Divisor resistivo 1:2 ($100\,\text{k}\Omega$ + $100\,\text{k}\Omega$) conectado ao positivo da bateria Li-Ion |

> [!WARNING]
> **Proteção de Tensão no Pino `ECHO`:** O `HC-SR04` tradicional devolve um pulso de **5V** no pino `ECHO`, enquanto as portas do ESP32 operam em **3.3V**. Para proteger o ESP32, coloque um resistor de $1\,\text{k}\Omega$ em série entre o `ECHO` e o pino do ESP32, e um resistor de $2\,\text{k}\Omega$ entre o pino do ESP32 e o `GND` ($\approx 3.33\text{V}$).

---

## 2. Protocolo Bluetooth Low Energy (BLE GATT)

O ESP32 anuncia-se como **`MAT-ESP32`** e expõe o seguinte serviço e características:

* **Service UUID:** `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
* **Obstacle Telemetry Characteristic (`Notify` | `Read`):** `beb5483e-36e1-4688-b7f5-ea07361b26a8`
  * Envia pacotes em formato JSON compacto em até `250 ms` (**RNF02**):
    ```json
    {"type":"HOLE","dist":128,"front":240,"ground":128,"bat":85}
    ```
  * Valores possíveis de `type`:
    * `"CLEAR"` — Caminho livre
    * `"HOLE"` — Buraco ou desnível descendente abrupto à frente (**RF01, RF02**)
    * `"STAIRS"` — Escada ou degrau detectado (**RF02**)
    * `"WALL"` — Parede ou obstáculo frontal no raio de alcance (**RF03**)
* **Battery Characteristic (`Notify` | `Read`):** `beb5483e-36e1-4688-b7f5-ea07361b26a9`

---

## 3. Padrões de Vibração Autônoma (RF04, RF05, RF06, RNF05)

Mesmo sem conexão Bluetooth com o celular, o módulo MAT protege o usuário com tempo de resposta inferior a `150 ms` (**RNF01**):
1. **Buraco / Desnível Descendente (`HOLE`):** Vibração contínua em potência máxima (`PWM 255`).
2. **Escada / Degrau (`STAIRS`):** Pulsos duplos rápidos e intensos a cada `300 ms` (`PWM 240`).
3. **Parede / Obstáculo Frontal (`WALL`):** Pulsos progressivos (lentos entre `90 cm` e `180 cm`; rápidos abaixo de `90 cm`).
