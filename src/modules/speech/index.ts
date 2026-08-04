import type { SkyeModule } from "../../core/module.js";
import { speechConfigSchema } from "./config.js";
import type { SkyeConfig } from "../../core/config.js";
import { SpeechService } from "./service.js";
import { YandexSpeechProvider } from "./providers/yandex.js";
import { OpenRouterSpeechProvider } from "./providers/openrouter.js";
import { TinfoilSpeechProvider } from "./providers/tinfoil.js";
import { XaiSpeechProvider } from "./providers/xai.js";
import type { SpeechProvider } from "./types.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    speech: SpeechService;
  }
}

export const speechModule: SkyeModule = {
  name: "speech",
  configSchema: speechConfigSchema,
  init(ctx) {
    const provider = buildProvider(ctx.config);
    return { service: new SpeechService(provider) };
  },
};

export function buildProvider(config: SkyeConfig): SpeechProvider {
  const voice = config.voice;

  if (voice.provider === "openrouter") {
    const or = voice.openrouter;
    const apiKey = or.api_key || config.openai_key;
    const baseUrl = or.base_url || "https://openrouter.ai/api/v1";

    return new OpenRouterSpeechProvider({
      apiKey,
      baseUrl,
      sttModel: or.stt_model,
      ttsModel: or.tts_model,
      ttsVoice: or.tts_voice,
      ttsResponseFormat: or.tts_format,
      sttInputFormat: or.stt_format,
      sttLanguage: or.stt_language,
      referer: or.referer,
      title: or.title,
      pcmSampleRate: or.pcm_sample_rate,
      pcmChannels: or.pcm_channels,
    });
  }

  if (voice.provider === "tinfoil") {
    const tf = voice.tinfoil;
    const apiKey = tf.api_key || config.openai_key;
    const baseUrl = tf.base_url || config.base_url;

    return new TinfoilSpeechProvider({
      apiKey,
      baseUrl,
      sttModel: tf.stt_model,
      ttsModel: tf.tts_model,
      ttsVoice: tf.tts_voice,
      ttsInstruct: tf.tts_instruct,
      sttInputFormat: tf.stt_format,
      sttLanguage: tf.stt_language,
    });
  }

  if (voice.provider === "xai") {
    const x = voice.xai;
    const apiKey = x.api_key || config.xai_api_key || "";
    const baseUrl = (x.base_url || config.xai_base_url || "https://api.x.ai/v1").replace(
      /\/$/,
      ""
    );

    return new XaiSpeechProvider({
      apiKey,
      baseUrl,
      ttsVoice: x.tts_voice,
      ttsLanguage: x.tts_language,
      ttsSpeed: x.tts_speed,
      ttsFormat: x.tts_format,
      sttFormat: x.stt_format,
      sttLanguage: x.stt_language,
    });
  }

  return new YandexSpeechProvider({
    apiKey: voice.yc_api_key,
    folderId: voice.yc_folder_id,
    ttsVoice: voice.yc_tts_voice,
    ttsEmotion: voice.yc_tts_emotion,
    ttsLang: voice.yc_tts_lang,
    ttsSpeed: voice.yc_tts_speed,
  });
}