import OpenAI from "openai";
import type {
  ResponseInputItem,
  ResponseFunctionToolCall,
} from "openai/resources/responses/responses.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { ModelEntry } from "./config.js";
import { log } from "../../utils/log.js";

export type { ResponseInputItem, ResponseFunctionToolCall };

export interface LlmModuleSettings {
  apiKey: string;
  baseUrl: string;
  models: readonly ModelEntry[];
  defaultModelId: string;
  maxCompletionTokens: number;
  useChatCompletions: boolean;
  imageProvider?: "openrouter" | "xai";
  imageApiKey: string;
  imageBaseUrl: string;
  imageModel: string;
  imageAspectRatio?: string;
  imageResolution?: "1k" | "2k" | "";
  pdfEngine: string;
  pdfMaxBytes: number;
  perplexityApiKey?: string;
  perplexityBaseUrl: string;
  xaiApiKey?: string;
  xaiBaseUrl: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

/** A web search source extracted from Perplexity's search_results output. */
export interface PerplexitySource {
  id: number;
  title?: string;
  url?: string;
}

/** Response shape compatible with both APIs. */
export interface LlmResponse {
  output_text: string;
  output: Array<{
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    [key: string]: unknown;
  }>;
  usage?: LlmUsage;
  /** Web search sources (Perplexity), used for footnote rendering. */
  sources?: PerplexitySource[];
}

/** Minimal streaming interface used by the chat loop. */
export interface LlmStream {
  on(event: "response.output_text.delta", cb: (data: { snapshot: string }) => void): void;
  finalResponse(): Promise<LlmResponse>;
  abort(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Chat Completions adapter — mimics the Responses API streaming interface
// ---------------------------------------------------------------------------

interface EmittedFnCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  [key: string]: unknown;
}

class ChatCompletionsStreamAdapter {
  private listeners = new Map<string, ((data: unknown) => void)[]>();
  private responsePromise: Promise<LlmResponse>;
  private resolveResponse!: (value: LlmResponse) => void;
  private rejectResponse!: (reason: unknown) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private streamPromise: Promise<any>;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamPromise: Promise<any>
  ) {
    this.responsePromise = new Promise((resolve, reject) => {
      this.resolveResponse = resolve;
      this.rejectResponse = reject;
    });
    this.streamPromise = streamPromise;
    this.process();
  }

  on(event: string, cb: (data: unknown) => void): void {
    const cbs = this.listeners.get(event) ?? [];
    cbs.push(cb as (data: unknown) => void);
    this.listeners.set(event, cbs);
  }

  private emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  private async process() {
    let text = "";
    let usage: LlmUsage | undefined;
    const tcMap = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      // Await the underlying SDK stream (Promise<Stream<ChatCompletionChunk>>)
      const stream = (await this
        .streamPromise) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
          };
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          this.emit("response.output_text.delta", { snapshot: text });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!tcMap.has(idx)) {
              tcMap.set(idx, { id: "", name: "", arguments: "" });
            }
            const acc = tcMap.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }
      }
    } catch (e) {
      log.warn(`Chat completions stream error: ${String(e)}`);
      this.rejectResponse(e);
      return;
    }

    const output: EmittedFnCall[] = [];
    for (const [, tc] of tcMap) {
      if (tc.name) {
        output.push({
          type: "function_call",
          call_id: tc.id || crypto.randomUUID(),
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    }

    this.resolveResponse({ output, output_text: text, usage });
  }

  async finalResponse(): Promise<LlmResponse> {
    return this.responsePromise;
  }

  /** Expose underlying stream for abort / teardown if needed. */
  async abort() {
    try {
      const s = await this.streamPromise;
      s?.controller?.abort?.();
    } catch {
      // ignore
    }
  }
}

export function adaptChatCompletionStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamPromise: Promise<any>
): LlmStream {
  return new ChatCompletionsStreamAdapter(streamPromise) as unknown as LlmStream;
}

// ---------------------------------------------------------------------------
// Responses-API stream adapter — normalizes the OpenAI Response into our
// LlmResponse shape and surfaces token usage.
// ---------------------------------------------------------------------------

class ResponsesStreamAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<string, ((data: any) => void)[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runner: any;
  private sourceExtractor?: (output: LlmResponse["output"]) => PerplexitySource[];

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: any,
    sourceExtractor?: (output: LlmResponse["output"]) => PerplexitySource[]
  ) {
    this.runner = runner;
    this.sourceExtractor = sourceExtractor;
    runner.on("response.output_text.delta", (data: { snapshot: string }) =>
      this.emit("response.output_text.delta", data)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (data: any) => void): void {
    const cbs = this.listeners.get(event) ?? [];
    cbs.push(cb);
    this.listeners.set(event, cbs);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  async finalResponse(): Promise<LlmResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await this.runner.finalResponse();
    const usage: LlmUsage | undefined = res?.usage
      ? {
          promptTokens: (res.usage.input_tokens as number) ?? 0,
          completionTokens: (res.usage.output_tokens as number) ?? 0,
        }
      : undefined;
    const output = (res?.output as LlmResponse["output"]) ?? [];
    return {
      output_text: (res?.output_text as string) ?? "",
      output,
      usage,
      sources: this.sourceExtractor ? this.sourceExtractor(output) : undefined,
    };
  }

  async abort(): Promise<void> {
    await this.runner.abort?.();
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Convert Responses API content parts to Chat Completions content. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertContent(content: any): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    // Object content (our metadata records) cannot be sent to chat providers
    // — coerce to a string to avoid "invalid message content type" errors.
    try {
      return typeof content?.toString === "function" ? String(content) : JSON.stringify(content);
    } catch {
      return "";
    }
  }
  return content.map((part: { type: string; text?: string; image_url?: string; file_data?: string; filename?: string }) => {
    if (part.type === "input_text") return { type: "text", text: part.text };
    if (part.type === "input_image" && part.image_url) {
      return { type: "image_url", image_url: { url: part.image_url } };
    }
    if (part.type === "input_file" && part.file_data) {
      return {
        type: "file",
        file: { filename: part.filename ?? "document", file_data: part.file_data },
      };
    }
    return part;
  });
}

