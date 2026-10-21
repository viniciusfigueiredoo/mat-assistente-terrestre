# Changelog — Viva Way (Módulo Assistente Terrestre - MAT)

Todas as mudanças relevantes do projeto são documentadas neste arquivo.

---

## [1.1.0] - 2026-10-20

### Adicionado
- **Novo Nome de Instalação (`Viva Way`):** O aplicativo instalado na tela inicial do dispositivo passa a se chamar **Viva Way**, mantendo internamente a nomenclatura técnica do **Módulo MAT**.
- **Suporte Nativo a iPhone / iOS (`.ipa`):** Configuradas permissões nativas do iOS (`Info.plist`) e adicionado pipeline automatizado em macOS (`Xcode Release`) no GitHub Actions para geração do pacote instalável `VivaWay-iOS-v1.1.0.ipa`.
- **Ícone Customizado do Aplicativo:** Suporte a ícone dedicado e *Adaptive Icon* no Android (`mobile/assets/icon.png`).
- **Modo Tela Cheia Imersivo (`expo-navigation-bar` & `expo-status-bar`):** Ocultação automática da barra de notificações superior e dos botões de navegação inferiores do sistema operacional, com reocultação automática após toque nas bordas.

### Alterado / Corrigido
- **Redesign Responsivo das 3 Telas (`useWindowDimensions`):**
  - **Tela 1 (Comando de Voz):** Agrupamento central proporcional do orbe pulsante e textos de status (`voiceHeroCenter`), evitando espaçamentos excessivos em telas alongadas (20:9), com ajuste de teclado via `KeyboardAvoidingView`.
  - **Tela 2 (Confirmação de Rota):** Novo alinhamento centralizado dos cartões de gesto (`CONFIRMAR ROTA` / `CANCELAR ROTA`) com ícones circulares e sem quebra de palavras.
  - **Tela 3 (Navegação Ativa e Alertas):** Layout ajustado para caber integralmente na tela sem rolagem desnecessária; cartões de **`Sensor Frontal`** e **`Sensor Solo`** reorganizados em empilhamento vertical para leitura imediata em qualquer largura de tela.

---

## [1.0.0] - 2026-10-20

### Adicionado
- **Firmware Embarcado ESP32 (`mat_firmware.ino`):** Leitura contínua de dois sensores ultrassônicos (Frontal e Solo), modulação PWM no motor de vibração háptica e transmissão de telemetria via servidor Bluetooth Low Energy (BLE GATT).
- **Reconhecimento de Voz em Português (`pt-BR`):** Captura de stream PCM (`16 kHz Mono`) em tempo real com detecção automática de fim de fala (VAD) e transcrição de endereço sem destino padrão artificial.
- **Síntese de Voz (TTS) em Modo Silencioso:** Reprodução forçada no alto-falante principal mesmo com o aparelho em modo silencioso.
- **Navegação Guiada por GPS em Tempo Real:** Cálculo de rotas a pé (Google Maps Directions / OpenStreetMap OSRM), acompanhamento contínuo da distância até cada esquina, pré-aviso a 25 m e comando automático de curva.
