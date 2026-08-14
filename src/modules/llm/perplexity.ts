import type Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  InputItem,
  OutputItem,
  ResponseCreateParams,
  ResponseCreateResponse,
  ResponseStreamChunk,
} from "@perplexity-ai/perplexity_ai/resources/responses";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import { createPerplexityClient } from "../providers/perplexity.js";
import type { ProviderCredentials } from "../providers/types.js";
import type { LlmResponse, LlmStream, LlmUsage, PerplexitySource } from "./client.js";
import type { BuiltinTool } from "./config.js";

interface AgentRequest {
  model: string;
  instructions: string;
  input: string | ResponseInputItem[];
  maxOutputTokens: number;
  builtinTools?: readonly BuiltinTool[];
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  preset?: string;
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$id",
  "$schema",
  "default",
  "examples",
  "propertyNames",
  "title",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizePerplexitySchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePerplexitySchema);
  if (!isRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === "additionalProperties" && raw !== false) continue;
    if (key === "properties" && isRecord(raw)) {
      result.properties = Object.fromEntries(
        Object.entries(raw).map(([name, schema]) => [name, sanitizePerplexitySchema(schema)])
      );
      continue;
    }
    result[key] = sanitizePerplexitySchema(raw);
  }

  if ("const" in result) {
    if (!("enum" in result)) result.enum = [result.const];
    delete result.const;
  }

  const alternatives = result.anyOf;
  if (Array.isArray(alternatives) && alternatives.every(isRecord)) {
    const constants = alternatives.map((entry) =>
      Array.isArray(entry.enum) && entry.enum.length === 1 ? entry.enum[0] : undefined
    );
    const types = [...new Set(alternatives.map((entry) => entry.type))];
    if (constants.every((entry) => entry !== undefined) && types.length === 1) {
      delete result.anyOf;
      result.type = types[0];
      result.enum = constants;
    }
  }

  if (result.type === "array" && isRecord(result.items) && Object.keys(result.items).length === 0) {
    result.items = { type: "object", properties: {} };
  }

  if (result.type === "object" && !isRecord(result.properties)) result.properties = {};

  return result;
}

function agentError(error: { message: string; code?: string; type?: string }): Error {
  const metadata = [error.type, error.code].filter(Boolean).join(" / ");
  return new Error(metadata ? `${error.message} (${metadata})` : error.message);
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

export function toPerplexityInput(input: string | ResponseInputItem[]): string | InputItem[] {
  if (typeof input === "string") return input;
  const converted: InputItem[] = [];
  for (const raw of input) {
    const item = raw as unknown as Record<string, unknown>;
    if (item.type === "message") {
      const role =
        item.role === "assistant" || item.role === "system" || item.role === "developer"
          ? item.role
          : "user";
      const content = Array.isArray(item.content)
        ? item.content.map((rawPart) => {
            const part = rawPart as Record<string, unknown>;
            if (part.type === "input_image" && typeof part.image_url === "string") {
              return { type: "input_image" as const, image_url: part.image_url };
            }
            if (part.type === "input_file") {
              return {
                type: "input_text" as const,
                text: `[Attached file: ${String(part.filename ?? "document")}]`,
              };
            }
            return {
              type: "input_text" as const,
              text: typeof part.text === "string" ? part.text : stringifyContent(part),
            };
          })
        : stringifyContent(item.content);
      converted.push({ type: "message", role, content });
      continue;
    }
    if (item.type === "function_call") {
      converted.push({
        type: "function_call",
        call_id: String(item.call_id ?? crypto.randomUUID()),
        name: String(item.name ?? ""),
        arguments: String(item.arguments ?? "{}"),
        ...(typeof item.thought_signature === "string"
          ? { thought_signature: item.thought_signature }
          : {}),
      });
      continue;
    }
    if (item.type === "function_call_output") {
      converted.push({
        type: "function_call_output",
        call_id: String(item.call_id ?? ""),
        output: stringifyContent(item.output),
        ...(typeof item.name === "string" ? { name: item.name } : {}),
        ...(typeof item.thought_signature === "string"
          ? { thought_signature: item.thought_signature }
          : {}),
      });
    }
  }
  return converted;
}

function outputText(output: OutputItem[]): string {
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}

function sourcesFrom(output: OutputItem[]): PerplexitySource[] {
  const sources: PerplexitySource[] = [];
  for (const item of output) {
    if (item.type !== "search_results") continue;
    for (const result of item.results) {
      sources.push({ id: result.id, title: result.title, url: result.url });
    }
  }
  return sources;
}

function usageFrom(response: { usage?: ResponseCreateResponse["usage"] }): LlmUsage | undefined {
  return response.usage
    ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      }
    : undefined;
}

