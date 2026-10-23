import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioStream,
} from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import {
  NavigationBar,
  addVisibilityListener,
  setVisibilityAsync,
} from 'expo-navigation-bar';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { OBSTACLE_METADATA } from './src/constants/ble';
import { bleService } from './src/services/bleService';
import { mapsService } from './src/services/mapsService';
import { speechService } from './src/services/speechService';
import { storageService } from './src/services/storageService';
import {
  AppScreen,
  CalculatedRoute,
  MatTelemetryPayload,
  ObstacleKind,
} from './src/types/mat';

export default function App() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isCompactScreen = screenHeight < 720 || screenWidth < 360;

  // Dimensionamento responsivo do orbe central de acordo com a tela do aparelho
  const orbSize = Math.round(
    Math.min(screenWidth * 0.46, screenHeight * 0.24, 196)
  );
  const pulseRingSize = Math.round(orbSize * 1.24);

  // Estado principal de navegação entre as 3 telas do wireframe
  const [screen, setScreen] = useState<AppScreen>('VOICE_COMMAND');

  // Estado de conexão Bluetooth (BLE) com o ESP32 (RF07, RF13)
  const [bleConnected, setBleConnected] = useState<boolean>(false);
  const [isBleSimulated, setIsBleSimulated] = useState<boolean>(true);

  // Estado de Comando de Voz (STT - RF08)
  const [isListening, setIsListening] = useState<boolean>(false);
  const [spokenText, setSpokenText] = useState<string>('');
  const [voiceFeedbackHint, setVoiceFeedbackHint] = useState<string>(
    'Toque no botão central para ditar o destino'
  );
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [showBenchSimulator, setShowBenchSimulator] = useState<boolean>(false);

  // Estado da Rota Calculada (RF09, RF10, RF11, RF12)
  const [currentRoute, setCurrentRoute] = useState<CalculatedRoute | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [liveStepDistanceMeters, setLiveStepDistanceMeters] = useState<
    number | null
  >(null);

  // Estado de Telemetria de Obstáculos recebidos do MAT via BLE (RF01-RF07, RF12)
  const [telemetry, setTelemetry] = useState<MatTelemetryPayload>({
    type: 'CLEAR',
    dist: 0,
    front: 0,
    ground: 0,
    bat: 85,
  });

  // Animação dos anéis de pulso do botão de voz
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.35)).current;

  // Referência para o estado atual nos gestos de deslizar
  const screenRef = useRef<AppScreen>(screen);
  screenRef.current = screen;
  const routeRef = useRef<CalculatedRoute | null>(currentRoute);
  routeRef.current = currentRoute;

  // Buffers e estado de captura PCM em tempo real (16 kHz 16-bit Mono)
  const pcmChunksRef = useRef<Uint8Array[]>([]);
  const speechFramesRef = useRef<number>(0);
  const lastVoiceTimestampRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFinishingCaptureRef = useRef<boolean>(false);
  const lastObstacleAlertRef = useRef<{ type: ObstacleKind; time: number; dist: number }>({
    type: 'CLEAR',
    time: 0,
    dist: 0,
  });

  const streamEncoding = Platform.OS === 'android' ? 'int16' : 'float32';
  const requestedSampleRate = Platform.OS === 'android' ? 16000 : 48000;

  const { stream: audioStream } = useAudioStream({
    sampleRate: requestedSampleRate,
    channels: 1,
    encoding: streamEncoding,
    onBuffer: (buffer) => {
      if (isFinishingCaptureRef.current || !buffer?.data) return;

      try {
        const srcRate = buffer.sampleRate || requestedSampleRate;
        const srcChannels = Math.max(1, buffer.channels || 1);
        const targetRate = 16000;
        const ratio = srcRate / targetRate;

        let int16Chunk: Int16Array;

        if (streamEncoding === 'int16') {
          const rawInt16 = new Int16Array(buffer.data);
          const monoSamplesCount = Math.floor(rawInt16.length / srcChannels);
          const outLen = Math.max(1, Math.floor(monoSamplesCount / ratio));
          int16Chunk = new Int16Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const srcIdx = Math.min(
              rawInt16.length - 1,
              Math.floor(i * ratio) * srcChannels
            );
            int16Chunk[i] = rawInt16[srcIdx];
          }
        } else {
          // No iOS, captura em Float32 nativo (-1.0 a +1.0) e converte para Int16 (16 kHz)
          const rawFloat = new Float32Array(buffer.data);
          const monoSamplesCount = Math.floor(rawFloat.length / srcChannels);
          const outLen = Math.max(1, Math.floor(monoSamplesCount / ratio));
          int16Chunk = new Int16Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const srcIdx = Math.min(
              rawFloat.length - 1,
              Math.floor(i * ratio) * srcChannels
            );
            const clamped = Math.max(-1, Math.min(1, rawFloat[srcIdx]));
            int16Chunk[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
          }
        }

        // Calcula amplitude de pico e energia RMS para detectar voz real (VAD)
        let peak = 0;
        let sumSq = 0;
        for (let i = 0; i < int16Chunk.length; i++) {
          const abs = Math.abs(int16Chunk[i]);
          if (abs > peak) peak = abs;
          sumSq += abs * abs;
        }
        const rms =
          int16Chunk.length > 0 ? Math.sqrt(sumSq / int16Chunk.length) : 0;

        const copyBytes = new Uint8Array(int16Chunk.byteLength);
        copyBytes.set(
          new Uint8Array(
            int16Chunk.buffer,
            int16Chunk.byteOffset,
            int16Chunk.byteLength
          )
        );
        pcmChunksRef.current.push(copyBytes);

        const now = Date.now();
        if (peak > 850 || rms > 220) {
          speechFramesRef.current += 1;
          lastVoiceTimestampRef.current = now;
          if (speechFramesRef.current === 2) {
            setVoiceFeedbackHint(
              'Captando sua voz... (toque para concluir ou aguarde)'
            );
          }
        } else if (
          speechFramesRef.current >= 3 &&
          lastVoiceTimestampRef.current > 0 &&
          now - lastVoiceTimestampRef.current >= 1200
        ) {
          finishAndTranscribeRecording();
        }
      } catch {
        // Ignora chunk inválido
      }
    },
  });

  // ==========================================================================
  // MODO TELA CHEIA IMERSIVO (OCULTA BARRAS DO SISTEMA NO ANDROID E IOS)
  // ==========================================================================
  useEffect(() => {
    const enforceImmersiveFullscreen = () => {
      try {
        StatusBar.setHidden(true, 'fade');
        if (Platform.OS === 'android') {
          StatusBar.setTranslucent(true);
          StatusBar.setBackgroundColor('transparent', false);
          NavigationBar.setHidden(true);
          setVisibilityAsync('hidden').catch(() => {});
        }
      } catch {
        // Ignora caso não suportado no navegador web
      }
    };

    enforceImmersiveFullscreen();

    // Se o usuário passar o dedo na borda e a barra do Android aparecer, oculta novamente após 1,8s
    let navListener: { remove: () => void } | null = null;
    let rehideTimeout: ReturnType<typeof setTimeout> | null = null;
    if (Platform.OS === 'android') {
      try {
        navListener = addVisibilityListener(({ visibility }) => {
          if (visibility === 'visible') {
            if (rehideTimeout) clearTimeout(rehideTimeout);
            rehideTimeout = setTimeout(() => {
              enforceImmersiveFullscreen();
            }, 1800);
          }
        });
      } catch {
        // Ignora em versões sem listener
      }
    }

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        enforceImmersiveFullscreen();
      }
    });

    return () => {
      if (rehideTimeout) clearTimeout(rehideTimeout);
      navListener?.remove();
      appStateSub.remove();
    };
  }, []);

  // ==========================================================================
  // ANIMAÇÃO VISUAL DO MICROFONE
  // ==========================================================================
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: isListening ? 1.24 : 1.08,
            duration: isListening ? 650 : 1600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: isListening ? 650 : 1600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, {
            toValue: isListening ? 0.75 : 0.4,
            duration: isListening ? 650 : 1600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.15,
            duration: isListening ? 650 : 1600,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isListening, pulseAnim, pulseOpacity]);

  // ==========================================================================
  // INICIALIZAÇÃO: SESSÃO DE ÁUDIO (MODO SILENCIOSO) E BLE
  // ==========================================================================
  useEffect(() => {
    speechService.initAudioSession();

    const unsubConn = bleService.onConnectionChange((connected, _name, isSimulated) => {
      setBleConnected(connected);
      setIsBleSimulated(isSimulated);
      if (connected && !isSimulated) {
        speechService.speak('Módulo MAT conectado com sucesso.');
      }
    });

    const unsubTelemetry = bleService.onTelemetry((payload) => {
      setTelemetry(payload);

      const now = Date.now();
      const last = lastObstacleAlertRef.current;

      if (payload.type !== 'CLEAR') {
        const cooldownPassed = now - last.time >= 3500;
        const isDifferentThreat = payload.type !== last.type && now - last.time >= 1500;
        const isUrgentHole = payload.type === 'HOLE' && last.type !== 'HOLE';

        if (cooldownPassed || isDifferentThreat || isUrgentHole) {
          lastObstacleAlertRef.current = {
            type: payload.type,
            time: now,
            dist: payload.dist,
          };
          const distMeters = (payload.dist / 100).toFixed(1).replace('.', ',');
          const alertMessage = OBSTACLE_METADATA[payload.type].ttsAlert(distMeters);
          speechService.triggerGestureHaptic('DANGER');
          speechService.speak(alertMessage, { interrupt: true });
        }
      } else if (last.type !== 'CLEAR') {
        // Transição de obstáculo para caminho desimpedido
        lastObstacleAlertRef.current = {
          type: 'CLEAR',
          time: now,
          dist: payload.dist,
        };
        speechService.triggerGestureHaptic('SUCCESS');
        speechService.speak(OBSTACLE_METADATA.CLEAR.ttsAlert(), { interrupt: true });
      }
    });

    bleService.startAutoConnect();

    speechService.speak(
      'Viva Way pronto. Toque no centro da tela e diga o destino desejado.'
    );

    return () => {
      unsubConn();
      unsubTelemetry();
      speechService.stop();
    };
  }, []);

  const handleBluetoothPress = async () => {
    if (Platform.OS === 'web') {
      if (bleService.isWebBluetoothSupported()) {
        speechService.speak(
          'Buscando módulo MAT via Bluetooth. Por favor, selecione MAT-ESP32 na lista na tela.',
          { interrupt: true }
        );
        const connected = await bleService.connectWebBluetooth();
        if (connected) {
          speechService.speak('Módulo MAT conectado com sucesso.', { interrupt: true });
        }
      } else {
        speechService.speak(
          'O Safari do iPhone não suporta Bluetooth direto em páginas web. Use o navegador gratuito Bluefy da App Store, ou o aplicativo Android APK.',
          { interrupt: true }
        );
        Alert.alert(
          'Bluetooth no iPhone (iOS)',
          'O Safari da Apple restringe o acesso direto ao Bluetooth em páginas web.\n\nPara parear o ESP32 com o iPhone via Web:\n1. Baixe o navegador gratuito "Bluefy - Web BLE Browser" na App Store.\n2. Abra o link do Viva Way dentro do Bluefy para conectar diretamente!\n\nNo Android, você também pode baixar o arquivo .apk oficial que conecta automaticamente.'
        );
      }
    } else {
      bleService.startAutoConnect();
      speechService.speak('Buscando módulo MAT via Bluetooth.', { interrupt: true });
    }
  };

  // ==========================================================================
  // RECONHECIMENTO DE VOZ COM TRANSCRIÇÃO REAL E SEM DESTINO PADRÃO (RF08)
  // ==========================================================================
  const handleStartVoiceCommand = async () => {
    if (isCalculatingRoute) return;

    if (isListening) {
      if (speechFramesRef.current >= 2 && pcmChunksRef.current.length > 0) {
        await finishAndTranscribeRecording();
      } else {
        await stopMicrophoneCapture(true);
      }
      return;
    }

    setSpokenText('');
    setCurrentRoute(null);
    setVoiceFeedbackHint('Preparando microfone...');
    await speechService.triggerGestureHaptic('CONFIRM');

    // No navegador / PWA do iPhone, o Safari exige que o reconhecimento de voz seja iniciado
    // diretamente no evento de toque do usuário
    if (Platform.OS === 'web') {
      speechService.stop();
      beginMicrophoneListening();
      return;
    }

    speechService.speak('Ouvindo. Diga o destino.', {
      interrupt: true,
      onDone: () => {
        beginMicrophoneListening();
      },
    });
  };

  const finishAndTranscribeRecording = async () => {
    if (isFinishingCaptureRef.current) return;
    isFinishingCaptureRef.current = true;

    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    try {
      audioStream?.stop();
    } catch {
      // Ignora erro ao parar stream
    }

    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});
    await setIsAudioActiveAsync(true).catch(() => {});

    setIsListening(false);

    const capturedChunks = pcmChunksRef.current;
    const detectedSpeechFrames = speechFramesRef.current;
    pcmChunksRef.current = [];
    speechFramesRef.current = 0;
    lastVoiceTimestampRef.current = 0;

    if (detectedSpeechFrames < 2 || capturedChunks.length === 0) {
      isFinishingCaptureRef.current = false;
      handleSilenceDetected();
      return;
    }

    let totalBytes = 0;
    for (const c of capturedChunks) {
      totalBytes += c.byteLength;
    }
    const mergedPcm = new Uint8Array(totalBytes);
    let offset = 0;
    for (const c of capturedChunks) {
      mergedPcm.set(c, offset);
      offset += c.byteLength;
    }

    setIsCalculatingRoute(true);
    setVoiceFeedbackHint('Identificando o destino falado...');

    const transcribedText = await speechService.transcribePcmAudio(
      mergedPcm,
      16000
    );

    isFinishingCaptureRef.current = false;

    if (!transcribedText || transcribedText.trim().length < 2) {
      setIsCalculatingRoute(false);
      handleUnrecognizedDestination();
      return;
    }

    setSpokenText(transcribedText);
    await processDestinationRequest(transcribedText);
  };

  const beginMicrophoneListening = async () => {
    setIsListening(true);
    setVoiceFeedbackHint('Fale agora o endereço ou local de destino...');

    try {
      const win = typeof window !== 'undefined' ? (window as any) : null;
      const SpeechRecognition =
        win?.SpeechRecognition || win?.webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'pt-BR';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        let gotResult = false;

        recognition.onresult = (event: any) => {
          const transcript = (event.results?.[0]?.[0]?.transcript || '').trim();
          gotResult = true;
          setIsListening(false);
          if (transcript.length > 1) {
            setSpokenText(transcript);
            processDestinationRequest(transcript);
          } else {
            handleUnrecognizedDestination();
          }
        };

        recognition.onerror = () => {
          gotResult = true;
          setIsListening(false);
          handleUnrecognizedDestination();
        };

        recognition.onend = () => {
          if (!gotResult) {
            setIsListening(false);
            handleSilenceDetected();
          }
        };

        recognition.start();
        return;
      }
    } catch {
      // Continua para captura nativa de microfone no celular
    }

    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setIsListening(false);
        setVoiceFeedbackHint('Permissão de microfone negada');
        speechService.speak(
          'Permissão de microfone necessária para ouvir o destino.'
        );
        return;
      }

      pcmChunksRef.current = [];
      speechFramesRef.current = 0;
      lastVoiceTimestampRef.current = 0;
      isFinishingCaptureRef.current = false;

      if (!audioStream) {
        setIsListening(false);
        handleUnrecognizedDestination();
        return;
      }

      await audioStream.start();

      recordingTimerRef.current = setTimeout(() => {
        finishAndTranscribeRecording();
      }, 4500);
    } catch (err) {
      console.warn('[MIC] Erro ao iniciar captura de voz:', err);
      setIsListening(false);
      handleUnrecognizedDestination();
    }
  };

  const stopMicrophoneCapture = async (announceCancel: boolean) => {
    isFinishingCaptureRef.current = true;
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    try {
      audioStream?.stop();
    } catch {
      // Ignora
    }
    pcmChunksRef.current = [];
    speechFramesRef.current = 0;
    lastVoiceTimestampRef.current = 0;

    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});
    await setIsAudioActiveAsync(true).catch(() => {});

    isFinishingCaptureRef.current = false;
    setIsListening(false);
    if (announceCancel) {
      setVoiceFeedbackHint('Escuta pausada. Toque para falar novamente.');
      speechService.speak('Escuta cancelada.');
    }
  };

  const handleSilenceDetected = () => {
    setSpokenText('');
    setCurrentRoute(null);
    setVoiceFeedbackHint(
      'Nenhum som detectado. Toque no botão central e fale o destino.'
    );
    speechService.triggerGestureHaptic('CANCEL');
    speechService.speak(
      'Nenhum destino foi ouvido. Quando quiser, toque no centro da tela e diga o destino.'
    );
  };

  const handleUnrecognizedDestination = () => {
    setSpokenText('');
    setCurrentRoute(null);
    setVoiceFeedbackHint(
      'Destino não identificado. Toque para falar novamente.'
    );
    speechService.triggerGestureHaptic('CANCEL');
    speechService.speak(
      'Destino não identificado. Por favor, tente novamente.'
    );
  };

  // ==========================================================================
  // CÁLCULO DE ROTA (RF09)
  // ==========================================================================
  const processDestinationRequest = async (destinationText: string) => {
    const query = destinationText.trim();
    if (!query || query.length < 2) {
      handleUnrecognizedDestination();
      return;
    }

    Keyboard.dismiss();
    setIsCalculatingRoute(true);
    setVoiceFeedbackHint(`Buscando rota para "${query}"...`);
    speechService.speak(`Calculando rota a pé para ${query}.`, {
      interrupt: true,
    });

    try {
      const route = await mapsService.calculateWalkingRoute(query);
      setCurrentRoute(route);
      setCurrentStepIndex(0);
      setSpokenText('');
      setScreen('ROUTE_CONFIRMATION');

      speechService.speak(
        `Destino: ${route.destinationName}. ${route.totalDistanceText}, ${route.totalDurationText}. ` +
          `Deslize para a esquerda para confirmar a rota, ou deslize para a direita para cancelar.`,
        { interrupt: true }
      );
    } catch (err: any) {
      if (err?.message === 'DESTINO_MUITO_DISTANTE') {
        speechService.triggerGestureHaptic('CANCEL');
        speechService.speak(
          'O destino encontrado fica muito distante para uma rota a pé. Por favor, diga também o nome do bairro ou da rua.',
          { interrupt: true }
        );
        setVoiceFeedbackHint('Destino muito distante para caminhada a pé.');
        return;
      }
      handleUnrecognizedDestination();
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  // ==========================================================================
  // GESTOS GLOBAIS EM TELA CHEIA: SWIPE LEFT (RF10) E SWIPE RIGHT (RF11)
  // ==========================================================================
  const confirmRouteBySwipeLeft = async () => {
    const route = routeRef.current;
    if (!route) return;

    await speechService.triggerGestureHaptic('CONFIRM');
    await storageService.addRouteHistory({
      destinationName: route.destinationName,
      totalDistanceText: route.totalDistanceText,
      totalDurationText: route.totalDurationText,
    });

    setCurrentStepIndex(0);
    setScreen('ACTIVE_NAVIGATION');

    const firstInstruction =
      route.steps[0]?.instruction || 'Siga em frente pela rota.';
    speechService.speak(
      `Rota confirmada. Iniciando navegação. ${firstInstruction}.`,
      { interrupt: true }
    );
  };

  const cancelRouteBySwipeRight = async () => {
    await speechService.triggerGestureHaptic('CANCEL');
    setSpokenText('');
    setCurrentRoute(null);
    setCurrentStepIndex(0);
    setVoiceFeedbackHint('Toque no botão central para ditar o destino');
    setScreen('VOICE_COMMAND');
    speechService.speak(
      'Rota cancelada. Toque na tela quando quiser ditar um novo destino.',
      { interrupt: true }
    );
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return (
          Math.abs(gestureState.dx) > 25 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        );
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx < -45 && screenRef.current === 'ROUTE_CONFIRMATION') {
          confirmRouteBySwipeLeft();
        } else if (
          gestureState.dx > 45 &&
          (screenRef.current === 'ROUTE_CONFIRMATION' ||
            screenRef.current === 'ACTIVE_NAVIGATION')
        ) {
          cancelRouteBySwipeRight();
        }
      },
    })
  ).current;

  // ==========================================================================
  // NAVEGAÇÃO PASSO A PASSO COM ATUALIZAÇÃO EM TEMPO REAL VIA GPS (RF12)
  // ==========================================================================
  const stepIndexRef = useRef<number>(currentStepIndex);
  stepIndexRef.current = currentStepIndex;
  const preWarnedStepRef = useRef<number>(-1);
  const lastStepAdvanceTimeRef = useRef<number>(0);

  const handleNextStep = () => {
    const now = Date.now();
    // Evita avanços em rajada provocados por oscilações e ruídos instantâneos de GPS (debounce de 3.5s)
    if (now - lastStepAdvanceTimeRef.current < 3500) {
      return;
    }
    lastStepAdvanceTimeRef.current = now;

    const activeRoute = routeRef.current;
    if (!activeRoute) return;
    const nextIdx = stepIndexRef.current + 1;
    if (nextIdx < activeRoute.steps.length) {
      setCurrentStepIndex(nextIdx);
      setLiveStepDistanceMeters(activeRoute.steps[nextIdx]?.distanceMeters ?? null);
      const step = activeRoute.steps[nextIdx];
      speechService.triggerGestureHaptic('CONFIRM');
      speechService.speak(`Agora: ${step.instruction}`, { interrupt: true });
    } else {
      const finishedDestination = activeRoute.destinationName;
      setSpokenText('');
      setCurrentRoute(null);
      setCurrentStepIndex(0);
      setLiveStepDistanceMeters(null);
      setVoiceFeedbackHint('Toque no botão central para ditar o destino');
      setScreen('VOICE_COMMAND');

      speechService.triggerGestureHaptic('CONFIRM');
      speechService.speak(
        `Você chegou ao seu destino: ${finishedDestination}. Navegação encerrada.`,
        { interrupt: true }
      );
    }
  };

  useEffect(() => {
    if (screen !== 'ACTIVE_NAVIGATION' || !currentRoute) {
      setLiveStepDistanceMeters(null);
      preWarnedStepRef.current = -1;
      return;
    }

    let subscription: { remove: () => void } | null = null;
    let isMounted = true;

    mapsService
      .watchUserPosition((userCoords) => {
        if (!isMounted || !routeRef.current) return;
        const route = routeRef.current;
        const idx = stepIndexRef.current;
        const step = route.steps[idx];
        const targetCoords = step?.endLocation || route.destination;
        if (!targetCoords) return;

        const remainingMeters = Math.round(
          mapsService.getDistanceMeters(userCoords, targetCoords)
        );
        setLiveStepDistanceMeters(remainingMeters);

        const nextStep = route.steps[idx + 1];
        if (
          remainingMeters <= 25 &&
          remainingMeters > 12 &&
          preWarnedStepRef.current !== idx &&
          nextStep
        ) {
          preWarnedStepRef.current = idx;
          speechService.speak(
            `Em ${remainingMeters} metros, ${nextStep.instruction}`,
            { interrupt: false }
          );
        }

        if (remainingMeters <= 12) {
          handleNextStep();
        }
      })
      .then((sub) => {
        if (!isMounted && sub) {
          sub.remove();
        } else {
          subscription = sub;
        }
      });

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, [screen, currentRoute]);

  const currentObstacleMeta = OBSTACLE_METADATA[telemetry.type];
  const currentStep = currentRoute?.steps[currentStepIndex];

  return (
    <View style={styles.rootFullscreen} {...panResponder.panHandlers}>
      <ExpoStatusBar hidden style="light" />
      <NavigationBar hidden style="light" />

      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* CABEÇALHO SUPERIOR COM RESPIRO SEGURO PARA CÂMERA FRONTAL / ILHA DINÂMICA */}
        <View style={styles.topBar}>
          <Pressable
            style={styles.bleStatusPill}
            onPress={handleBluetoothPress}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Módulo MAT ${
              bleConnected
                ? isBleSimulated
                  ? 'Modo Simulado. Toque para conectar o ESP32 real'
                  : 'Físico Conectado'
                : 'Desconectado. Toque para conectar'
            }`}
          >
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: bleConnected
                    ? isBleSimulated
                      ? '#38BDF8'
                      : '#10B981'
                    : '#F59E0B',
                },
              ]}
            />
            <Ionicons name="bluetooth" size={16} color="#38BDF8" />
            <Text style={styles.bleStatusText}>
              {bleConnected
                ? isBleSimulated
                  ? 'Conectar ESP32'
                  : 'MAT Conectado'
                : 'Buscando MAT'}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.simToggleBtn,
              showBenchSimulator && styles.simToggleBtnActive,
            ]}
            onPress={() => setShowBenchSimulator((prev) => !prev)}
            accessibilityLabel="Alternar painel simulador do ESP32"
          >
            <MaterialCommunityIcons
              name="chip"
              size={16}
              color={showBenchSimulator ? '#0F172A' : '#94A3B8'}
            />
            <Text
              style={[
                styles.simToggleText,
                showBenchSimulator && styles.simToggleTextActive,
              ]}
            >
              ESP32
            </Text>
          </Pressable>
        </View>

        {/* Banner de Telemetria em Tempo Real do ESP32 Físico (RF07) */}
        {!isBleSimulated && bleConnected && (
          <View style={styles.matLiveHeaderBanner}>
            <View style={styles.matLiveHeaderCol}>
              <Text style={styles.matLiveHeaderLabel}>FRONTAL</Text>
              <Text style={styles.matLiveHeaderValue}>
                {telemetry.front >= 900 ? 'Sem eco' : `${telemetry.front} cm`}
              </Text>
            </View>
            <View style={styles.matLiveHeaderDivider} />
            <View style={styles.matLiveHeaderCol}>
              <Text style={styles.matLiveHeaderLabel}>SOLO</Text>
              <Text style={styles.matLiveHeaderValue}>
                {telemetry.ground >= 900 ? 'Sem eco' : `${telemetry.ground} cm`}
              </Text>
            </View>
            <View style={styles.matLiveHeaderDivider} />
            <View style={styles.matLiveHeaderCol}>
              <Text style={styles.matLiveHeaderLabel}>DETECÇÃO</Text>
              <Text
                style={[
                  styles.matLiveHeaderValue,
                  { color: OBSTACLE_METADATA[telemetry.type].borderColor },
                ]}
              >
                {telemetry.type === 'CLEAR' ? 'LIVRE' : OBSTACLE_METADATA[telemetry.type].title}
              </Text>
            </View>
          </View>
        )}

        {/* ====================================================================
            TELA 1: PAREAMENTO & COMANDO DE VOZ (RF08, RF13)
           ==================================================================== */}
        {screen === 'VOICE_COMMAND' && (
          <View style={styles.voiceScreenContainer}>
            {/* Bloco Central Hero Harmônico (Selo + Orbe + Textos agrupados com proporção) */}
            <View style={styles.voiceHeroCenter}>
              <View style={styles.stepPillActive}>
                <Text style={styles.stepPillText}>
                  MODO DE ESCUTA • EYES-FREE
                </Text>
              </View>

              <View
                style={[
                  styles.orbCenterWrapper,
                  { width: pulseRingSize + 16, height: pulseRingSize + 16 },
                ]}
              >
                <Animated.View
                  style={[
                    styles.pulseRingOuter,
                    {
                      width: pulseRingSize,
                      height: pulseRingSize,
                      borderRadius: pulseRingSize / 2,
                      transform: [{ scale: pulseAnim }],
                      opacity: pulseOpacity,
                      borderColor: isListening ? '#F43F5E' : '#38BDF8',
                    },
                  ]}
                />
                <Pressable
                  onPress={handleStartVoiceCommand}
                  accessibilityRole="button"
                  accessibilityLabel="Botão principal de comando de voz. Toque para falar o destino desejado."
                  style={({ pressed }) => [
                    styles.orbTouchable,
                    {
                      width: orbSize,
                      height: orbSize,
                      borderRadius: orbSize / 2,
                    },
                    pressed && { transform: [{ scale: 0.95 }] },
                  ]}
                >
                  <LinearGradient
                    colors={
                      isListening
                        ? ['#E11D48', '#BE123C']
                        : isCalculatingRoute
                        ? ['#4F46E5', '#3730A3']
                        : ['#0284C7', '#1D4ED8']
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.orbGradient, { borderRadius: orbSize / 2 }]}
                  >
                    {isCalculatingRoute ? (
                      <ActivityIndicator size="large" color="#FFFFFF" />
                    ) : (
                      <Ionicons
                        name={isListening ? 'mic' : 'mic-outline'}
                        size={Math.round(orbSize * 0.42)}
                        color="#FFFFFF"
                      />
                    )}
                  </LinearGradient>
                </Pressable>
              </View>

              <View style={styles.voiceTextGroup}>
                <Text
                  style={[
                    styles.voiceMainTitle,
                    isCompactScreen && { fontSize: 26, lineHeight: 32 },
                  ]}
                >
                  {isListening
                    ? 'Ouvindo seu destino...'
                    : isCalculatingRoute
                    ? 'Identificando rota...'
                    : 'Diga o destino\ndesejado'}
                </Text>
                <Text style={styles.voiceSubtitle}>{voiceFeedbackHint}</Text>
              </View>
            </View>

            {/* Barra Discreta de Busca / Ditado do Teclado Nativo */}
            <View style={styles.bottomDictationBar}>
              <Ionicons name="location-outline" size={20} color="#64748B" />
              <TextInput
                style={styles.dictationInput}
                placeholder="Ou dite/digite o endereço aqui..."
                placeholderTextColor="#64748B"
                value={spokenText}
                onChangeText={setSpokenText}
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (spokenText.trim()) {
                    processDestinationRequest(spokenText);
                  }
                }}
              />
              {spokenText.trim().length > 0 && (
                <Pressable
                  style={styles.sendRouteBtn}
                  onPress={() => processDestinationRequest(spokenText)}
                >
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* ====================================================================
            TELA 2: CONFIRMAÇÃO DE ROTA POR GESTOS (RF09, RF10, RF11, RNF04)
           ==================================================================== */}
        {screen === 'ROUTE_CONFIRMATION' && currentRoute && (
          <View style={styles.routeConfirmContainer}>
            {/* Card Superior de Resumo do Destino */}
            <View
              style={styles.routeSummaryCard}
              accessible
              accessibilityLabel={`Destino: ${currentRoute.destinationName}. ${currentRoute.totalDistanceText}, ${currentRoute.totalDurationText}.`}
            >
              <View style={styles.routeSummaryHeader}>
                <View style={styles.routeIconBadge}>
                  <Ionicons name="walk" size={24} color="#38BDF8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeLabelSmall}>
                    DESTINO IDENTIFICADO
                  </Text>
                  <Text style={styles.routeDestinationTitle} numberOfLines={2}>
                    {currentRoute.destinationName}
                  </Text>
                </View>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metricBox}>
                  <Ionicons name="navigate-outline" size={20} color="#38BDF8" />
                  <Text style={styles.metricValue}>
                    {currentRoute.totalDistanceText}
                  </Text>
                </View>
                <View style={styles.metricBox}>
                  <Ionicons name="time-outline" size={20} color="#10B981" />
                  <Text style={styles.metricValue}>
                    {currentRoute.totalDurationText}
                  </Text>
                </View>
              </View>
            </View>

            {/* Painel Tátil Bipartido Simétrico em Tela Cheia */}
            <View style={styles.splitGestureArea}>
              <Pressable
                style={({ pressed }) => [
                  styles.splitHalfPressable,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
                onPress={confirmRouteBySwipeLeft}
                accessibilityRole="button"
                accessibilityLabel="Deslizar para a esquerda para confirmar a rota"
              >
                <LinearGradient
                  colors={['#059669', '#064E3B']}
                  style={styles.splitGradientLeft}
                >
                  <View style={styles.gestureIconCircleLeft}>
                    <Ionicons name="arrow-back" size={34} color="#ECFDF5" />
                  </View>
                  <View style={styles.gestureCenterTextGroup}>
                    <View style={styles.gestureBadgePillLeft}>
                      <Text
                        style={styles.gestureDirectionHint}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        DESLIZAR P/ ESQUERDA
                      </Text>
                    </View>
                    <Text
                      style={styles.gestureActionTitle}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                    >
                      CONFIRMAR{'\n'}ROTA
                    </Text>
                  </View>
                </LinearGradient>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.splitHalfPressable,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
                onPress={cancelRouteBySwipeRight}
                accessibilityRole="button"
                accessibilityLabel="Deslizar para a direita para cancelar a rota"
              >
                <LinearGradient
                  colors={['#E11D48', '#881337']}
                  style={styles.splitGradientRight}
                >
                  <View style={styles.gestureIconCircleRight}>
                    <Ionicons name="arrow-forward" size={34} color="#FFE4E6" />
                  </View>
                  <View style={styles.gestureCenterTextGroup}>
                    <View style={styles.gestureBadgePillRight}>
                      <Text
                        style={styles.gestureDirectionHint}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        DESLIZAR P/ DIREITA
                      </Text>
                    </View>
                    <Text
                      style={styles.gestureActionTitle}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                    >
                      CANCELAR{'\n'}ROTA
                    </Text>
                  </View>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        )}

        {/* ====================================================================
            TELA 3: NAVEGAÇÃO ATIVA & ALERTAS DO TERRENO (RF07, RF12)
           ==================================================================== */}
        {screen === 'ACTIVE_NAVIGATION' && currentRoute && (
          <View style={styles.activeNavContainer}>
            {/* Card Principal de Instrução Passo a Passo (Audio Navigation) */}
            <Pressable
              style={styles.navInstructionCard}
              onPress={() =>
                speechService.speak(
                  currentStep?.instruction || 'Siga em frente',
                  { interrupt: true }
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Instrução de navegação: ${currentStep?.instruction}. Toque para ouvir novamente.`}
            >
              <View style={styles.navCardTopBar}>
                <View style={styles.navLiveBadge}>
                  <Ionicons name="volume-high" size={15} color="#38BDF8" />
                  <Text style={styles.navLiveBadgeText}>AUDIO NAVIGATION</Text>
                </View>
                <Text style={styles.navStepCounter}>
                  Passo {currentStepIndex + 1} de {currentRoute.steps.length}
                </Text>
              </View>

              <View style={styles.navCardMainRow}>
                <View style={styles.maneuverCircle}>
                  <Ionicons
                    name={
                      currentStep?.maneuver === 'turn-left'
                        ? 'return-up-back'
                        : currentStep?.maneuver === 'turn-right'
                        ? 'return-up-forward'
                        : 'arrow-up'
                    }
                    size={36}
                    color="#38BDF8"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.navInstructionText,
                      isCompactScreen && { fontSize: 19, lineHeight: 25 },
                    ]}
                    numberOfLines={3}
                  >
                    {currentStep?.instruction || 'Siga em frente por 50m'}
                  </Text>
                  <Text style={styles.navSubDistance} numberOfLines={1}>
                    {liveStepDistanceMeters !== null
                      ? `GPS: faltam ${liveStepDistanceMeters} m`
                      : currentStep?.distanceText}{' '}
                    • {currentRoute.destinationName}
                  </Text>
                </View>
              </View>
            </Pressable>

            {/* Card de Alerta em Tempo Real do Módulo MAT (ESP32 via BLE) */}
            <View
              style={[
                styles.matTelemetryCard,
                {
                  backgroundColor: currentObstacleMeta.backgroundColor,
                  borderColor: currentObstacleMeta.borderColor,
                },
              ]}
              accessible
              accessibilityRole="alert"
              accessibilityLabel={`Alerta do Módulo MAT: ${currentObstacleMeta.title} a ${(
                telemetry.dist / 100
              ).toFixed(1)} metros.`}
            >
              <View>
                <View style={styles.matAlertHeaderRow}>
                  <Ionicons
                    name={
                      telemetry.type === 'CLEAR'
                        ? 'shield-checkmark'
                        : 'warning'
                    }
                    size={26}
                    color={currentObstacleMeta.borderColor}
                  />
                  <Text
                    style={[
                      styles.matAlertTitle,
                      { color: currentObstacleMeta.textColor },
                    ]}
                  >
                    {telemetry.type === 'CLEAR'
                      ? 'TERRENO LIVRE'
                      : 'ALERTA MAT ATIVO'}
                  </Text>
                </View>

                <Text
                  style={[
                    styles.matAlertHeadline,
                    { color: currentObstacleMeta.textColor },
                    isCompactScreen && { fontSize: 19, lineHeight: 26 },
                  ]}
                >
                  {telemetry.type === 'CLEAR'
                    ? 'Nenhum obstáculo detectado à frente'
                    : `${currentObstacleMeta.title} (${(telemetry.dist / 100)
                        .toFixed(1)
                        .replace('.', ',')}m)\nVibração Háptica Ativa`}
                </Text>
              </View>

              <View style={styles.sensorPillsRow}>
                <View style={styles.sensorPill}>
                  <Text style={styles.sensorPillLabel} numberOfLines={1}>
                    Sensor Frontal
                  </Text>
                  <Text style={styles.sensorPillValue}>
                    {telemetry.front} cm
                  </Text>
                </View>
                <View style={styles.sensorPill}>
                  <Text style={styles.sensorPillLabel} numberOfLines={1}>
                    Sensor Solo
                  </Text>
                  <Text style={styles.sensorPillValue}>
                    {telemetry.ground} cm
                  </Text>
                </View>
              </View>
            </View>

            {/* Botões Grandes e Táteis de Controle da Navegação */}
            <View style={styles.navControlsGroup}>
              <Pressable style={styles.advanceStepBtn} onPress={handleNextStep}>
                <Text style={styles.advanceStepBtnText}>
                  Avançar Próximo Passo
                </Text>
                <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
              </Pressable>

              <Pressable
                style={styles.endNavigationBtn}
                onPress={cancelRouteBySwipeRight}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={20}
                  color="#FDA4AF"
                />
                <Text style={styles.endNavigationBtnText} numberOfLines={1}>
                  Deslizar p/ Direita ou Tocar: Encerrar Rota
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ====================================================================
            GAVETA OPCIONAL DE SIMULAÇÃO DO ESP32 (OCULTA POR PADRÃO)
           ==================================================================== */}
        {showBenchSimulator && (
          <View style={styles.simulatorDrawer}>
            <Text style={styles.simulatorHeaderLabel}>
              PACOTES BLE DO ESP32 {isBleSimulated ? '(MODO SIMULADO)' : '(MÓDULO FÍSICO)'} • FRONTAL: {telemetry.front} cm | SOLO: {telemetry.ground} cm
            </Text>
            <View style={styles.simulatorGrid}>
              {(
                [
                  {
                    kind: 'HOLE',
                    label: 'Desnível (1.2m)',
                    dist: 120,
                    icon: 'alert-circle',
                  },
                  {
                    kind: 'WALL',
                    label: 'Obstáculo (0.9m)',
                    dist: 90,
                    icon: 'stop-circle',
                  },
                  {
                    kind: 'CLEAR',
                    label: 'Livre',
                    dist: 250,
                    icon: 'checkmark-circle',
                  },
                ] as {
                  kind: ObstacleKind;
                  label: string;
                  dist: number;
                  icon: any;
                }[]
              ).map((item) => {
                const active = telemetry.type === item.kind;
                return (
                  <Pressable
                    key={item.kind}
                    style={[
                      styles.simCardBtn,
                      active && styles.simCardBtnActive,
                    ]}
                    onPress={() =>
                      bleService.simulateEsp32Obstacle(item.kind, item.dist)
                    }
                  >
                    <Ionicons
                      name={item.icon}
                      size={16}
                      color={active ? '#0F172A' : '#E2E8F0'}
                    />
                    <Text
                      style={[
                        styles.simCardBtnText,
                        active && styles.simCardBtnTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  rootFullscreen: {
    flex: 1,
    backgroundColor: '#070B14',
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    paddingBottom: Platform.OS === 'ios' ? 24 : 18,
  },
  keyboardContainer: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  bleStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bleStatusText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  pillDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#334155',
    marginHorizontal: 4,
  },
  batteryText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '800',
  },
  simToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  simToggleBtnActive: {
    backgroundColor: '#38BDF8',
    borderColor: '#38BDF8',
  },
  simToggleText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  simToggleTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  voiceScreenContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
    justifyContent: 'space-between',
  },
  voiceHeroCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  stepPillActive: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
  },
  stepPillText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  orbCenterWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  pulseRingOuter: {
    position: 'absolute',
    borderWidth: 3,
  },
  orbTouchable: {
    elevation: 12,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
  },
  orbGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  voiceTextGroup: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  voiceMainTitle: {
    color: '#F8FAFC',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 37,
    marginBottom: 8,
  },
  voiceSubtitle: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
  },
  bottomDictationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 10,
  },
  dictationInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 15,
    paddingVertical: 10,
  },
  sendRouteBtn: {
    backgroundColor: '#0284C7',
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeConfirmContainer: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 14,
  },
  routeSummaryCard: {
    backgroundColor: '#111827',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#1E293B',
  },
  routeSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  routeIconBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeLabelSmall: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  },
  routeDestinationTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#0B1120',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '900',
  },
  splitGestureArea: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  splitHalfPressable: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  splitGradientLeft: {
    flex: 1,
    paddingVertical: 24,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 24,
  },
  splitGradientRight: {
    flex: 1,
    paddingVertical: 24,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    borderWidth: 2,
    borderColor: '#FB7185',
    borderRadius: 24,
  },
  gestureIconCircleLeft: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(6, 78, 59, 0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(167, 243, 208, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gestureIconCircleRight: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(136, 19, 55, 0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(254, 205, 211, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gestureCenterTextGroup: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
  },
  gestureBadgePillLeft: {
    backgroundColor: 'rgba(0,0,0,0.24)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  gestureBadgePillRight: {
    backgroundColor: 'rgba(0,0,0,0.24)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  gestureDirectionHint: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  gestureActionTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
    textAlign: 'center',
  },
  activeNavContainer: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
    justifyContent: 'space-between',
    gap: 12,
  },
  navInstructionCard: {
    backgroundColor: '#111827',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#38BDF8',
  },
  navCardTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  navLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  navLiveBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  navStepCounter: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  navCardMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  maneuverCircle: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navInstructionText: {
    color: '#F8FAFC',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 27,
  },
  navSubDistance: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  matTelemetryCard: {
    flex: 1,
    borderRadius: 22,
    padding: 18,
    borderWidth: 2,
    justifyContent: 'space-between',
  },
  matAlertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  matAlertTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  matAlertHeadline: {
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 28,
  },
  sensorPillsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  sensorPill: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    gap: 2,
  },
  sensorPillLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '700',
  },
  sensorPillValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  navControlsGroup: {
    gap: 10,
  },
  advanceStepBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  advanceStepBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  endNavigationBtn: {
    backgroundColor: '#1E1B2E',
    borderWidth: 1.5,
    borderColor: '#881337',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  endNavigationBtnText: {
    color: '#FDA4AF',
    fontSize: 14,
    fontWeight: '800',
  },
  simulatorDrawer: {
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  simulatorHeaderLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginBottom: 8,
  },
  simulatorGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  simCardBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  simCardBtnActive: {
    backgroundColor: '#38BDF8',
  },
  simCardBtnText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  simCardBtnTextActive: {
    color: '#0F172A',
    fontWeight: '900',
  },
  matLiveHeaderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1,
    borderColor: '#38BDF8',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  matLiveHeaderCol: {
    flex: 1,
    alignItems: 'center',
  },
  matLiveHeaderLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  matLiveHeaderValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  matLiveHeaderDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#334155',
  },
});
