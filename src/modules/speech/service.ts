import type { SpeechProvider, SpeechSynthesisOptions, TtsCapabilities } from "./types.js";
import type { ProviderService } from "../providers/service.js";
import { OpenRouterSpeechProvider } from "./providers/openrouter.js";
import { XaiSpeechProvider } from "./providers/xai.js";
import { TinfoilSpeechProvider } from "./providers/tinfoil.js";

/**
 * Public speech facade exposed to the rest of the bot. Delegates to a
 * provider-specific adapter (Yandex SpeechKit or OpenRouter) chosen at module
 * init time based on config.voice.provider. Keeping the facade stable means
 * telegram/panel do not need to know which backend is active.
 */
export class SpeechService {
  constructor(
    private provider: SpeechProvider,
    private providers?: ProviderService
  ) {}

  isSttAvailable(chatId?: number): boolean {
    const runtime = this.runtimeProvider("stt", chatId);
    return this.providers?.hasProviders()
      ? Boolean(runtime?.isSttAvailable())
      : Boolean(runtime?.isSttAvailable() || this.provider.isSttAvailable());
  }

  isTtsAvailable(chatId?: number): boolean {
    const runtime = this.runtimeProvider("tts", chatId);
    return this.providers?.hasProviders()
      ? Boolean(runtime?.isTtsAvailable())
      : Boolean(runtime?.isTtsAvailable() || this.provider.isTtsAvailable());
  }

  recognize(
    audioBuffer: Buffer,
    language: string = "ru-RU",
    chatId?: number
  ): Promise<string | null> {
    const runtime = this.runtimeProvider("stt", chatId);
    if (this.providers?.hasProviders() && !runtime) return Promise.resolve(null);
    return (runtime ?? this.provider).recognize(audioBuffer, language);
  }

  synthesize(
    text: string,
    options?: SpeechSynthesisOptions,
    signal?: AbortSignal,
    chatId?: number
  ): Promise<Buffer | null> {
    const routingVoice = this.providers?.getRouting(chatId).ttsVoice ?? undefined;
    const runtime = this.runtimeProvider("tts", chatId);
    if (this.providers?.hasProviders() && !runtime) return Promise.resolve(null);
    return (runtime ?? this.provider).synthesize(
      text,
      { ...options, voice: options?.voice || routingVoice },
      signal
    );
  }

  getTtsCapabilities(chatId?: number): TtsCapabilities {
    const runtime = this.runtimeProvider("tts", chatId);
    if (this.providers?.hasProviders() && !runtime) {
      return { defaultVoice: "", expressive: false };
    }
    return (runtime ?? this.provider).getTtsCapabilities();
  }

  private runtimeProvider(capability: "tts" | "stt", chatId?: number): SpeechProvider | null {
    const resolved = this.providers?.resolve(capability, chatId);
    if (!resolved) return null;
    const { provider, model } = resolved;
    const voice = this.providers?.getRouting(chatId).ttsVoice || model.config.voice || "alloy";
    if (provider.kind === "xai") {
      return new XaiSpeechProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        ttsVoice: voice,
        ttsLanguage: model.config.language || "auto",
        ttsSpeed: 1,
        ttsFormat: model.config.audioFormat === "wav" ? "wav" : "mp3",
        sttFormat:
          model.config.audioFormat === "wav" ||
          model.config.audioFormat === "mp3" ||
          model.config.audioFormat === "oggopus"
            ? model.config.audioFormat
            : "oggopus",
        sttLanguage: model.config.language || "",
      });
    }
    if (provider.kind !== "openrouter") {
      return new TinfoilSpeechProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        sttModel: capability === "stt" ? model.upstreamId : "",
        ttsModel: capability === "tts" ? model.upstreamId : "",
        ttsVoice: voice,
        ttsInstruct: "",
        sttInputFormat:
          model.config.audioFormat === "wav" ||
          model.config.audioFormat === "mp3" ||
          model.config.audioFormat === "oggopus"
            ? model.config.audioFormat
            : "oggopus",
        sttLanguage: model.config.language || "",
      });
    }
    return new OpenRouterSpeechProvider({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      sttModel: capability === "stt" ? model.upstreamId : "",
      ttsModel: capability === "tts" ? model.upstreamId : "",
      ttsVoice: voice,
      ttsResponseFormat: model.config.audioFormat === "pcm" ? "pcm" : "mp3",
      sttInputFormat:
        model.config.audioFormat === "wav" ||
        model.config.audioFormat === "mp3" ||
        model.config.audioFormat === "oggopus"
          ? model.config.audioFormat
          : "oggopus",
      sttLanguage: model.config.language || "",
      referer: "",
      title: "Skye",
      pcmSampleRate: model.config.pcmSampleRate ?? 48_000,
      pcmChannels: model.config.pcmChannels ?? 1,
    });
  }
}
