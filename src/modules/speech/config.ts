import { z } from "zod";
import { section } from "../../core/config.js";

export const speechConfigSchema = z.object({
  voice: section({
      provider: z.enum(["yandex", "openrouter", "tinfoil", "xai"]).default("yandex"),

      yc_api_key: z.string().default(""),
      yc_folder_id: z.string().default(""),
      yc_tts_voice: z.string().default("jane"),
      yc_tts_emotion: z.string().default("neutral"),
      yc_tts_lang: z.string().default("ru-RU"),
      yc_tts_speed: z.number().min(0.1).max(3.0).default(1.0),

      openrouter: section({
          api_key: z.string().default(""),
          base_url: z.string().url().or(z.literal("")).default("https://openrouter.ai/api/v1"),
          stt_model: z.string().default("nvidia/parakeet-tdt-0.6b-v3"),
          tts_model: z.string().default("google/gemini-3.1-flash-tts-preview"),
          tts_voice: z.string().default("Aoede"),
          tts_format: z.enum(["mp3", "pcm"]).default("mp3"),
          pcm_sample_rate: z.number().int().positive().default(24000),
          pcm_channels: z.number().int().positive().default(1),
          stt_format: z.enum(["mp3", "wav", "oggopus"]).default("mp3"),
          stt_language: z.string().default(""),
          referer: z.string().default(""),
          title: z.string().default(""),
        }),

      tinfoil: section({
          api_key: z.string().default(""),
          base_url: z.string().url().or(z.literal("")).default(""),
          stt_model: z.string().default("whisper-large-v3-turbo"),
          tts_model: z.string().default("qwen3-tts"),
          tts_voice: z.string().default("vivian"),
          tts_instruct: z.string().default(
            "Speak very fast and cheerful. Bouncy, energetic young woman, smiling voice, punchy and bright. High energy, upbeat, lively delivery with no long pauses.",
          ),
          stt_format: z.enum(["mp3", "wav", "oggopus"]).default("mp3"),
          stt_language: z.string().default(""),
        }),

      /** xAI Voice API (STT + TTS). Falls back to top-level xai_api_key when api_key is empty. */
      xai: section({
          api_key: z.string().default(""),
          base_url: z.string().url().or(z.literal("")).default("https://api.x.ai/v1"),
          tts_voice: z.string().default("eve"),
          /** BCP-47 or "auto" — required by xAI TTS. */
          tts_language: z.string().default("auto"),
          tts_speed: z.number().min(0.7).max(1.5).default(1.0),
          tts_format: z.enum(["mp3", "wav"]).default("mp3"),
          stt_format: z.enum(["mp3", "wav", "oggopus"]).default("mp3"),
          stt_language: z.string().default(""),
        }),
    }),
});

export type SpeechConfig = z.infer<typeof speechConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    voice: {
      provider: "yandex" | "openrouter" | "tinfoil" | "xai";
      yc_api_key: string;
      yc_folder_id: string;
      yc_tts_voice: string;
      yc_tts_emotion: string;
      yc_tts_lang: string;
      yc_tts_speed: number;
      openrouter: {
        api_key: string;
        base_url: string;
        stt_model: string;
        tts_model: string;
        tts_voice: string;
        tts_format: "mp3" | "pcm";
        pcm_sample_rate: number;
        pcm_channels: number;
        stt_format: "mp3" | "wav" | "oggopus";
        stt_language: string;
        referer: string;
        title: string;
      };
      tinfoil: {
        api_key: string;
        base_url: string;
        stt_model: string;
        tts_model: string;
        tts_voice: string;
        tts_instruct: string;
        stt_format: "mp3" | "wav" | "oggopus";
        stt_language: string;
      };
      xai: {
        api_key: string;
        base_url: string;
        tts_voice: string;
        tts_language: string;
        tts_speed: number;
        tts_format: "mp3" | "wav";
        stt_format: "mp3" | "wav" | "oggopus";
        stt_language: string;
      };
    };
  }
}
