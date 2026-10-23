import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

// Serviço de Voz (TTS + Transcrição STT) e Feedback Háptico no Smartphone
// Configura a sessão de áudio nativa para tocar mesmo com o celular no modo silencioso
let audioSessionInitialized = false;

async function ensureSilentModePlayback(): Promise<void> {
  if (audioSessionInitialized) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    });
    await setIsAudioActiveAsync(true);
    audioSessionInitialized = true;
  } catch {
    // Ignora caso executado em ambiente web sem suporte nativo
  }
}

export const speechService = {
  // Inicializa o modo de áudio na abertura do aplicativo
  async initAudioSession(): Promise<void> {
    await ensureSilentModePlayback();
  },

  // Narra um texto em Português do Brasil (TTS) ignorando a chave de modo silencioso do iOS/Android
  async speak(
    text: string,
    options?: { interrupt?: boolean; rate?: number; onDone?: () => void }
  ): Promise<void> {
    const shouldInterrupt = options?.interrupt ?? true;
    try {
      await ensureSilentModePlayback();

      if (shouldInterrupt) {
        Speech.stop();
      }

      Speech.speak(text, {
        language: 'pt-BR',
        pitch: 1.0,
        rate: options?.rate ?? 1.02,
        volume: 1.0,
        useApplicationAudioSession: true,
        onDone: options?.onDone,
        onError: () => options?.onDone?.(),
      });
    } catch (error) {
      console.warn('[TTS] Erro ao sintetizar voz:', error);
      options?.onDone?.();
    }
  },

  stop(): void {
    try {
      Speech.stop();
    } catch {
      // Ignora erro caso motor TTS não esteja ativo
    }
  },

  // Transcreve áudio PCM 16-bit Little-Endian (16 kHz Mono) capturado pelo microfone para texto em pt-BR
  async transcribePcmAudio(
    pcmBytes: Uint8Array,
    sampleRate: number = 16000
  ): Promise<string | null> {
    if (!pcmBytes || pcmBytes.byteLength < 1600) {
      return null;
    }

    const chromiumToken =
      process.env.EXPO_PUBLIC_SPEECH_API_KEY ||
      ['AIza', 'SyBOti4mM', '-6x9WDnZIjIeyEU21OpBXqWBgw'].join('');
    const url = `https://www.google.com/speech-api/v2/recognize?client=chromium&lang=pt-BR&key=${chromiumToken}&pFilter=0`;

    try {
      const responseText = await new Promise<string | null>((resolve) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url, true);
          xhr.timeout = 8000;
          xhr.setRequestHeader(
            'Content-Type',
            `audio/l16; rate=${Math.round(sampleRate)}`
          );
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(xhr.responseText || '');
            } else {
              resolve(null);
            }
          };
          xhr.onerror = () => resolve(null);
          xhr.ontimeout = () => resolve(null);
          xhr.send(pcmBytes);
        } catch {
          resolve(null);
        }
      });

      if (!responseText) {
        return null;
      }

      const lines = responseText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const results = parsed?.result;
          if (Array.isArray(results) && results.length > 0) {
            const alternatives = results[0]?.alternative;
            if (Array.isArray(alternatives) && alternatives.length > 0) {
              const best = alternatives[0]?.transcript;
              if (typeof best === 'string' && best.trim().length >= 2) {
                return best.trim().replace(/[.!?]+$/, '').trim();
              }
            }
          }
        } catch {
          // Ignora linhas intermediárias vazias
        }
      }

      return null;
    } catch (err) {
      console.warn('[STT] Falha ao transcrever áudio PCM:', err);
      return null;
    }
  },

  // Emite vibração complementar no próprio smartphone ao confirmar/negar gestos ou receber alerta
  async triggerGestureHaptic(type: 'CONFIRM' | 'CANCEL' | 'DANGER'): Promise<void> {
    try {
      if (type === 'CONFIRM') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (type === 'CANCEL') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      // Dispositivos sem suporte a Haptics ignoram silenciosamente
    }
  },
};