function normalizeResponse(response: ResponseCreateResponse, fallbackText = ""): LlmResponse {
  const output = response.output;
  return {
    output_text: response.output_text || outputText(output) || fallbackText,
    output: output as unknown as LlmResponse["output"],
    usage: usageFrom(response),
    sources: sourcesFrom(output),
  };
}

function requestParams(request: AgentRequest, stream: boolean): ResponseCreateParams {
  const builtinTools = request.builtinTools?.map((type) => ({ type })) ?? [];
  const functionTools =
    request.tools?.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description.slice(0, 1024),
      parameters: sanitizePerplexitySchema(tool.parameters) as Record<string, unknown>,
      strict: false,
    })) ?? [];
  return {
    input: toPerplexityInput(request.input),
    instructions: request.instructions,
    max_output_tokens: request.maxOutputTokens,
    stream,
    ...(request.preset ? { preset: request.preset } : { model: request.model }),
    ...(builtinTools.length || functionTools.length
      ? { tools: [...builtinTools, ...functionTools] }
      : {}),
  };
}

class PerplexityAgentStream implements LlmStream {
  private readonly listeners = new Set<(data: { snapshot: string }) => void>();
  private readonly finalPromise: Promise<LlmResponse>;

  constructor(private readonly streamPromise: ReturnType<Perplexity["responses"]["create"]>) {
    this.finalPromise = this.consume();
  }

  on(event: "response.output_text.delta", cb: (data: { snapshot: string }) => void): void {
    if (event === "response.output_text.delta") this.listeners.add(cb);
  }

  private async consume(): Promise<LlmResponse> {
    const stream = await this.streamPromise;
    if (!(Symbol.asyncIterator in stream)) {
      return normalizeResponse(stream as ResponseCreateResponse);
    }
    let snapshot = "";
    let completed: ResponseCreateResponse | null = null;
    const output = new Map<number, OutputItem>();
    for await (const event of stream as AsyncIterable<ResponseStreamChunk>) {
      if (event.type === "response.output_text.delta") {
        snapshot += event.delta;
        for (const listener of this.listeners) listener({ snapshot });
      } else if (event.type === "response.output_item.done") {
        output.set(event.output_index, event.item);
      } else if (event.type === "response.completed" && event.response) {
        completed = {
          ...event.response,
          output_text: outputText(event.response.output),
        };
      } else if (event.type === "response.failed") {
        throw agentError(event.error);
      }
    }
    if (completed) return normalizeResponse(completed, snapshot);
    const finalOutput = [...output.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
    return {
      output_text: outputText(finalOutput) || snapshot,
      output: finalOutput as unknown as LlmResponse["output"],
      sources: sourcesFrom(finalOutput),
    };
  }

  finalResponse(): Promise<LlmResponse> {
    return this.finalPromise;
  }

  async abort(): Promise<void> {
    const stream = await this.streamPromise;
    if (Symbol.asyncIterator in stream) {
      (stream as unknown as { controller?: AbortController }).controller?.abort();
    }
  }
}

export class PerplexityAgentAdapter {
  private readonly client: Perplexity;

  constructor(credentials: Pick<ProviderCredentials, "apiKey" | "baseUrl">) {
    this.client = createPerplexityClient(credentials);
  }

  async ask(request: AgentRequest): Promise<LlmResponse> {
    const response = await this.client.responses.create({
      ...requestParams(request, false),
      stream: false,
    });
    return normalizeResponse(response);
  }

  stream(request: AgentRequest): LlmStream {
    return new PerplexityAgentStream(
      this.client.responses.create({
        ...requestParams(request, true),
        stream: true,
      })
    );
  }
}
