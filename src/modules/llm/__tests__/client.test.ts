import { afterEach, describe, expect, test, vi } from "vitest";
import { adaptChatCompletionStream, LlmClient } from "../client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat completions streaming", () => {
  test("captures usage when the final chunk also contains a delta", async () => {
    async function* chunks() {
      yield {
        choices: [{ delta: { content: "OK", role: "assistant" }, finish_reason: null }],
        usage: null,
      };
      yield {
        choices: [{ delta: { content: "", role: "assistant" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 16, completion_tokens: 2, total_tokens: 18 },
      };
    }

    const response = await adaptChatCompletionStream(Promise.resolve(chunks())).finalResponse();

    expect(response.usage).toEqual({ promptTokens: 16, completionTokens: 2 });
  });
});

function makeClient(
  overrides: Partial<ConstructorParameters<typeof LlmClient>[0]> = {}
): LlmClient {
  return new LlmClient({
    apiKey: "or-key",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      {
        id: "sydney",
        name: "Sydney",
        model: "google/gemini-flash",
        multiplier: 1,
        contextWindow: 128_000,
      },
    ],
    defaultModelId: "sydney",
    maxCompletionTokens: 500,
    useChatCompletions: false,
    imageApiKey: "",
    imageBaseUrl: "",
    imageModel: "google/gemini-3.1-flash-image-preview",
    pdfEngine: "",
    pdfMaxBytes: 25 * 1024 * 1024,
    perplexityBaseUrl: "https://api.perplexity.ai/v1",
    xaiBaseUrl: "https://api.x.ai/v1",
    ...overrides,
  });
}

describe("xAI image generation", () => {
  test("posts to /images/generations with b64_json", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("PNG").toString("base64") }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient({
      imageProvider: "xai",
      xaiApiKey: "xai-key",
      imageModel: "grok-imagine-image-quality",
      imageAspectRatio: "16:9",
      imageResolution: "2k",
    });

    const buf = await client.generateImage("a cat");
    expect(buf?.toString()).toBe("PNG");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/images/generations");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "grok-imagine-image-quality",
      prompt: "a cat",
      response_format: "b64_json",
      aspect_ratio: "16:9",
      resolution: "2k",
    });
    expect(init.headers).toMatchObject({ Authorization: "Bearer xai-key" });
  });

  test("edits a single reference via /images/edits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("EDIT").toString("base64") }] }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient({
      imageProvider: "xai",
      xaiApiKey: "xai-key",
      imageModel: "grok-imagine-image-quality",
    });

    await client.generateImage("make it blue", ["data:image/png;base64,abc"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/images/edits");
    const body = JSON.parse(String(init.body));
    expect(body.image).toEqual({ url: "data:image/png;base64,abc", type: "image_url" });
    expect(body.images).toBeUndefined();
  });

  test("edits multiple references via images[]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("MULTI").toString("base64") }] }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient({
      imageProvider: "xai",
      imageApiKey: "img-key",
      imageModel: "grok-imagine-image-quality",
    });

    await client.generateImage("combine", ["https://a/1.png", "https://a/2.png", "https://a/3.png"]);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.images).toHaveLength(3);
    expect(body.image).toBeUndefined();
  });

  test("auto-detects xAI from grok-imagine model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("X").toString("base64") }] }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient({
      xaiApiKey: "xai-key",
      imageModel: "grok-imagine-image-quality",
    });
    await client.generateImage("auto");
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("/images/generations");
  });
});

describe("xAI chat provider routing", () => {
  test("resolveModel preserves provider: xai", () => {
    const client = makeClient({
      xaiApiKey: "xai-key",
      models: [
        {
          id: "grok",
          name: "Grok",
          model: "grok-4.5",
          multiplier: 3,
          contextWindow: 500_000,
          provider: "xai",
        },
      ],
      defaultModelId: "grok",
    });
    expect(client.resolveModel("grok").provider).toBe("xai");
    expect(client.resolveModel("grok").model).toBe("grok-4.5");
  });

  test("use_chat_completions applies only to the default endpoint, not xAI", () => {
    const client = makeClient({
      useChatCompletions: true,
      xaiApiKey: "xai-key",
      models: [
        {
          id: "gemma",
          name: "Gemma",
          model: "google/gemma-4-e4b",
          multiplier: 1,
          contextWindow: 32_768,
        },
        {
          id: "grok",
          name: "Grok",
          model: "grok-4.5",
          multiplier: 3,
          contextWindow: 500_000,
          provider: "xai",
        },
      ],
      defaultModelId: "gemma",
    });
    expect(client.usesChatCompletions(client.resolveModel("gemma"))).toBe(true);
    expect(client.usesChatCompletions(client.resolveModel("grok"))).toBe(false);
  });
});
