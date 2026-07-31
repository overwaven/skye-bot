import type { Context as GrammyContext } from "grammy";
import type { InputRichMessage, Message, ReplyParameters } from "grammy/types";
import type { LogEntry } from "../chatLog/service.js";
import type { AuditEntry } from "../audit/service.js";
import { log } from "../../utils/log.js";

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

async function readLimitedBody(res: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error(`Downloaded file exceeds ${maxBytes} bytes`);
  if (!res.body) throw new Error("Download response has no body");

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`Downloaded file exceeds ${maxBytes} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

/** Download an image from a URL and return it as a base64 data URL. */
export async function toDataUrl(
  url: string,
  timeoutMs = 60_000,
  maxBytes = 25 * 1024 * 1024
): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buf = await readLimitedBody(res, maxBytes);

  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
  const mime =
    MIME_MAP[ext] || (headerMime.startsWith("image/") ? headerMime : null) || "image/jpeg";

  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Download any file from a URL and return it as a base64 data URL with the
 * given MIME type. Used for PDFs and other binary files sent to the LLM.
 */
export async function toFileDataUrl(
  url: string,
  mimeType: string,
  timeoutMs = 60_000,
  maxBytes = 25 * 1024 * 1024
): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const buf = await readLimitedBody(res, maxBytes);
  return `data:${mimeType};base64,${buf.toString("base64")}`;
}

/**
 * Parse a JSON string that may contain trailing garbage (some models append
 * extra text after the JSON object). Falls back to a brace-balanced scan.
 */
export function safeJsonParse(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = trimmed.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            // keep searching
          }
        }
      }
    }
    log.warn({ raw: trimmed.slice(0, 200) }, "Failed to parse tool arguments JSON");
    return {};
  }
}

export interface TextEncodedToolCall {
  name: string;
  arguments: string;
}

export function parseTextEncodedToolCall(
  raw: string,
  allowedToolNames: ReadonlySet<string>
): TextEncodedToolCall | undefined {
  let trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) trimmed = fenced[1].trim();

  let envelope: unknown;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(envelope)) return undefined;

  const name = envelope.action;
  if (typeof name !== "string" || !allowedToolNames.has(name)) return undefined;

  const args = parseTextEncodedToolArgs(envelope.action_input);
  if (!args) return undefined;
  return { name, arguments: JSON.stringify(args) };
}

function parseTextEncodedToolArgs(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    const normalized = value.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, content: string) =>
      JSON.stringify(content.replace(/\\'/g, "'"))
    );
    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function senderTag(ctx: GrammyContext): string {
  const from = ctx.from;
  if (!from) return "";
  const parts: string[] = [];
  if (from.first_name) parts.push(from.first_name);
  if (from.last_name) parts.push(from.last_name);
  const name = parts.join(" ") || "Unknown";
  const handle = from.username ? ` (@${from.username})` : "";
  return `[${name}${handle}] `;
}

export function shouldRunProactiveForMessage(directedAtBot: boolean, text = ""): boolean {
  return !directedAtBot && !text.trimStart().startsWith("/");
}

export function ctxAudit(
  ctx: GrammyContext
): Pick<AuditEntry, "chatId" | "chatType" | "threadId" | "userId" | "username" | "firstName"> {
  return {
    chatId: ctx.chat!.id,
    chatType: ctx.chat!.type,
    threadId: ctx.message?.message_thread_id ?? undefined,
    userId: ctx.from!.id,
    username: ctx.from?.username ?? undefined,
    firstName: ctx.from?.first_name ?? undefined,
  };
}

export function serializeError(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { message: String(e) };
  const a = e as { status?: number; error?: unknown; code?: string };
  const obj: Record<string, unknown> = { message: e.message };
  if (a.status != null) obj.status = a.status;
  if (a.error != null) obj.apiError = a.error;
  if (a.code != null) obj.code = a.code;
  return obj;
}

export function fmtError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const a = e as {
    status?: number;
    error?: { code?: string; type?: string };
  };
  const parts: string[] = [e.message];
  if (a.status != null) parts.push(`status=${a.status}`);
  if (a.error?.code != null) parts.push(`code=${a.error.code}`);
  if (a.error?.type != null) parts.push(`type=${a.error.type}`);
  return parts.join(" | ");
}

export function extractLogEntry(ctx: GrammyContext): LogEntry {
  const from = ctx.from;
  const nameParts: string[] = [];
  if (from?.first_name) nameParts.push(from.first_name);
  if (from?.last_name) nameParts.push(from.last_name);
  const sender = nameParts.join(" ") || "Unknown";

  const now = new Date();
  const timestamp = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const msg = ctx.message!;
  let type = "text";
  let content = "";

  if ("text" in msg && msg.text) {
    content = msg.text;
  } else if ("sticker" in msg && msg.sticker) {
    type = "sticker";
    content = msg.sticker.emoji || "sticker";
  } else if ("photo" in msg && msg.photo) {
    type = "photo";
    content = ("caption" in msg && msg.caption) || "photo";
  } else if ("video" in msg && msg.video) {
    type = "video";
    content = ("caption" in msg && msg.caption) || "video";
  } else if ("animation" in msg && msg.animation) {
    type = "GIF";
    content = ("caption" in msg && msg.caption) || "GIF";
  } else if ("document" in msg && msg.document) {
    type = "document";
    content = msg.document.file_name || "document";
  } else if ("voice" in msg && msg.voice) {
    type = "voice";
    content = "voice message";
  } else if ("video_note" in msg && msg.video_note) {
    type = "video_note";
    content = "video note";
  } else if ("audio" in msg && msg.audio) {
    type = "audio";
    content = msg.audio.title || msg.audio.file_name || "audio";
  } else {
    content = "[unsupported message type]";
  }

  let replyTo: string | undefined;
  if ("reply_to_message" in msg && msg.reply_to_message?.from) {
    const rf = msg.reply_to_message.from;
    const rParts: string[] = [];
    if (rf.first_name) rParts.push(rf.first_name);
    if (rf.last_name) rParts.push(rf.last_name);
    replyTo = rParts.join(" ") || "Unknown";
  }

  return { messageId: msg.message_id, sender, timestamp, type, content, replyTo };
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  isConnector: boolean;
}

export function formatToolCalls(calls: ToolCallRecord[]): string {
  return calls
    .map((c) => {
      const icon = c.isConnector ? "🔌" : "🧠";
      const argsStr = Object.entries(c.args)
        .map(([k, v]) => {
          let val = JSON.stringify(v);
          if (val.length > 40) val = val.slice(0, 40) + "...";
          return `${k}=${val}`;
        })
        .join(", ");
      return `${icon} ${c.name}(${argsStr})`;
    })
    .join("\n");
}

export function buildDraftMarkdown(toolCalls: ToolCallRecord[], suffix?: string): string {
  const prefix = formatToolCalls(toolCalls);
  const blockquote = prefix
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return suffix ? `${blockquote}\n\n${suffix}` : blockquote;
}

export function buildFinalReply(toolCalls: ToolCallRecord[], text: string): string {
  return text;
}

type ChatAction =
  | "typing"
  | "upload_photo"
  | "record_video"
  | "upload_video"
  | "record_voice"
  | "upload_voice"
  | "upload_document"
  | "choose_sticker"
  | "find_location"
  | "record_video_note"
  | "upload_video_note";

export type DraftStatusKind = "thinking" | "images" | "voice" | "documents" | "code" | "web";

export interface DraftStatus {
  kind: DraftStatusKind;
  text: string;
}

const DRAFT_STATUS_EMOJI: Record<DraftStatusKind, { id: string; fallback: string }> = {
  thinking: { id: "5535034915403333642", fallback: "💭" },
  images: { id: "5537651753077440526", fallback: "👀" },
  voice: { id: "5537354996607090745", fallback: "🎙️" },
  documents: { id: "5535039193190760468", fallback: "📄" },
  code: { id: "5535251334510411788", fallback: "💻" },
  web: { id: "5535365052359507996", fallback: "🔎" },
};

export const DEFAULT_DRAFT_STATUS: DraftStatus = { kind: "thinking", text: "Thinking…" };

export function draftStatusForMessageType(type: string): DraftStatus {
  if (type === "photo" || type === "sticker" || type === "animation") {
    return { kind: "images", text: "Looking at images…" };
  }
  if (type === "voice" || type === "audio" || type === "video_note") {
    return { kind: "voice", text: "Listening to audio…" };
  }
  if (type === "document") return { kind: "documents", text: "Studying documents…" };
  return DEFAULT_DRAFT_STATUS;
}

export function draftStatusForToolCalls(calls: ToolCallRecord[]): DraftStatus {
  const names = calls.map((call) => call.name.toLowerCase());
  if (names.some((name) => name.includes("image"))) {
    return { kind: "images", text: "Creating an image…" };
  }
  if (names.some((name) => name.includes("sticker"))) {
    return { kind: "thinking", text: "Picking a sticker…" };
  }
  if (names.some((name) => name.includes("voice") || name.includes("speech"))) {
    return { kind: "voice", text: "Recording a voice response…" };
  }
  if (names.some((name) => name.startsWith("sandbox_") || name.includes("command"))) {
    return { kind: "code", text: "Working with code and commands…" };
  }
  if (names.some((name) => name.includes("memory"))) {
    return { kind: "thinking", text: "Checking memory…" };
  }
  if (
    names.some((name) => /(^|_)(web|fetch|browse|internet)(_|$)/.test(name) || name === "search")
  ) {
    return { kind: "web", text: "Searching the web…" };
  }
  if (names.some((name) => name.includes("document") || name.includes("file"))) {
    return { kind: "documents", text: "Studying documents…" };
  }
  return { kind: "thinking", text: "Looking for the right information…" };
}

export function renderDraftStatus(status: DraftStatus, thinkingBlock: boolean): string {
  const emoji = DRAFT_STATUS_EMOJI[status.kind];
  const content = `<tg-emoji emoji-id="${emoji.id}">${emoji.fallback}</tg-emoji> ${escapeHtml(status.text)}`;
  return thinkingBlock ? `<tg-thinking>${content}</tg-thinking>` : content;
}

const DRAFT_MIN_INTERVAL_MS = 5000;
const FINAL_RETRY_LIMIT = 3;
const MAX_DRAFT_MARKDOWN_CHARS = 3500;
const RICH_DRAFT_PEER_INVALID = "TEXTDRAFT_PEER_INVALID";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(e: unknown): number | undefined {
  const retryAfter = (e as { parameters?: { retry_after?: unknown } })?.parameters?.retry_after;
  return typeof retryAfter === "number" ? retryAfter * 1000 : undefined;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countSingleDollarDelimiters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$") continue;
    if (text[i - 1] === "\\" || text[i - 1] === "$" || text[i + 1] === "$") continue;
    count++;
  }
  return count;
}

export function stabilizeStreamingMarkdown(markdown: string): string {
  let stable = markdown.trim();
  if (stable.length > MAX_DRAFT_MARKDOWN_CHARS) {
    stable = `${stable.slice(0, MAX_DRAFT_MARKDOWN_CHARS).trimEnd()}\n\n...`;
  }

  if (countMatches(stable, /```/g) % 2 === 1) {
    stable += "\n```";
  }

  if (countMatches(stable, /\$\$/g) % 2 === 1) {
    stable += "\n$$";
  }

  if (countSingleDollarDelimiters(stable) % 2 === 1) {
    stable += "$";
  }

  return stable;
}

