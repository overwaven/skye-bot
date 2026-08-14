import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PerplexityAgentAdapter,
  sanitizePerplexitySchema,
  toPerplexityInput,
} from "../perplexity.js";
import { fetchPerplexityModels, perplexitySdkBaseUrl } from "../../providers/perplexity.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function agentResponse(text: string) {
  return {
    id: "resp_test",
    created_at: 1_800_000_000,
    model: "perplexity/sonar",
    object: "response",
    status: "completed",
    output: [
      {
        type: "search_results",
        queries: ["latest test"],
        results: [
          {
            id: 1,
            title: "Official source",
            url: "https://example.com/source",
            snippet: "Result",
            source: "web",
          },
        ],
      },
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
  };
}

describe("Perplexity Agent API adapter", () => {
  it("normalizes connector schemas to the Agent API function-tool subset", () => {
    expect(
      sanitizePerplexitySchema({
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "Request",
        type: "object",
        properties: {
          operation: {
            anyOf: [
              { type: "string", const: "add" },
              { type: "string", const: "delete" },
            ],
          },
          values: {
            type: "object",
            propertyNames: { type: "string" },
            additionalProperties: { type: "string" },
          },
          looseObject: { type: "object", additionalProperties: true },
          closedObject: { type: "object", additionalProperties: false },
          looseArray: { type: "array", items: {} },
          title: { type: "string", title: "Document title" },
          default: { type: "string", default: "standard" },
          count: { type: "number", default: 10, examples: [5] },
        },
      })
    ).toEqual({
      type: "object",
      properties: {
        operation: { type: "string", enum: ["add", "delete"] },
        values: { type: "object", properties: {} },
        looseObject: { type: "object", properties: {} },
        closedObject: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        looseArray: {
          type: "array",
          items: { type: "object", properties: {} },
        },
        title: { type: "string" },
        default: { type: "string" },
        count: { type: "number" },
      },
    });
  });

  it("normalizes the panel's /v1 URL for the official SDK and model discovery", async () => {
    expect(perplexitySdkBaseUrl("https://api.perplexity.ai/v1")).toBe("https://api.perplexity.ai");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "perplexity/sonar" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPerplexityModels({ apiKey: "pplx-test", baseUrl: "https://api.perplexity.ai/v1" })
    ).resolves.toEqual([{ id: "perplexity/sonar" }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.perplexity.ai/v1/models");
  });

  it("uses the official SDK Responses interface with Agent API models and tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(agentResponse("Grounded answer")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new PerplexityAgentAdapter({
      apiKey: "pplx-test",
      baseUrl: "https://api.perplexity.ai/v1",
    });
    const result = await adapter.ask({
      model: "perplexity/sonar",
      instructions: "Be concise.",
      input: "What changed?",
      maxOutputTokens: 200,
      builtinTools: ["web_search", "fetch_url"],
      tools: [{ name: "remember", description: "Save a fact", parameters: { type: "object" } }],
    });

    expect(result.output_text).toBe("Grounded answer");
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
    expect(result.sources).toEqual([
      { id: 1, title: "Official source", url: "https://example.com/source" },
    ]);
    const [request, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(request)).toBe("https://api.perplexity.ai/v1/responses");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "perplexity/sonar",
      input: "What changed?",
      instructions: "Be concise.",
      max_output_tokens: 200,
      stream: false,
    });
    expect(body.tools).toEqual([
      { type: "web_search" },
      { type: "fetch_url" },
      {
        type: "function",
        name: "remember",
        description: "Save a fact",
        parameters: { type: "object", properties: {} },
        strict: false,
      },
    ]);
  });

  it("preserves function calls and results across Agent API rounds", () => {
    expect(
      toPerplexityInput([
        {
          type: "function_call",
          call_id: "call_1",
          name: "remember",
          arguments: '{"fact":"blue"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "saved",
        },
      ] as never)
    ).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "remember",
        arguments: '{"fact":"blue"}',
      },
      { type: "function_call_output", call_id: "call_1", output: "saved" },
    ]);
  });

  it("normalizes official SDK streaming events for the chat loop", async () => {
    const completed = agentResponse("Hello world");
    const events = [
      {
        type: "response.output_text.delta",
        delta: "Hello ",
        sequence_number: 1,
        item_id: "msg_test",
        output_index: 0,
        content_index: 0,
      },
      {
        type: "response.output_text.delta",
        delta: "world",
        sequence_number: 2,
        item_id: "msg_test",
        output_index: 0,
        content_index: 0,
      },
      { type: "response.completed", sequence_number: 3, response: completed },
    ];
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      )
    );
    const adapter = new PerplexityAgentAdapter({
      apiKey: "pplx-test",
      baseUrl: "https://api.perplexity.ai/v1",
    });
    const stream = adapter.stream({
      model: "perplexity/sonar",
      instructions: "",
      input: "Hello",
      maxOutputTokens: 100,
    });
    const snapshots: string[] = [];
    stream.on("response.output_text.delta", ({ snapshot }) => snapshots.push(snapshot));

    await expect(stream.finalResponse()).resolves.toMatchObject({
      output_text: "Hello world",
      usage: { promptTokens: 12, completionTokens: 3 },
    });
    expect(snapshots).toEqual(["Hello ", "Hello world"]);
  });
});
