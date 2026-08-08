import type { LlmClient, ResponseInputItem, PerplexitySource } from "../llm/client.js";
import type { ConnectorService } from "../connectors/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { ChatConfigService } from "../chatConfig/service.js";
import type { SandboxService } from "../sandbox/service.js";
import type { RemindersService } from "../reminders/service.js";
import type { ChannelService } from "../channel/service.js";
import type { StickersService } from "../stickers/service.js";
import type { ToolDefinition } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import { threadKey } from "../../core/tenant.js";
import { buildSystemPrompt } from "../llm/prompt.js";
import { parseTextEncodedToolCall, safeJsonParse, type ToolCallRecord } from "./helpers.js";
import { log } from "../../utils/log.js";
import { unwrapTextEnvelope } from "../../utils/markdown.js";
import type { AgentProfile } from "../agentRuntime/config.js";
import type { UserAgentService } from "../agentRuntime/userAgents.js";
import type { ChatAgentService } from "../agentRuntime/chatAgents.js";

export interface ChatLoopDeps {
  llm: LlmClient;
  connectors: ConnectorService;
  memory: MemoryService;
  chatLog: ChatLogService;
  userConfig: UserConfigService;
  chatConfig: ChatConfigService;
  sandbox?: SandboxService;
  reminders?: RemindersService;
  channel?: ChannelService;
  stickers?: StickersService;
  userAgents?: UserAgentService;
  chatAgents?: ChatAgentService;
  builtinTools: ToolDefinition[];
  allowConnectorTools?: boolean;
  hasReferenceImages?: boolean;
  /** Masked model id to run this turn on (resolved from the user's billing account). */
  modelId?: string;
  /** Meter one LLM round-trip's token usage against the caller's quota. */
  beforeRound?: (modelId: string) => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number }, modelId: string) => void;
  /** Bot owner info (name + Telegram handle) to weight in the system prompt. */
  owner?: { name: string; tag: string };
  acceptEmptyFinal?: () => boolean;
  resolveActiveAgent?: (tenant: TenantContext) => AgentProfile | undefined;
}

export const MAX_TOOL_ITERATIONS = 20;

/**
 * Run the streaming Responses-API tool-call loop until the model returns a
 * final text response, with a final synthesis round after the tool iteration cap. Tool calls — both
 * built-in and connector tools are executed, fed back, and surfaced via the
 * onToolCalls callback for UI rendering.
 *
 * Every step (assistant function calls, tool outputs, final assistant text)
 * is persisted to the chatLog so Skye retains full conversational context —
 * including failed tool calls — across restarts.
 */
