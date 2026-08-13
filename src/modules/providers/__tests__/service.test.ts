import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../migrations.js";
import { ProviderService } from "../service.js";
import { LlmClient } from "../../llm/client.js";
import { SpeechService } from "../../speech/service.js";
import type { SpeechProvider } from "../../speech/types.js";

describe("ProviderService", () => {
  let db: Database.Database;
  let service: ProviderService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    for (const migration of migrations) migration.up(db);
    service = new ProviderService(db, "test-bot-token");
  });

  afterEach(() => db.close());

  it("stores server credentials without exposing them in provider responses", () => {
    const provider = service.createProvider({
      name: "OpenRouter",
      kind: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "secret-key",
    });

    expect(provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(provider.hasApiKey).toBe(true);
    expect(provider).not.toHaveProperty("apiKey");
    expect(service.getProviderCredentials(provider.id)?.apiKey).toBe("secret-key");
    const stored = db
      .prepare("SELECT api_key_enc AS value FROM ai_providers WHERE id = ?")
      .get(provider.id) as { value: string };
    expect(stored.value).not.toContain("secret-key");
  });

  it("updates the live text catalog without rebuilding the service", () => {
    const provider = service.createProvider({
      name: "xAI",
      kind: "xai",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "key",
    });
    expect(service.textCatalog()).toEqual([]);

    const model = service.createModel(provider.id, {
      name: "Grok",
      upstreamId: "grok-4",
      capabilities: ["text", "vision"],
      multiplier: 2,
    });

    expect(service.textCatalog()).toMatchObject([
      { id: model.id, name: "Grok", model: "grok-4", providerId: provider.id },
    ]);
    expect(service.getRouting().textModelId).toBe(model.id);

    const client = new LlmClient({
      apiKey: "legacy-unused",
      baseUrl: "https://legacy.example/v1",
      models: [],
      defaultModelId: "",
      maxCompletionTokens: 500,
      useChatCompletions: false,
      imageApiKey: "",
      imageBaseUrl: "",
      imageModel: "",
      pdfEngine: "",
      pdfMaxBytes: 1024,
      perplexityBaseUrl: "https://api.perplexity.ai/v1",
      xaiBaseUrl: "https://api.x.ai/v1",
      providers: service,
    });
    expect(client.models.map((entry) => entry.id)).toEqual([model.id]);

    service.deleteModel(model.id);
    expect(client.models).toEqual([]);
    expect(() => client.resolveModel()).toThrow("No text model is configured");
  });

  it("resolves independent image and voice choices per chat", () => {
    const provider = service.createProvider({
      name: "Multimodal",
      kind: "openai-compatible",
      baseUrl: "https://ai.example.com/v1",
      apiKey: "key",
    });
    const imageA = service.createModel(provider.id, {
      name: "Image A",
      upstreamId: "image-a",
      capabilities: ["image_generation", "image_edit"],
    });
    const imageB = service.createModel(provider.id, {
      name: "Image B",
      upstreamId: "image-b",
      capabilities: ["image_generation", "image_edit"],
    });
    const voice = service.createModel(provider.id, {
      name: "Voice",
      upstreamId: "voice-1",
      capabilities: ["tts"],
      config: { voice: "alloy" },
    });
    service.setDefaultRouting({
      imageGenerationModelId: imageA.id,
      imageEditModelId: imageA.id,
      ttsModelId: voice.id,
      ttsVoice: "alloy",
    });
    service.setChatRouting(-1001, {
      imageGenerationModelId: imageB.id,
      ttsVoice: "nova",
    });

    expect(service.resolve("image_generation", -1001)?.model.id).toBe(imageB.id);
    expect(service.resolve("image_edit", -1001)?.model.id).toBe(imageA.id);
    expect(service.getRouting(-1001).ttsVoice).toBe("nova");
    expect(service.getRouting(-2002).ttsVoice).toBe("alloy");

    const unavailableLegacySpeech: SpeechProvider = {
      isSttAvailable: () => false,
      isTtsAvailable: () => false,
      recognize: async () => null,
      synthesize: async () => null,
      getTtsCapabilities: () => ({ defaultVoice: "", expressive: false }),
    };
    const speech = new SpeechService(unavailableLegacySpeech, service);
    expect(speech.isTtsAvailable(-1001)).toBe(true);
    expect(speech.getTtsCapabilities(-1001).defaultVoice).toBe("nova");
  });

  it("clears routes immediately when a model or provider is deleted", () => {
    const provider = service.createProvider({
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key",
    });
    const model = service.createModel(provider.id, {
      name: "Image",
      upstreamId: "gpt-image-1",
      capabilities: ["image_generation"],
    });
    service.setChatRouting(42, { imageGenerationModelId: model.id });

    expect(service.deleteProvider(provider.id)).toBe(true);
    expect(service.getRouting(42).imageGenerationModelId).toBeNull();
    expect(service.resolve("image_generation", 42)).toBeNull();
  });
});
