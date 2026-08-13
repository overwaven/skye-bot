import { describe, expect, it } from "vitest";
import { llmConfigSchema } from "../config.js";

describe("LLM cost boundary", () => {
  it("allows large positive completion limits", () => {
    expect(
      llmConfigSchema.parse({ openai_key: "test", max_completion_tokens: 100_000 })
        .max_completion_tokens
    ).toBe(100_000);
    expect(() => llmConfigSchema.parse({ openai_key: "test", max_completion_tokens: 0 })).toThrow();
    expect(llmConfigSchema.parse({ openai_key: "test" }).max_completion_tokens).toBe(500);
  });
});

describe("xAI config", () => {
  it("defaults xai_base_url and accepts provider xai models", () => {
    const cfg = llmConfigSchema.parse({
      openai_key: "test",
      xai_api_key: "xai-key",
      models: [
        {
          id: "grok",
          name: "Grok",
          model: "grok-4.5",
          provider: "xai",
        },
      ],
      image: {
        provider: "xai",
        model: "grok-imagine-image-quality",
        resolution: "2k",
      },
    });
    expect(cfg.xai_base_url).toBe("https://api.x.ai/v1");
    expect(cfg.models[0].provider).toBe("xai");
    expect(cfg.image.provider).toBe("xai");
    expect(cfg.image.resolution).toBe("2k");
  });
});