export async function runChatLoop(
  deps: ChatLoopDeps,
  tenant: TenantContext,
  input: ResponseInputItem[],
  onChunk?: (snapshot: string) => void,
  onToolCalls?: (calls: ToolCallRecord[]) => void,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();
  const memoryQuery = extractInputText(input);
  const memories = deps.memory.context(tenant.chatId, memoryQuery, 12);
  const chatContext = deps.chatLog.context(tenant.chatId, tenant.threadId);
  const connectorTools =
    deps.allowConnectorTools === false ? [] : await deps.connectors.toolsFor(tenant.userId);
  const connectorToolNames = connectorTools.map((t) => t.name);
  const tk = threadKey(tenant);

  const chatAddendum = deps.chatConfig.getPrompt(tenant.chatId, tenant.threadId);
  const activeAgent = deps.resolveActiveAgent?.(tenant);
  const modelEntry = deps.llm.resolveModel(
    activeAgent?.model_id && deps.llm.models.some((m) => m.id === activeAgent.model_id)
      ? activeAgent.model_id
      : deps.modelId
  );
  const builtinTools = modelEntry.builtinTools;
  const hasBuiltinSandbox = builtinTools?.includes("sandbox") ?? false;

  // Filter out Daytona sandbox client-side tools when the model has a
  // built-in Perplexity sandbox — no need to offer both.
  const effectiveBuiltinTools = hasBuiltinSandbox
    ? deps.builtinTools.filter((t) => !t.name.startsWith("sandbox_"))
    : deps.builtinTools;
  const effectiveTools = [
    ...effectiveBuiltinTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    ...connectorTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  ];

  const chatStickers = deps.stickers?.list(tenant.chatId) ?? [];
  const instructions = buildSystemPrompt(
    memories,
    chatContext,
    connectorToolNames,
    deps.sandbox?.isEnabled(),
    deps.hasReferenceImages,
    !!deps.reminders,
    activeAgent?.name ?? modelEntry.name,
    builtinTools,
    deps.owner,
    !!deps.channel,
    activeAgent?.instructions,
    chatAddendum,
    chatStickers.map((s) => ({
      id: s.id,
      description: s.description,
      ...(s.emoji ? { emoji: s.emoji } : {}),
    })),
    activeAgent?.name
  );

  // Log the request summary (last user item text + attachments).
  const lastItem = input[input.length - 1];
  let requestSummary = "";
  const requestAttachments: string[] = [];
  if (lastItem?.type === "message" && Array.isArray(lastItem.content)) {
    for (const part of lastItem.content as { type: string; text?: string }[]) {
      if (part.type === "input_text") requestSummary += part.text ?? "";
      else if (part.type === "input_image") requestAttachments.push("image");
      else requestAttachments.push(part.type);
    }
    requestSummary = requestSummary.slice(0, 200);
  } else if (
    lastItem?.type === "message" &&
    typeof (lastItem as { content?: unknown }).content === "string"
  ) {
    requestSummary = (lastItem as { content: string }).content.slice(0, 200);
  }
  log.info(
    { chatId: tenant.chatId, requestSummary, requestAttachments, toolCount: effectiveTools.length },
    "LLM request"
  );

  const currentInput: ResponseInputItem[] = [...input];
  let toolIterations = 0;

  while (true) {
    signal?.throwIfAborted();
    const canCallTools = toolIterations < MAX_TOOL_ITERATIONS;
    const roundInstructions = canCallTools
      ? instructions
      : `${instructions}\n\n## Tool limit reached\n\nDo not call any more tools. Use the tool results already available and give the user your best complete final answer now.`;
    deps.beforeRound?.(modelEntry.id);
    const stream = deps.llm.askStream(
      roundInstructions,
      currentInput,
      canCallTools && effectiveTools.length > 0 ? effectiveTools : undefined,
      modelEntry.id
    );
    const abortStream = () => void stream.abort();
    signal?.addEventListener("abort", abortStream, { once: true });

    if (onChunk) {
      stream.on("response.output_text.delta", (event) => onChunk(event.snapshot));
    }

    let response;
    try {
      response = await stream.finalResponse();
    } finally {
      signal?.removeEventListener("abort", abortStream);
    }

    if (response.usage && deps.onUsage) deps.onUsage(response.usage, modelEntry.id);

    const fnCalls = response.output.filter((item) => item.type === "function_call") as Array<{
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }>;

    if (canCallTools && fnCalls.length === 0) {
      const textCall = parseTextEncodedToolCall(
        extractFinalText(response),
        new Set(effectiveTools.map((tool) => tool.name))
      );
      if (textCall) {
        fnCalls.push({
          type: "function_call",
          call_id: crypto.randomUUID(),
          ...textCall,
        });
        log.warn(
          { chatId: tenant.chatId, tool: textCall.name, model: modelEntry.model },
          "Recovered text-encoded tool call"
        );
      }
    }

    if (!canCallTools && fnCalls.length > 0) {
      log.warn(
        { chatId: tenant.chatId, model: modelEntry.model, toolIterations },
        "Model requested another tool after reaching the iteration limit"
      );
      fnCalls.length = 0;
    }

    if (fnCalls.length === 0) {
      const finalText = unwrapTextEnvelope(extractFinalText(response));
      const textWithCitations = appendCitations(finalText, response.sources);
      if (!textWithCitations && !canCallTools) {
        throw new Error(
          `Model did not produce a final response after ${MAX_TOOL_ITERATIONS} tool iterations`
        );
      }
      if (textWithCitations) {
        deps.chatLog.appendConversation(tenant.chatId, tk, {
          role: "assistant",
          content: textWithCitations,
          text: textWithCitations,
        });
      }
      return textWithCitations;
    }

    // Persist assistant function calls so tool usage survives restarts.
    for (const fc of fnCalls) {
      signal?.throwIfAborted();
      const summary = summarizeFunctionCall(fc.name, fc.arguments);
      deps.chatLog.appendConversation(tenant.chatId, tk, {
        role: "assistant",
        content: fc as unknown,
        text: summary,
      });
    }

    const toolOutputItems: ResponseInputItem[] = [];
    const builtinMap = new Map(deps.builtinTools.map((t) => [t.name, t]));

    if (onToolCalls) {
      onToolCalls(
        fnCalls.map((fc) => ({
          name: fc.name,
          args: safeJsonParse(fc.arguments),
          isConnector: deps.connectors.isConnectorTool(fc.name, tenant.userId),
        }))
      );
    }

    const executeCall = async (fc: (typeof fnCalls)[number]) => {
      signal?.throwIfAborted();
      const args = safeJsonParse(fc.arguments);
      const isConnector = deps.connectors.isConnectorTool(fc.name, tenant.userId);
      const tool = builtinMap.get(fc.name);

      let result = "";
      let failed = false;
      try {
        if (!isConnector && !tool) {
          failed = true;
          result = `Unknown tool: ${fc.name}`;
          throw new Error(result);
        }
        const execution = isConnector
          ? deps.connectors.execute(fc.name, args, tenant.userId, signal)
          : Promise.resolve(tool!.execute(args, tenant, signal));
        result = await withTimeout(execution, tool?.timeoutMs ?? 60_000, fc.name, signal);
      } catch (e) {
        failed = true;
        if (!result) {
          result = `Tool "${fc.name}" failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        log.warn({ err: e, tool: fc.name, chatId: tenant.chatId }, "Tool execution failed");
      }

      // Persist tool output (success or failure) to the conversation log.
      deps.chatLog.appendConversation(tenant.chatId, tk, {
        role: "tool",
        content: { call_id: fc.call_id, name: fc.name, output: result, failed },
        text: `tool ${fc.name} ${failed ? "failed" : "ok"}: ${result.slice(0, 500)}`,
      });

      return {
        call: { name: fc.name, args, isConnector },
        output: {
          type: "function_call_output",
          call_id: fc.call_id,
          output: result,
        } as ResponseInputItem,
      };
    };

    const allReadOnly = fnCalls.every((fc) => builtinMap.get(fc.name)?.readOnly === true);
    const executed = allReadOnly
      ? await Promise.all(fnCalls.map(executeCall))
      : await fnCalls.reduce<Promise<Awaited<ReturnType<typeof executeCall>>[]>>(
          async (previous, fc) => [...(await previous), await executeCall(fc)],
          Promise.resolve([])
        );
    for (const item of executed) {
      toolOutputItems.push(item.output);
    }

    const completedTerminalTool = executed.some(
      (item) => builtinMap.get(item.call.name)?.terminal && deps.acceptEmptyFinal?.()
    );
    if (completedTerminalTool) return "";

    for (const fc of fnCalls) currentInput.push(fc as ResponseInputItem);
    currentInput.push(...toolOutputItems);

    toolIterations++;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
  signal?: AbortSignal
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const abort = () => rejectAbort?.(signal?.reason ?? new Error("Tool execution aborted"));
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, timeout, aborted]);
  } catch (e) {
    log.warn({ err: e, tool: toolName }, "Tool execution interrupted");
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function extractInputText(input: ResponseInputItem[]): string {
  const lastItem = input[input.length - 1];
  if (lastItem?.type !== "message") return "";
  const content = (lastItem as { content?: unknown }).content;
  if (typeof content === "string") return content.slice(0, 500);
  if (!Array.isArray(content)) return "";
  return (content as { type?: string; text?: string }[])
    .filter((part) => part.type === "input_text")
    .map((part) => part.text ?? "")
    .join(" ")
    .slice(0, 500);
}

function extractFinalText(response: { output_text?: string; output: unknown[] }): string {
  if (response.output_text) return response.output_text;
  for (const item of response.output) {
    if (typeof item !== "object" || item === null) continue;
    const it = item as { type?: string; content?: unknown };
    if (it.type !== "message") continue;
    const content = it.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = (content as { text?: string; content?: string }[])
        .map((c) => c.text ?? c.content ?? "")
        .join("");
      if (text) return text;
    }
  }
  return "";
}

function summarizeFunctionCall(name: string, argsRaw: string): string {
  let brief = "";
  try {
    const a = JSON.parse(argsRaw) as Record<string, unknown>;
    if (typeof a.prompt === "string") brief = a.prompt.slice(0, 160);
    else if (typeof a.content === "string") brief = a.content.slice(0, 160);
    else if (typeof a.command === "string") brief = a.command.slice(0, 160);
    else if (typeof a.query === "string") brief = a.query.slice(0, 160);
    else brief = argsRaw.slice(0, 160);
  } catch {
    brief = argsRaw.slice(0, 160);
  }
  return `called ${name}(${brief})`;
}

/** Append Markdown footnote citations from Perplexity search results. */
function appendCitations(text: string, sources?: PerplexitySource[]): string {
  if (!sources || sources.length === 0) return text;
  if (!text) return text;
  const footnotes = sources
    .map((s) => {
      const label = s.title ? `[${s.title}]` : "[Source]";
      return `[^${s.id}]: ${label}(${s.url ?? ""})`;
    })
    .join("\n");
  return `${text}\n\n${footnotes}`;
}