async function withTelegramRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; context: string }
): Promise<T> {
  const attempts = options.attempts ?? FINAL_RETRY_LIMIT;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      const waitMs = retryAfterMs(e);
      if (waitMs == null || attempt === attempts - 1) break;
      log.warn({ err: e, waitMs, context: options.context }, "Telegram rate limit, retrying");
      await sleep(waitMs + 500);
    }
  }

  throw lastError;
}

function threadId(ctx: GrammyContext): number | undefined {
  return ctx.msg?.message_thread_id;
}

function replyParameters(ctx: GrammyContext): ReplyParameters | undefined {
  const id = ctx.message?.message_id;
  return id == null ? undefined : { message_id: id };
}

export async function sendRichReply(ctx: GrammyContext, markdown: string): Promise<Message> {
  try {
    const richMessage: InputRichMessage = { markdown };
    const other: {
      message_thread_id?: number;
      reply_parameters?: ReplyParameters;
    } = {};
    const tid = threadId(ctx);
    if (tid != null) other.message_thread_id = tid;
    const rp = replyParameters(ctx);
    if (rp) other.reply_parameters = rp;
    return await withTelegramRetry(
      () => ctx.api.sendRichMessage(ctx.chat!.id, richMessage, other),
      { context: "sendRichMessage" }
    );
  } catch (e) {
    log.warn({ err: e }, "sendRichMessage failed, falling back to plain messages");
    const chunks = splitTelegramText(markdown);
    let first: Message | undefined;
    for (const [i, chunk] of chunks.entries()) {
      const msg = await ctx.reply(chunk, {
        message_thread_id: threadId(ctx),
        ...(i === 0 && ctx.message?.message_id
          ? { reply_to_message_id: ctx.message.message_id }
          : {}),
      });
      first ??= msg;
    }
    return first!;
  }
}