/** Convert ResponseInputItem[] + instructions → ChatCompletionMessageParam[]. */
function toChatMessages(
  input: ResponseInputItem[],
  instructions: string
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];

  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }

  let i = 0;
  while (i < input.length) {
    const item = input[i] as {
      type: string;
      role?: string;
      content?: unknown;
      call_id?: string;
      name?: string;
      arguments?: string;
      output?: string;
    };

    if (item.type === "message") {
      const role = (item.role ?? "user") as "user" | "assistant" | "system" | "developer";
      messages.push({ role, content: convertContent(item.content) });
      i++;
    } else if (item.type === "function_call") {
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
      while (i < input.length) {
        const fc = input[i] as {
          type: string;
          call_id?: string;
          name?: string;
          arguments?: string;
        };
        if (fc.type !== "function_call") break;
        toolCalls.push({
          id: fc.call_id ?? crypto.randomUUID(),
          type: "function" as const,
          function: { name: fc.name ?? "", arguments: fc.arguments ?? "{}" },
        });
        i++;
      }
      messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
    } else if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id ?? "",
        content: String(item.output ?? ""),
      });
      i++;
    } else {
      i++;
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// LlmClient
// ---------------------------------------------------------------------------

/**
 * Stateful LLM client bound to module config. The bot runs on the server's
 * global OpenAI key; users pick a masked model tier (Sydney/Tokyo/etc.) whose
 * real provider id and token multiplier are configured by the operator.
 */
export class LlmClient {
  readonly models: readonly ModelEntry[];
  private readonly modelById: Map<string, ModelEntry>;
  readonly defaultModelId: string;
  private defaultClient: OpenAI;
  private perplexityClient: OpenAI | null = null;
  private xaiClient: OpenAI | null = null;

  constructor(public readonly settings: LlmModuleSettings) {
    this.models = settings.models;
    this.modelById = new Map(settings.models.map((m) => [m.id, m]));
    this.defaultModelId = settings.defaultModelId;
    this.defaultClient = new OpenAI({
      baseURL: settings.baseUrl,
      apiKey: settings.apiKey,
    });
  }

  /** Resolve a masked model id to its catalog entry, falling back to default. */
  resolveModel(modelId?: string): ModelEntry {
    const fallback = this.settings.models[0];
    if (!modelId) return fallback;
    return this.modelById.get(modelId) ?? fallback;
  }

  /**
   * Whether this catalog entry should use Chat Completions instead of Responses.
   * Global `use_chat_completions` only applies to the default OpenAI-compatible
   * endpoint (OpenRouter / LM Studio / Ollama). Perplexity and xAI always use
   * Responses so they can run side-by-side with a chat-completions local server.
   */
  usesChatCompletions(entry?: ModelEntry): boolean {
    const resolved = entry ?? this.resolveModel();
    if (resolved.provider === "perplexity" || resolved.provider === "xai") return false;
    return this.settings.useChatCompletions;
  }

  /** Get the OpenAI SDK client for a model's provider. */
  private clientFor(entry: ModelEntry): OpenAI {
    if (entry.provider === "perplexity") {
      if (!this.perplexityClient) {
        if (!this.settings.perplexityApiKey) {
          throw new Error(
            'A model with provider: "perplexity" is configured but perplexity_api_key is not set.'
          );
        }
        this.perplexityClient = new OpenAI({
          baseURL: this.settings.perplexityBaseUrl,
          apiKey: this.settings.perplexityApiKey,
        });
      }
      return this.perplexityClient;
    }
    if (entry.provider === "xai") {
      if (!this.xaiClient) {
        if (!this.settings.xaiApiKey) {
          throw new Error(
            'A model with provider: "xai" is configured but xai_api_key is not set.'
          );
        }
        this.xaiClient = new OpenAI({
          baseURL: this.settings.xaiBaseUrl,
          apiKey: this.settings.xaiApiKey,
        });
      }
      return this.xaiClient;
    }
    return this.defaultClient;
  }

  /** Extract web search sources from Perplexity search_results output items. */
  private extractSources(output: LlmResponse["output"]): PerplexitySource[] {
    const sources: PerplexitySource[] = [];
    for (const item of output) {
      if (item.type !== "search_results") continue;
      const results = (item as { results?: Array<{ id?: number; title?: string; url?: string }> }).results;
      if (!Array.isArray(results)) continue;
      for (const r of results) {
        if (r.url) sources.push({ id: r.id ?? sources.length + 1, title: r.title, url: r.url });
      }
    }
    return sources;
  }

  /** One-shot non-streaming call. */
  async ask(
    instructions: string,
    input: string,
    modelId?: string
  ): Promise<LlmResponse> {
    const entry = this.resolveModel(modelId);
    const client = this.clientFor(entry);
    if (this.usesChatCompletions(entry)) {
      const completion = await client.chat.completions.create({
        model: entry.model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
        max_tokens: this.settings.maxCompletionTokens,
      });
      const usage = completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens ?? 0,
            completionTokens: completion.usage.completion_tokens ?? 0,
          }
        : undefined;
      return {
        output_text: completion.choices[0]?.message?.content ?? "",
        output: [],
        usage,
      };
    }
    const builtinTools = entry.builtinTools?.map((t) => ({ type: t })) ?? [];
    const res = await client.responses.create({
      model: entry.model,
      instructions,
      input,
      max_output_tokens: this.settings.maxCompletionTokens,
      ...(builtinTools.length > 0 ? { tools: builtinTools } : {}),
      ...(entry.preset ? { preset: entry.preset } : {}),
    } as Record<string, unknown>);
    const usage = res.usage
      ? {
          promptTokens: res.usage.input_tokens ?? 0,
          completionTokens: res.usage.output_tokens ?? 0,
        }
      : undefined;
    const output = res.output as unknown as LlmResponse["output"];
    return {
      output_text: res.output_text,
      output,
      usage,
      sources: this.extractSources(output),
    };
  }

  /** Streaming response. Caller drives events / awaits .finalResponse(). */
  askStream(
    instructions: string,
    input: ResponseInputItem[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[],
    modelId?: string
  ): LlmStream {
    const entry = this.resolveModel(modelId);
    if (this.usesChatCompletions(entry)) {
      return this.askStreamViaChat(instructions, input, tools, modelId);
    }
    return this.askStreamViaResponses(instructions, input, tools, modelId) as unknown as LlmStream;
  }

  private askStreamViaResponses(
    instructions: string,
    input: ResponseInputItem[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[],
    modelId?: string
  ) {
    const entry = this.resolveModel(modelId);
    const client = this.clientFor(entry);
    const openaiTools = tools?.length
      ? tools.map((t) => ({
          type: "function" as const,
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: false,
        }))
      : undefined;
    const builtinTools = entry.builtinTools?.map((t) => ({ type: t })) ?? [];
    const allTools = [...builtinTools, ...(openaiTools ?? [])];
    const plugins = this.buildPluginsParam(input);
    const runner = client.responses.stream({
      model: entry.model,
      instructions,
      input,
      max_output_tokens: this.settings.maxCompletionTokens,
      ...(allTools.length > 0 ? { tools: allTools } : {}),
      ...(entry.preset ? { preset: entry.preset } : {}),
      ...(plugins ? ({ plugins } as Record<string, unknown>) : {}),
    } as Record<string, unknown>);
    return new ResponsesStreamAdapter(runner, (output) => this.extractSources(output));
  }

  private askStreamViaChat(
    instructions: string,
    input: ResponseInputItem[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[],
    modelId?: string
  ): LlmStream {
    const entry = this.resolveModel(modelId);
    const client = this.clientFor(entry);
    const messages = toChatMessages(input, instructions);

    const chatTools = tools?.length
      ? tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    const pluginsParam = this.buildPluginsParam(input);

    const streamPromise = client.chat.completions.create({
      model: entry.model,
      messages,
      max_tokens: this.settings.maxCompletionTokens,
      ...(chatTools ? { tools: chatTools } : {}),
      ...(pluginsParam ? (pluginsParam as Record<string, unknown>) : {}),
      stream: true,
      stream_options: { include_usage: true },
    } as Parameters<typeof client.chat.completions.create>[0]);

    return adaptChatCompletionStream(streamPromise);
  }

  /** Probe the provider's /models once to learn image capability. */
  async checkCapabilities(): Promise<void> {
    try {
      const entry = this.resolveModel(this.defaultModelId);
      const baseUrl =
        entry.provider === "perplexity"
          ? this.settings.perplexityBaseUrl
          : entry.provider === "xai"
            ? this.settings.xaiBaseUrl
            : this.settings.baseUrl;
      const apiKey =
        entry.provider === "perplexity"
          ? this.settings.perplexityApiKey
          : entry.provider === "xai"
            ? this.settings.xaiApiKey
            : this.settings.apiKey;
      const res = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) {
        log.warn(`Models endpoint returned ${res.status}, skipping capability check`);
        return;
      }
      const data = await res.json();
      const ids = new Set(
        (data.data as { id: string }[])?.map((m) => m.id) ?? []
      );
      const found = (data.data as { id: string; architecture?: { modality?: string } }[])?.find(
        (m) => m.id === entry.model
      );
      if (found) {
        const modality = found.architecture?.modality ?? "";
        // xAI Grok chat models accept image inputs even when modality metadata is absent.
        this.supportsImagesCache =
          entry.provider === "xai" || modality.toLowerCase().includes("image");
        log.info(
          `Model "${entry.model}" image support: ${this.supportsImagesCache} (modality: "${modality}")`
        );
      } else if (ids.size > 0) {
        log.warn(`Model "${entry.model}" not found in models list`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`Could not fetch model capabilities: ${msg}`);
    }
  }

  private supportsImagesCache: boolean | null = null;

  /** Cached result of checkCapabilities — null if unknown. */
  supportsImages(): boolean | null {
    return this.supportsImagesCache;
  }

  /**
   * Build the OpenRouter `plugins` parameter for file parsing, but only if
   * the input contains file parts. Returns an object to spread or undefined.
   */
  private buildPluginsParam(
    input: ResponseInputItem[]
  ): { plugins: unknown[] } | undefined {
    if (!this.settings.pdfEngine) return undefined;
    const hasFile = input.some((item) => {
      const m = item as { type?: string; content?: unknown };
      if (m.type !== "message" || !Array.isArray(m.content)) return false;
      return (m.content as { type: string }[]).some((p) => p.type === "input_file");
    });
    if (!hasFile) return undefined;
    return {
      plugins: [{ id: "file-parser", pdf: { engine: this.settings.pdfEngine } }],
    };
  }

  /**
   * Generate (or edit) an image via the configured image provider.
   * Uses IMAGE_BASE_URL/IMAGE_API_KEY when set, otherwise falls back to the
   * main chat creds (or xAI creds when image.provider is "xai"). Always uses
   * IMAGE_MODEL. Image generation is a server-level capability, not metered
   * per user model tier.
   */
  async generateImage(
    prompt: string,
    imageUrls?: string[],
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    if (this.resolveImageProvider() === "xai") {
      return this.generateImageViaXai(prompt, imageUrls, signal);
    }
    return this.generateImageViaOpenRouter(prompt, imageUrls, signal);
  }

  private resolveImageProvider(): "openrouter" | "xai" {
    if (this.settings.imageProvider === "xai") return "xai";
    if (this.settings.imageProvider === "openrouter") return "openrouter";
    const base = (this.settings.imageBaseUrl || "").toLowerCase();
    const model = this.settings.imageModel.toLowerCase();
    if (base.includes("api.x.ai") || model.startsWith("grok-imagine")) return "xai";
    return "openrouter";
  }

  private imageAuth(): { apiKey: string; baseUrl: string } {
    if (this.resolveImageProvider() === "xai") {
      const apiKey =
        this.settings.imageApiKey || this.settings.xaiApiKey || this.settings.apiKey;
      const baseUrl =
        this.settings.imageBaseUrl || this.settings.xaiBaseUrl || "https://api.x.ai/v1";
      return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
    }
    return {
      apiKey: this.settings.imageApiKey || this.settings.apiKey,
      baseUrl: (this.settings.imageBaseUrl || this.settings.baseUrl).replace(/\/$/, ""),
    };
  }

  private async generateImageViaOpenRouter(
    prompt: string,
    imageUrls?: string[],
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    const { apiKey, baseUrl } = this.imageAuth();

    const body: Record<string, unknown> = {
      model: this.settings.imageModel,
      prompt,
    };
    if (imageUrls && imageUrls.length > 0) {
      body.input_references = imageUrls.map((url) => ({
        type: "image_url",
        image_url: { url },
      }));
    }

    const res = await fetch(`${baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Image generation failed (${res.status}): ${text}`);
    }

    const data: { data?: { b64_json?: string; url?: string }[] } = await res.json();
    return this.bufferFromImageData(data.data?.[0], signal);
  }

  /**
   * Grok Imagine: POST /images/generations or /images/edits.
   * @see https://docs.x.ai/developers/model-capabilities/images/generation
   * @see https://docs.x.ai/developers/model-capabilities/images/editing
   */
  private async generateImageViaXai(
    prompt: string,
    imageUrls?: string[],
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    const { apiKey, baseUrl } = this.imageAuth();
    if (!apiKey) {
      throw new Error('image.provider is "xai" but no xai_api_key / image.api_key is set.');
    }

    const refs = (imageUrls ?? []).slice(0, 3);
    const body: Record<string, unknown> = {
      model: this.settings.imageModel || "grok-imagine-image-quality",
      prompt,
      response_format: "b64_json",
    };
    if (this.settings.imageAspectRatio) {
      body.aspect_ratio = this.settings.imageAspectRatio;
    }
    if (this.settings.imageResolution === "1k" || this.settings.imageResolution === "2k") {
      body.resolution = this.settings.imageResolution;
    }

    let path = "/images/generations";
    if (refs.length === 1) {
      path = "/images/edits";
      body.image = { url: refs[0], type: "image_url" };
    } else if (refs.length > 1) {
      path = "/images/edits";
      body.images = refs.map((url) => ({ url, type: "image_url" }));
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`xAI image generation failed (${res.status}): ${text}`);
    }

    const data: { data?: { b64_json?: string; url?: string }[] } = await res.json();
    return this.bufferFromImageData(data.data?.[0], signal);
  }

  private async bufferFromImageData(
    item: { b64_json?: string; url?: string } | undefined,
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    if (!item) return null;
    if (item.b64_json) return Buffer.from(item.b64_json, "base64");
    if (item.url) {
      const imgRes = await fetch(item.url, { signal });
      if (!imgRes.ok) {
        throw new Error(`Failed to download generated image (${imgRes.status})`);
      }
      return Buffer.from(await imgRes.arrayBuffer());
    }
    return null;
  }
}
