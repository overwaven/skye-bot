import type { SpeechProvider, SpeechSynthesisOptions, TtsCapabilities } from "../types.js";
import { transcodeAudio, type AudioFormat } from "../transcode.js";
import { log } from "../../../utils/log.js";

const STT_PATH = "/stt";
const TTS_PATH = "/tts";
const TTS_TIMEOUT_MS = 60_000;

/** Built-in xAI voices (original five + common flagship names). Custom IDs also work. */
export const XAI_TTS_VOICES = [
  "ara",
  "eve",
  "leo",
  "rex",
  "sal",
  "lumen",
  "castor",
  "naksh",
  "atlas",
  "carina",
  "zagan",
  "helix",
  "orion",
  "luna",
  "wellness",
  "support",
] as const;

export interface XaiSpeechSettings {
  apiKey: string;
  baseUrl: string;
  ttsVoice: string;
  /** BCP-47 language for TTS (e.g. "en", "ru", "auto"). Required by xAI TTS. */
  ttsLanguage: string;
  ttsSpeed: number;
  /** Codec for TTS output before we transcode to OGG Opus for Telegram. */
  ttsFormat: "mp3" | "wav";
  /** Normalize STT input via ffmpeg to this container format. */
  sttFormat: AudioFormat;
  /** Language hint for STT formatting; empty = omit. */
  sttLanguage: string;
}

/**
 * xAI Voice API adapter.
 *
 * STT: POST /v1/stt (multipart form with file)
 * TTS: POST /v1/tts (JSON: text, voice_id, language) → raw audio bytes
 *
 * @see https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
 * @see https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
 */
export class XaiSpeechProvider implements SpeechProvider {
  constructor(private settings: XaiSpeechSettings) {}

  isSttAvailable(): boolean {
    return this.settings.apiKey.length > 0;
  }

  isTtsAvailable(): boolean {
    return this.settings.apiKey.length > 0;
  }

  getTtsCapabilities(): TtsCapabilities {
    return {
      defaultVoice: this.settings.ttsVoice,
      voices: XAI_TTS_VOICES,
      // Inline speech tags go in `text` ([laugh], <whisper>…</whisper>).
      // No separate style/scene channel — do not advertise expressive notes.
      expressive: false,
    };
  }

  async recognize(audioBuffer: Buffer, language: string = "ru-RU"): Promise<string | null> {
    if (!this.isSttAvailable()) {
      log.warn("xAI speech not configured, cannot recognize speech");
      return null;
    }

    let normalized: Buffer;
    try {
      normalized = await transcodeAudio(audioBuffer, this.settings.sttFormat);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`xAI STT transcoding failed: ${msg}`);
      return null;
    }

    const ext = this.settings.sttFormat === "oggopus" ? "ogg" : this.settings.sttFormat;
    const mime =
      this.settings.sttFormat === "mp3"
        ? "audio/mpeg"
        : this.settings.sttFormat === "wav"
          ? "audio/wav"
          : "audio/ogg";

    const lang = this.settings.sttLanguage || language.slice(0, 2);
    const form = new FormData();
    // Option fields must precede `file` per xAI docs.
    if (lang) {
      form.append("language", lang);
      form.append("format", "true");
    }
    form.append("file", new Blob([new Uint8Array(normalized)], { type: mime }), `audio.${ext}`);

    try {
      const res = await fetch(`${this.settings.baseUrl}${STT_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error(`xAI STT failed (${res.status}): ${body}`);
        return null;
      }

      const data = (await res.json()) as { text?: string };
      return data.text || null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`xAI STT error: ${msg}`);
      return null;
    }
  }

  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {},
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    if (!this.isTtsAvailable()) {
      log.warn("xAI speech not configured, cannot synthesize speech");
      return null;
    }

    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(TTS_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    // xAI only supports expression via inline tags inside `text`. Never prepend
    // style/scene notes — they would be spoken literally.
    const spoken = buildXaiTtsText(text);

    try {
      const body: Record<string, unknown> = {
        text: spoken,
        voice_id: options.voice || this.settings.ttsVoice,
        language: this.settings.ttsLanguage || "auto",
        output_format: {
          codec: this.settings.ttsFormat,
          sample_rate: 24_000,
          ...(this.settings.ttsFormat === "mp3" ? { bit_rate: 128_000 } : {}),
        },
      };
      if (this.settings.ttsSpeed !== 1) {
        body.speed = this.settings.ttsSpeed;
      }

      const res = await fetch(`${this.settings.baseUrl}${TTS_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: requestSignal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        log.error(`xAI TTS failed (${res.status}): ${errBody}`);
        return null;
      }

      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length === 0) {
        log.error("xAI TTS returned empty audio");
        return null;
      }

      const audio = await transcodeAudio(raw, "oggopus");
      log.debug(
        { provider: "xai", bytes: audio.length, totalMs: Date.now() - startedAt },
        "TTS audio prepared"
      );
      return audio;
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: e, elapsedMs: Date.now() - startedAt }, `xAI TTS error: ${msg}`);
      return null;
    }
  }
}

/** xAI speaks the text body verbatim; style/scene must never be vocalized. */
export function buildXaiTtsText(transcript: string): string {
  return transcript;
}
