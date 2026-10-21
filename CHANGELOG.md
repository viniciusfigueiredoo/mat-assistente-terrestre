# Changelog — Viva Way (Módulo Assistente Terrestre - MAT)

Todas as mudanças relevantes do projeto são documentadas neste arquivo.

---

## [1.0.0] - 2026-10-21

### Adicionado
- **Aplicativo Mobile `Viva Way` (Android APK & iPhone PWA):**
  - **Android (`.apk`):** Instalador nativo standalone (`VivaWay-v1.0.0.apk`) em modo de tela cheia imersivo (`expo-navigation-bar` & `expo-status-bar`), ocultando automaticamente a barra de notificações superior e os botões de navegação inferiores.
  - **iPhone / iOS (PWA via GitHub Pages):** Aplicativo Web Progressivo instalável diretamente pelo Safari (*Compartilhar → Adicionar à Tela de Início*) em `https://viniciusfigueiredoo.github.io/mat-assistente-terrestre/`, com ícone oficial e execução em tela cheia.
- **Firmware Embarcado ESP32 (`mat_firmware.ino`):**
  - Leitura contínua dos sensores ultrassônicos **Sensor Frontal** e **Sensor Solo** (`HC-SR04`), modulação PWM no motor de vibração háptica e transmissão de telemetria via servidor Bluetooth Low Energy (BLE GATT).
- **Reconhecimento de Voz em Português (`pt-BR`):**
  - Captura de áudio em tempo real com detecção automática de fim de fala (VAD) no celular e integração com Web Speech API no iOS Safari, retornando *"Destino não identificado"* caso o endereço não exista.
- **Síntese de Voz (TTS) Independente do Modo Silencioso:**
  - Reprodução das instruções e alertas no alto-falante principal mesmo com o celular no modo silencioso.
- **Confirmação de Rota por Gestos em Tela Cheia:**
  - Deslizar para a esquerda confirma e inicia a rota; deslizar para a direita cancela.
- **Navegação Ativa com GPS em Tempo Real:**
  - Cálculo de rotas a pé (Google Maps Directions / OpenStreetMap OSRM), acompanhamento contínuo da distância até cada esquina, aviso prévio a 25 m e anúncio automático de curva.
