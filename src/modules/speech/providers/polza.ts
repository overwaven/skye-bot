import type { SpeechProvider, SpeechSynthesisOptions, TtsCapabilities } from "../types.js";
import { transcodeAudio, type AudioFormat } from "../transcode.js";
import { buildGeminiTtsInput } from "./openrouter.js";
import { log } from "../../../utils/log.js";

const STT_PATH = "/audio/transcriptions";
const TTS_PATH = "/audio/speech";
const TTS_TIMEOUT_MS = 60_000;

export const POLZA_GEMINI_TTS_VOICES = [
  "Kore",
  "Aoede",
  "Puck",
  "Charon",
  "Zephyr",
  "Achird",
  "Algieba",
  "Algenib",
  "Fenrir",
  "Leda",
  "Orus",
] as const;

export interface PolzaSettings {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsResponseFormat: "mp3" | "wav";
  sttInputFormat: AudioFormat;
  sttLanguage: string;
}

export class PolzaSpeechProvider implements SpeechProvider {
  constructor(private settings: PolzaSettings) {}

  isSttAvailable(): boolean {
    return this.settings.apiKey.length > 0 && this.settings.sttModel.length > 0;
  }

  isTtsAvailable(): boolean {
    return this.settings.apiKey.length > 0 && this.settings.ttsModel.length > 0;
  }

  getTtsCapabilities(): TtsCapabilities {
    const isGemini = this.settings.ttsModel.toLowerCase().includes("gemini");
    return {
      defaultVoice: this.settings.ttsVoice,
      ...(isGemini ? { voices: POLZA_GEMINI_TTS_VOICES } : {}),
      expressive: isGemini,
    };
  }

  async recognize(audioBuffer: Buffer, language: string = "ru-RU"): Promise<string | null> {
    if (!this.isSttAvailable()) {
      log.warn("Polza STT is not configured");
      return null;
    }

    try {
      const normalized = await transcodeAudio(audioBuffer, this.settings.sttInputFormat);
      const extension =
        this.settings.sttInputFormat === "oggopus" ? "ogg" : this.settings.sttInputFormat;
      const mime =
        this.settings.sttInputFormat === "mp3"
          ? "audio/mpeg"
          : this.settings.sttInputFormat === "wav"
            ? "audio/wav"
            : "audio/ogg";
      const form = new FormData();
      form.append("model", this.settings.sttModel);
      form.append(
        "file",
        new Blob([new Uint8Array(normalized)], { type: mime }),
        `audio.${extension}`
      );
      const lang = this.settings.sttLanguage || language.slice(0, 2);
      if (lang) form.append("language", lang);

      const response = await fetch(`${this.settings.baseUrl}${STT_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.apiKey}` },
        body: form,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        log.error(`Polza STT failed (${response.status}): ${body}`);
        return null;
      }
      const data = (await response.json()) as { text?: string };
      return data.text || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: error }, `Polza STT error: ${message}`);
      return null;
    }
  }

  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {},
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    if (!this.isTtsAvailable()) {
      log.warn("Polza TTS is not configured");
      return null;
    }

    const timeoutSignal = AbortSignal.timeout(TTS_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const isGemini = this.settings.ttsModel.toLowerCase().includes("gemini");
      const response = await fetch(`${this.settings.baseUrl}${TTS_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.settings.ttsModel,
          input: isGemini ? buildGeminiTtsInput(text, options) : text,
          voice: options.voice || this.settings.ttsVoice,
          response_format: this.settings.ttsResponseFormat,
        }),
        signal: requestSignal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        log.error(`Polza TTS failed (${response.status}): ${body}`);
        return null;
      }

      let raw: Buffer;
      if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        const payload = (await response.json()) as { audio?: string; contentType?: string };
        if (!payload.audio) {
          log.error("Polza TTS returned JSON without audio data");
          return null;
        }
        if (/^https?:\/\//i.test(payload.audio)) {
          const audio = await fetch(payload.audio, { signal: requestSignal });
          if (!audio.ok) {
            log.error(`Polza TTS audio download failed (${audio.status})`);
            return null;
          }
          raw = Buffer.from(await audio.arrayBuffer());
        } else {
          raw = Buffer.from(payload.audio.replace(/^data:[^,]+,/, ""), "base64");
        }
      } else {
        raw = Buffer.from(await response.arrayBuffer());
      }
      const audio = await transcodeAudio(raw, "oggopus");
      log.debug({ provider: "polza", bytes: audio.length }, "TTS audio prepared");
      return audio;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: error }, `Polza TTS error: ${message}`);
      return null;
    }
  }
}
