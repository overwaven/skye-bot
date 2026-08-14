import { describe, expect, it } from "vitest";
import { providersConfigSchema } from "../config.js";

const provider = {
  id: "openrouter",
  name: "OpenRouter",
  kind: "openrouter" as const,
  base_url: "https://openrouter.ai/api/v1",
  api_key: "key",
};

describe("unified AI config", () => {
  it("accepts text, image, and audio models in one catalog", () => {
    const result = providersConfigSchema.parse({
      ai: {
        providers: [provider],
        models: [
          {
            id: "text",
            provider: provider.id,
            name: "Text",
            model: "text-model",
            capabilities: ["text", "vision"],
          },
          {
            id: "image",
            provider: provider.id,
            name: "Image",
            model: "image-model",
            capabilities: ["image_generation", "image_edit"],
          },
          {
            id: "voice",
            provider: provider.id,
            name: "Voice",
            model: "voice-model",
            capabilities: ["tts"],
            voice: "alloy",
          },
        ],
        defaults: { text: "text", image: "image", tts: "voice" },
      },
    });

    expect(result.ai.defaults.image).toBe("image");
    expect(result.ai.models).toHaveLength(3);
  });

  it("requires the shared image model to support generation and editing", () => {
    const result = providersConfigSchema.safeParse({
      ai: {
        providers: [provider],
        models: [
          {
            id: "image",
            provider: provider.id,
            name: "Image",
            model: "image-model",
            capabilities: ["image_generation"],
          },
        ],
        defaults: { image: "image" },
      },
    });

    expect(result.success).toBe(false);
  });
});
