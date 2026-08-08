import { afterEach, describe, it, expect, vi } from "vitest";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { oggOpusDurationSeconds, transcodeAudio } from "../transcode.js";
import { buildProvider, speechModule } from "../index.js";
import { YandexSpeechProvider } from "../providers/yandex.js";
import {
  buildGeminiTtsInput,
  OpenRouterSpeechProvider,
  parsePcmContentType,
  validateTtsBytes,
} from "../providers/openrouter.js";
import { TinfoilSpeechProvider } from "../providers/tinfoil.js";
import { buildXaiTtsText, XaiSpeechProvider } from "../providers/xai.js";
import { SpeechService } from "../service.js";
import { createSendVoiceTool } from "../tool.js";
import type { SpeechProvider, SpeechSynthesisOptions } from "../types.js";
import type { SkyeConfig } from "../../../core/config.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ffmpegSineMp3(seconds = 0.4): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath!, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${seconds}`,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      "-f",
      "mp3",
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}`))
    );
  });
}

function pcmSine(seconds = 1, rate = 24_000): Buffer {
  const samples = Math.floor(seconds * rate);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8_000), i * 2);
  }
  return pcm;
}

function fakeOggDuration(seconds: number): Buffer {
  const ogg = Buffer.alloc(32);
  ogg.write("OggS", 0, "ascii");
  ogg.writeBigUInt64LE(BigInt(Math.round(seconds * 48_000)), 6);
  return ogg;
}

function makeConfig(overrides: Partial<SkyeConfig> = {}): SkyeConfig {
  return {
    openai_key: "",
    base_url: "https://openrouter.ai/api/v1",
    models: [],
    default_model_id: "sydney",
    max_completion_tokens: 500,
    use_chat_completions: false,
    image: {
      base_url: "",
      api_key: "",
      model: "",
      aspect_ratio: "",
      resolution: "",
    },
    pdf_engine: "",
    pdf_max_bytes: 25 * 1024 * 1024,
    perplexity_base_url: "https://api.perplexity.ai/v1",
    xai_base_url: "https://api.x.ai/v1",
    owner: { name: "", tag: "" },
    voice: {
      provider: "yandex",
      yc_api_key: "",
      yc_folder_id: "",
      yc_tts_voice: "jane",
      yc_tts_emotion: "neutral",
      yc_tts_lang: "ru-RU",
      yc_tts_speed: 1.0,
      openrouter: {
        api_key: "",
        base_url: "https://openrouter.ai/api/v1",
        stt_model: "nvidia/parakeet-tdt-0.6b-v3",
        tts_model: "google/gemini-3.1-flash-tts-preview",
        tts_voice: "Aoede",
        tts_format: "mp3",
        pcm_sample_rate: 24000,
        pcm_channels: 1,
        stt_format: "mp3",
        stt_language: "",
        referer: "",
        title: "",
      },
      tinfoil: {
        api_key: "",
        base_url: "",
        stt_model: "whisper-large-v3-turbo",
        tts_model: "qwen3-tts",
        tts_voice: "vivian",
        tts_instruct: "",
        stt_format: "mp3",
        stt_language: "",
      },
      xai: {
        api_key: "",
        base_url: "https://api.x.ai/v1",
        tts_voice: "eve",
        tts_language: "auto",
        tts_speed: 1.0,
        tts_format: "mp3",
        stt_format: "mp3",
        stt_language: "",
      },
    },
    ...overrides,
  } as SkyeConfig;
}

describe("speech transcodeAudio", () => {
  it("converts mp3 → ogg opus (OggS magic header)", async () => {
    const mp3 = await ffmpegSineMp3(0.4);
    const out = await transcodeAudio(mp3, "oggopus");
    expect(out.length).toBeGreaterThan(0);
    expect(out.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(oggOpusDurationSeconds(out)).toBeGreaterThan(0.3);
  });

  it("converts ogg opus → mp3", async () => {
    const mp3 = await ffmpegSineMp3(0.4);
    const ogg = await transcodeAudio(mp3, "oggopus");
    const back = await transcodeAudio(ogg, "mp3");
    expect(back.length).toBeGreaterThan(0);
  });
});

describe("speech module provider selection", () => {
  it("builds yandex provider by default", () => {
    const p = buildProvider(
      makeConfig({
        voice: {
          ...makeConfig().voice,
          yc_api_key: "key",
          yc_folder_id: "folder",
          yc_tts_voice: "jane",
        },
      })
    );
    expect(p).toBeInstanceOf(YandexSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
    expect(p.isTtsAvailable()).toBe(true);
  });

  it("disables yandex when api key is empty", () => {
    const p = buildProvider(makeConfig());
    expect(p.isSttAvailable()).toBe(false);
    expect(p.isTtsAvailable()).toBe(false);
  });

  it("builds openrouter provider with explicit key", () => {
    const p = buildProvider(
      makeConfig({
        openai_key: "",
        voice: {
          ...makeConfig().voice,
          provider: "openrouter",
          openrouter: {
            ...makeConfig().voice.openrouter,
            api_key: "or-key",
            base_url: "https://openrouter.ai/api/v1",
            stt_model: "openai/whisper-1",
            tts_model: "openai/tts-1",
          },
        },
      })
    );
    expect(p).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
    expect(p.isTtsAvailable()).toBe(true);
  });

  it("openrouter falls back to openai_key when voice key is empty", () => {
    const p = buildProvider(
      makeConfig({
        openai_key: "sk-fallback",
        voice: {
          ...makeConfig().voice,
          provider: "openrouter",
          openrouter: {
            ...makeConfig().voice.openrouter,
            api_key: "",
            stt_model: "openai/whisper-1",
            tts_model: "openai/tts-1",
          },
        },
      })
    );
    expect(p).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
  });

  it("openrouter disabled when no key and no model", () => {
    const p = buildProvider(
      makeConfig({
        openai_key: "",
        voice: {
          ...makeConfig().voice,
          provider: "openrouter",
          openrouter: {
            ...makeConfig().voice.openrouter,
            api_key: "",
            stt_model: "",
            tts_model: "",
          },
        },
      })
    );
    expect(p.isSttAvailable()).toBe(false);
    expect(p.isTtsAvailable()).toBe(false);
  });

  it("module init returns a SpeechService", () => {
    const ctx = {
      config: makeConfig({ voice: { ...makeConfig().voice, yc_api_key: "k" } }),
    } as never;
    const result = speechModule.init?.(ctx) as
      | {
          service?: { isSttAvailable: () => boolean };
        }
      | undefined;
    expect(result?.service).toBeDefined();
    expect(result?.service?.isSttAvailable()).toBe(true);
  });

  it("builds xai provider with explicit key", () => {
    const p = buildProvider(
      makeConfig({
        voice: {
          ...makeConfig().voice,
          provider: "xai",
          xai: {
            ...makeConfig().voice.xai,
            api_key: "xai-key",
          },
        },
      })
    );
    expect(p).toBeInstanceOf(XaiSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
    expect(p.isTtsAvailable()).toBe(true);
    expect(p.getTtsCapabilities().defaultVoice).toBe("eve");
  });

  it("xai falls back to top-level xai_api_key", () => {
    const p = buildProvider(
      makeConfig({
        xai_api_key: "global-xai",
        voice: {
          ...makeConfig().voice,
          provider: "xai",
          xai: {
            ...makeConfig().voice.xai,
            api_key: "",
          },
        },
      })
    );
    expect(p).toBeInstanceOf(XaiSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
  });
});

describe("expressive speech", () => {
  it("builds a Gemini director prompt around the exact transcript", () => {
    expect(
      buildGeminiTtsInput("[whispers] Секрет", {
        scene: "A quiet room at night",
        style: "Warm, slow and conspiratorial",
      })
    ).toBe(
      "## THE SCENE\nA quiet room at night\n\n## DIRECTOR'S NOTES\nWarm, slow and conspiratorial\n\n## TRANSCRIPT\n[whispers] Секрет"
    );
  });

  it("leaves a plain Gemini transcript unchanged", () => {
    expect(buildGeminiTtsInput("Привет", {})).toBe("Привет");
  });

  it("leaves xAI transcript unchanged and never speaks style/scene notes", () => {
    expect(buildXaiTtsText("Hello", {})).toBe("Hello");
    expect(buildXaiTtsText("Hello", { scene: "Quiet room", style: "soft" })).toBe("Hello");
  });

  it("xAI TTS posts voice_id/language and transcodes to OGG Opus", async () => {
    const mp3 = await ffmpegSineMp3(0.4);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(mp3), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new XaiSpeechProvider({
      apiKey: "xai-key",
      baseUrl: "https://api.x.ai/v1",
      ttsVoice: "ara",
      ttsLanguage: "en",
      ttsSpeed: 1.1,
      ttsFormat: "mp3",
      sttFormat: "mp3",
      sttLanguage: "",
    });

    const audio = await provider.synthesize("Hello from Grok", { voice: "leo" });
    expect(audio?.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/tts");
    expect(JSON.parse(String(init.body))).toMatchObject({
      text: "Hello from Grok",
      voice_id: "leo",
      language: "en",
      speed: 1.1,
    });
  });

  it("parses Gemini PCM rate and channels from the response header", () => {
    expect(parsePcmContentType("audio/pcm;rate=24000;channels=1")).toEqual({
      rate: 24000,
      channels: 1,
    });
  });

  it("rejects empty, too-short, and JSON TTS responses", () => {
    expect(validateTtsBytes(Buffer.alloc(0), "audio/pcm;rate=24000;channels=1", "pcm")).toBe(
      "empty response body"
    );
    expect(validateTtsBytes(Buffer.alloc(4_000), "audio/pcm;rate=24000;channels=1", "pcm")).toBe(
      "PCM response is shorter than 100 ms"
    );
    expect(validateTtsBytes(Buffer.from("{}"), "application/json", "pcm")).toBe(
      "unexpected application/json"
    );
  });

  it("retries an empty Gemini response and converts valid 24 kHz PCM to OGG Opus", async () => {
    const pcm = pcmSine();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { "Content-Type": "audio/pcm;rate=24000;channels=1" },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(pcm), {
          status: 200,
          headers: {
            "Content-Type": "audio/pcm;rate=24000;channels=1",
            "X-Generation-Id": "gen-test",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterSpeechProvider({
      apiKey: "key",
      baseUrl: "https://openrouter.ai/api/v1",
      sttModel: "stt",
      ttsModel: "google/gemini-3.1-flash-tts-preview",
      ttsVoice: "Aoede",
      ttsResponseFormat: "mp3",
      sttInputFormat: "mp3",
      sttLanguage: "",
      referer: "",
      title: "",
      pcmSampleRate: 24_000,
      pcmChannels: 1,
    });

    const audio = await provider.synthesize("Привет");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audio?.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(oggOpusDurationSeconds(audio!)).toBeGreaterThan(0.9);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).response_format).toBe("pcm");
  });

  it("retries a transient OpenRouter TTS error with the same expressive payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(new Response("invalid request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterSpeechProvider({
      apiKey: "key",
      baseUrl: "https://openrouter.ai/api/v1",
      sttModel: "stt",
      ttsModel: "google/gemini-3.1-flash-tts-preview",
      ttsVoice: "Aoede",
      ttsResponseFormat: "pcm",
      sttInputFormat: "mp3",
      sttLanguage: "",
      referer: "",
      title: "",
      pcmSampleRate: 24000,
      pcmChannels: 1,
    });

    await expect(
      provider.synthesize("[whispers] Секрет", {
        voice: "Sulafat",
        style: "Warm and slow",
        scene: "A quiet room",
      })
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(firstRequest.body))).toEqual({
      model: "google/gemini-3.1-flash-tts-preview",
      input:
        "## THE SCENE\nA quiet room\n\n## DIRECTOR'S NOTES\nWarm and slow\n\n## TRANSCRIPT\n[whispers] Секрет",
      voice: "Sulafat",
      response_format: "pcm",
    });
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(fetchMock.mock.calls[0]?.[1]);
  });

  it("aborts an in-flight OpenRouter TTS request without retrying", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const requestSignal = init?.signal;
          requestSignal?.addEventListener("abort", () => reject(requestSignal.reason), {
            once: true,
          });
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterSpeechProvider({
      apiKey: "key",
      baseUrl: "https://openrouter.ai/api/v1",
      sttModel: "stt",
      ttsModel: "google/gemini-3.1-flash-tts-preview",
      ttsVoice: "Aoede",
      ttsResponseFormat: "pcm",
      sttInputFormat: "mp3",
      sttLanguage: "",
      referer: "",
      title: "",
      pcmSampleRate: 24000,
      pcmChannels: 1,
    });
    const controller = new AbortController();
    const reason = new Error("cancelled");

    const synthesis = provider.synthesize("Привет", {}, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(reason);

    await expect(synthesis).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("combines persistent and per-call Tinfoil voice directions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("invalid request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TinfoilSpeechProvider({
      apiKey: "key",
      baseUrl: "https://inference.tinfoil.sh/v1",
      sttModel: "whisper-large-v3-turbo",
      ttsModel: "qwen3-tts",
      ttsVoice: "vivian",
      ttsInstruct: "A bright, friendly character",
      sttInputFormat: "mp3",
      sttLanguage: "",
    });

    await expect(
      provider.synthesize("Hello", {
        voice: "serena",
        scene: "A quiet studio",
        style: "Slow and warm",
      })
    ).resolves.toBeNull();

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      voice: "serena",
      instruct: "A bright, friendly character\nA quiet studio\nSlow and warm",
    });
  });

  it("prepares one voice note with a per-call voice and directions", async () => {
    const calls: { text: string; options?: SpeechSynthesisOptions }[] = [];
    const provider: SpeechProvider = {
      isSttAvailable: () => false,
      isTtsAvailable: () => true,
      recognize: async () => null,
      synthesize: async (text, options) => {
        calls.push({ text, options });
        return fakeOggDuration(1.5);
      },
      getTtsCapabilities: () => ({
        defaultVoice: "Aoede",
        voices: ["Aoede", "Sulafat"],
        expressive: true,
      }),
    };
    const prepared: Buffer[] = [];
    const tool = createSendVoiceTool({
      speech: new SpeechService(provider),
      mode: "auto",
      onPrepared: ({ audio }) => {
        prepared.push(audio);
      },
    });

    const result = await tool.execute(
      {
        text: "[excited] Поехали!",
        voice: "sulafat",
        style: "Warm and lively",
        scene: "A friendly studio",
      },
      {} as never
    );

    expect(result).toContain("prepared successfully");
    expect(calls).toEqual([
      {
        text: "[excited] Поехали!",
        options: {
          voice: "Sulafat",
          style: "Warm and lively",
          scene: "A friendly studio",
        },
      },
    ]);
    expect(prepared).toEqual([fakeOggDuration(1.5)]);
    await expect(tool.execute({ text: "Again" }, {} as never)).resolves.toContain(
      "already prepared"
    );
  });

  it("unwraps a nested send_voice JSON blob inside the text argument", async () => {
    const calls: { text: string; options?: SpeechSynthesisOptions }[] = [];
    const provider: SpeechProvider = {
      isSttAvailable: () => false,
      isTtsAvailable: () => true,
      recognize: async () => null,
      synthesize: async (text, options) => {
        calls.push({ text, options });
        return fakeOggDuration(1);
      },
      getTtsCapabilities: () => ({
        defaultVoice: "Aoede",
        voices: ["Aoede", "Sulafat"],
        expressive: true,
      }),
    };
    const tool = createSendVoiceTool({
      speech: new SpeechService(provider),
      mode: "auto",
      onPrepared: () => {},
    });

    await tool.execute(
      {
        text: '{"text":"Только это","voice":"sulafat","style":"bright","scene":"studio"}',
      },
      {} as never
    );

    expect(calls).toEqual([
      {
        text: "Только это",
        options: {
          voice: "Sulafat",
          style: "bright",
          scene: "studio",
        },
      },
    ]);
  });
});