export async function sendRichReplyChunked(
  ctx: GrammyContext,
  markdown: string,
  maxChars = 3500
): Promise<void> {
  if (markdown.length <= maxChars) {
    await sendRichReply(ctx, markdown);
    return;
  }
  const separator = "\n\n---\n\n";
  const parts = markdown.split(separator);
  let current = "";
  for (const part of parts) {
    const candidate = current ? `${current}${separator}${part}` : part;
    if (candidate.length > maxChars && current) {
      await sendRichReply(ctx, current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) await sendRichReply(ctx, current);
}

/**
 * Edit the message behind a callback query (or any ctx.editMessageText-capable
 * context) using rich markdown. Falls back to plain editMessageText with
 * `parse_mode: "Markdown"` if rich editing fails (e.g. peer doesn't support
 * rich messages).
 *
 * `replyMarkup` is optional and only applied when provided (inline keyboards).
 */
export async function sendRichEdit(
  ctx: GrammyContext,
  markdown: string,
  replyMarkup?: Parameters<GrammyContext["editMessageText"]>[1] extends infer O
    ? O extends { reply_markup?: infer R }
      ? R
      : never
    : never
): Promise<void> {
  const richMessage: InputRichMessage = { markdown };
  const other: Record<string, unknown> = {};
  if (replyMarkup != null) other.reply_markup = replyMarkup;
  try {
    await ctx.editMessageText(richMessage, other);
  } catch (e) {
    log.warn({ err: e }, "rich editMessageText failed, falling back to plain Markdown");
    try {
      await ctx.editMessageText(markdown, { ...other, parse_mode: "Markdown" });
    } catch (e2) {
      log.warn({ err: e2 }, "plain Markdown editMessageText also failed");
    }
  }
}

function splitTelegramText(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const at = Math.max(
      rest.lastIndexOf("\n\n", limit),
      rest.lastIndexOf("\n", limit),
      rest.lastIndexOf(" ", limit)
    );
    const cut = at > limit * 0.5 ? at : limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function reactSafely(ctx: GrammyContext, emoji: string, isBig = false): void {
  if (!ctx.chat?.id || !ctx.message?.message_id) return;
  void ctx.api.raw
    .setMessageReaction({
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id,
      reaction: [{ type: "emoji", emoji } as never],
      is_big: isBig,
    })
    .catch(() => {});
}

async function sendRichDraft(ctx: GrammyContext, draftId: number, markdown: string): Promise<true> {
  const richMessage: InputRichMessage = { markdown };
  const other: { message_thread_id?: number } = {};
  const tid = threadId(ctx);
  if (tid != null) other.message_thread_id = tid;
  return withTelegramRetry(
    () => ctx.api.sendRichMessageDraft(ctx.chat!.id, draftId, richMessage, other),
    { attempts: 1, context: "sendRichMessageDraft" }
  );
}

function telegramDescription(e: unknown): string {
  return String((e as { description?: unknown })?.description ?? "");
}

function isPermanentDraftError(e: unknown): boolean {
  const description = telegramDescription(e);
  return description.includes(RICH_DRAFT_PEER_INVALID) || retryAfterMs(e) == null;
}

export function createChatActionTicker(ctx: GrammyContext, action: ChatAction, intervalMs = 4000) {
  let timer: NodeJS.Timeout | undefined;
  const send = () => ctx.replyWithChatAction(action).catch(() => {});

  return {
    start: () => {
      send();
      timer = setInterval(send, intervalMs);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

export function createDraftManager(ctx: GrammyContext) {
  if (ctx.chat?.type !== "private") {
    let latestStatus = DEFAULT_DRAFT_STATUS;
    let statusMessage: Message | undefined;
    let stopped = false;
    let updating = Promise.resolve();
    const timer = setTimeout(() => {
      if (stopped || !ctx.chat) return;
      updating = updating
        .then(async () => {
          statusMessage = await ctx.reply(renderDraftStatus(latestStatus, false), {
            parse_mode: "HTML",
            message_thread_id: threadId(ctx),
            ...(ctx.message?.message_id ? { reply_to_message_id: ctx.message.message_id } : {}),
          });
        })
        .catch((e) => log.debug({ err: e }, "Group status message failed"));
    }, 4_000);

    return {
      send: (text: string, status?: DraftStatus) => {
        const nextStatus = status ?? (text ? { ...latestStatus, text } : latestStatus);
        if (
          stopped ||
          (nextStatus.text === latestStatus.text && nextStatus.kind === latestStatus.kind)
        ) {
          return;
        }
        latestStatus = nextStatus;
        if (!statusMessage || !ctx.chat) return;
        updating = updating
          .then(() =>
            ctx.api.editMessageText(
              ctx.chat!.id,
              statusMessage!.message_id,
              renderDraftStatus(latestStatus, false),
              { parse_mode: "HTML" }
            )
          )
          .then(() => undefined)
          .catch((e) => log.debug({ err: e }, "Group status update failed"));
      },
      flush: async () => {
        await updating;
      },
      delete: async () => {
        stopped = true;
        clearTimeout(timer);
        await updating;
        if (statusMessage && ctx.chat) {
          await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => {});
        }
      },
    };
  }

  const draftId = ctx.update.update_id || ctx.message?.message_id || Date.now();
  let enabled = true;
  let lastText = "";
  let pendingText: string | undefined;
  let sending = false;
  let stopped = false;
  let nextAllowedAt = 0;
  let idleWaiters: Array<() => void> = [];

  let latestStatus = DEFAULT_DRAFT_STATUS;
  const buildThinkingDraft = (markdown: string, status: DraftStatus) => {
    const body = stabilizeStreamingMarkdown(markdown);
    return `${renderDraftStatus(status, true)}${body ? `\n\n${body}` : ""}`;
  };

  const notifyIdle = () => {
    if (sending || pendingText != null) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const pump = async () => {
    if (sending) return;
    sending = true;

    try {
      while (!stopped && pendingText != null) {
        const text = pendingText;
        pendingText = undefined;

        if (!enabled) {
          lastText = text;
          continue;
        }

        const waitMs = nextAllowedAt - Date.now();
        if (waitMs > 0) await sleep(waitMs);

        try {
          await sendRichDraft(ctx, draftId, buildThinkingDraft(text, latestStatus));
          lastText = text;
          nextAllowedAt = Date.now() + DRAFT_MIN_INTERVAL_MS;
        } catch (e) {
          const waitMsFromError = retryAfterMs(e);
          if (waitMsFromError != null) {
            nextAllowedAt = Date.now() + waitMsFromError + 500;
            pendingText = text;
            log.warn({ err: e, waitMs: waitMsFromError }, "Rich draft rate limited");
            continue;
          }
          if (isPermanentDraftError(e)) {
            enabled = false;
            lastText = text;
            log.debug({ err: e }, "Rich drafts disabled for this peer");
            continue;
          }
          log.warn({ err: e }, "sendRichMessageDraft failed");
        }
      }
    } finally {
      sending = false;
      if (!stopped && pendingText != null) {
        void pump();
      } else {
        notifyIdle();
      }
    }
  };

  return {
    send: (text: string, status?: DraftStatus) => {
      if (status) latestStatus = status;
      if (stopped || !enabled || (text === lastText && !status) || text === pendingText) return;
      pendingText = text;
      void pump();
    },
    flush: async () => {
      if (!sending && pendingText == null) return;
      await new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    delete: async () => {
      stopped = true;
      pendingText = undefined;
      if (sending) {
        await new Promise<void>((resolve) => idleWaiters.push(resolve));
      }
      notifyIdle();
    },
  };
}
