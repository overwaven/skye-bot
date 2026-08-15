import type { Bot, Context as GrammyContext } from "grammy";
import type { ResponseInputItem } from "../llm/client.js";
import { tenantFromGrammy, threadKey } from "../../core/tenant.js";
import { extractLogEntry, shouldRunProactiveForMessage } from "./helpers.js";
import { log } from "../../utils/log.js";
import type { TelegramDeps } from "./deps.js";
import { TEXT_HISTORY_LIMIT, TRACKED_CHATS } from "./deps.js";
import type { MentionHelpers } from "./mention.js";

export function createConversationHelpers(bot: Bot, deps: TelegramDeps) {
  const billingQueues = new Map<number, Promise<void>>();

  const enqueue = (key: string, job: (signal: AbortSignal) => Promise<void>) => {
    const chatId = Number(key.split(":", 1)[0]);
    // Fire-and-forget: Telegram middleware must return without waiting for the
    // LLM so other chats can be answered at the same time. Work for one thread
    // is still serialized by ThreadWorkQueue.
    deps.reliability.queue.enqueue(key, chatId, job);
  };

  const withBillingLock = async <T>(
    userId: number | undefined,
    job: () => Promise<T>
  ): Promise<T> => {
    if (userId == null) return job();
    const previous = billingQueues.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    billingQueues.set(userId, current);
    await previous.catch(() => {});
    try {
      return await job();
    } finally {
      release();
      if (billingQueues.get(userId) === current) billingQueues.delete(userId);
    }
  };

  const maybeReactProactively = (
    ctx: GrammyContext,
    tenant: ReturnType<typeof tenantFromGrammy>
  ): void => {
    const proactive = deps.proactive;
    if (!proactive || !proactive.isEnabled()) return;
    if (!ctx.message?.message_id) return;
    const triggerMessageId = ctx.message.message_id;
    const chatId = tenant.chatId;
    const chatTitle = ctx.chat?.title ?? "Group";

    void (async () => {
      const decision = await proactive.maybeReact(
        chatId,
        triggerMessageId,
        chatTitle,
        undefined,
        tenant.threadId
      );
      if (!decision || decision.kind === "none") return;
      const targetId = decision.targetMessageId ?? triggerMessageId;

      try {
        if (decision.kind === "emoji" && decision.emoji) {
          await bot.api.raw.setMessageReaction({
            chat_id: chatId,
            message_id: targetId,
            reaction: [{ type: "emoji", emoji: decision.emoji } as never],
            is_big: false,
          });
          log.info(
            { chatId, targetId, emoji: decision.emoji, reason: decision.reason },
            "Proactive emoji reaction"
          );
        }
      } catch (e) {
        log.warn(
          { err: e, chatId, targetId, kind: decision.kind },
          "Failed to apply proactive reaction"
        );
      }
    })();
  };

  const sanitizeHistory = (items: ResponseInputItem[]): ResponseInputItem[] => {
    const supportsImages = deps.llm.supportsImages() !== false;
    const hasPdfEngine = !!deps.llm.settings.pdfEngine;
    const supportsFiles = supportsImages || hasPdfEngine;
    if (supportsImages && supportsFiles) return items;
    return items.map((item) => {
      const m = item as { type?: string; content?: unknown };
      if (m.type !== "message" || !Array.isArray(m.content)) return item;
      const parts = (m.content as { type: string }[]).filter((p) => {
        if (p.type === "input_image") return supportsImages;
        if (p.type === "input_file") return supportsFiles;
        return true;
      });
      if (parts.length === 0) {
        return {
          ...item,
          content: [{ type: "input_text", text: "[attachment]" }],
        } as ResponseInputItem;
      }
      return { ...item, content: parts } as ResponseInputItem;
    });
  };

  const historyFor = (tenant: ReturnType<typeof tenantFromGrammy>): ResponseInputItem[] => {
    const tk = threadKey(tenant);
    const rows = deps.chatLog.listConversation(tenant.chatId, tk, TEXT_HISTORY_LIMIT);
    const items: ResponseInputItem[] = [];
    for (const row of rows) {
      if (row.role === "tool") {
        const c = row.content as { call_id?: string; output?: string };
        if (c.call_id && typeof c.output === "string") {
          items.push({
            type: "function_call_output",
            call_id: c.call_id,
            output: c.output,
          } as ResponseInputItem);
        }
        continue;
      }
      const c = row.content as { type?: string } | string | unknown[];
      if (typeof c === "object" && c !== null && !Array.isArray(c) && c.type === "function_call") {
        items.push(c as ResponseInputItem);
        continue;
      }
      // Normalize content for the chat API:
      // - string content → use as-is
      // - array content (Responses API parts) → use as-is (sanitizeHistory will strip images)
      // - object content (our metadata records like image edits, proactive replies)
      //   → fall back to row.text so the provider gets a plain string, not a map
      const content = typeof c === "string" || Array.isArray(c) ? c : row.text;
      items.push({
        type: "message",
        role: row.role === "assistant" ? "assistant" : "user",
        content,
      } as ResponseInputItem);
    }
    return sanitizeHistory(items);
  };

  const contextFor = (
    tenant: ReturnType<typeof tenantFromGrammy>,
    modelId: string
  ): ResponseInputItem[] => {
    const history = historyFor(tenant);
    const model = deps.llm.resolveModel(modelId);
    const inputBudget = Math.max(4_000, model.contextWindow - 8_000);
    let estimatedTokens = 0;
    const selected: ResponseInputItem[] = [];
    for (let index = history.length - 1; index >= 0; index--) {
      const item = history[index];
      const itemTokens = Math.ceil(JSON.stringify(item).length / 4);
      if (selected.length > 0 && estimatedTokens + itemTokens > inputBudget) break;
      selected.unshift(item);
      estimatedTokens += itemTokens;
    }
    while (selected[0] && selected[0].type === "function_call_output") selected.shift();
    return selected;
  };

  const formatGroupMessage = (m: {
    sender: string;
    timestamp: string;
    type: string;
    content: string;
    replyTo?: string;
  }): string => {
    const reply = m.replyTo ? ` (replying to ${m.replyTo})` : "";
    const typeTag = m.type !== "text" ? `[${m.type}] ` : "";
    return `[${m.timestamp}] ${m.sender}${reply}: ${typeTag}${m.content}`;
  };

  const storeConversation = (
    tenant: ReturnType<typeof tenantFromGrammy>,
    role: "user" | "assistant" | "tool",
    content: unknown,
    text: string,
    messageId?: number
  ) => {
    deps.chatLog.appendConversation(tenant.chatId, threadKey(tenant), {
      role,
      content,
      text: text.slice(0, 12000),
      ...(messageId != null ? { messageId } : {}),
    });
  };

  const replyContext = (ctx: GrammyContext): string => {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    if (!reply) return "";
    const stored =
      reply.message_id != null
        ? deps.chatLog.findConversationText(ctx.chat!.id, reply.message_id)
        : undefined;
    const text =
      stored ||
      ("text" in reply && reply.text) ||
      ("caption" in reply && reply.caption) ||
      ("photo" in reply && reply.photo ? "[photo]" : "") ||
      ("voice" in reply && reply.voice ? "[voice message]" : "") ||
      ("document" in reply && reply.document
        ? `[document: ${reply.document.file_name ?? "file"}]`
        : "") ||
      ("audio" in reply && reply.audio
        ? `[audio: ${reply.audio.title ?? reply.audio.file_name ?? "file"}]`
        : "");
    if (!text) return "";
    return `Context: the user is replying to this message:\n${text.slice(0, 2000)}\n\n`;
  };

  const replyImageContextNote = (ctx: GrammyContext): string => {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    if (!reply?.photo?.length) return "";
    return "The replied-to message contains an image. It has been collected as a reference for image generation/editing.\n\n";
  };

  const downloadTelegramFile = async (fileId: string) => {
    const file = await bot.api.getFile(fileId);
    const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
    const res = await fetch(telegramUrl);
    if (!res.ok) throw new Error(`Failed to download Telegram file: ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > deps.maxAttachmentBytes) {
      throw new Error(`Telegram attachment exceeds ${deps.maxAttachmentBytes} bytes`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    if (!res.body) throw new Error("Telegram file response has no body");
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > deps.maxAttachmentBytes) {
        throw new Error(`Telegram attachment exceeds ${deps.maxAttachmentBytes} bytes`);
      }
      chunks.push(Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks, total),
      path: file.file_path ?? "",
    };
  };

  return {
    billingQueues,
    enqueue,
    withBillingLock,
    maybeReactProactively,
    sanitizeHistory,
    historyFor,
    contextFor,
    formatGroupMessage,
    storeConversation,
    replyContext,
    replyImageContextNote,
    downloadTelegramFile,
  };
}

export type ConversationHelpers = ReturnType<typeof createConversationHelpers>;

export function registerGroupLogging(
  bot: Bot,
  deps: TelegramDeps,
  mention: MentionHelpers,
  conversation: Pick<ConversationHelpers, "maybeReactProactively">
): void {
  bot.on("message", async (ctx, next) => {
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      const chatId = ctx.chat.id;
      const tenant = tenantFromGrammy(ctx);
      const tk = threadKey(tenant);
      if (!TRACKED_CHATS.has(tk)) {
        deps.chatLog.loadChatLog(chatId, tenant.threadId);
        TRACKED_CHATS.add(tk);
      }
      const entry = extractLogEntry(ctx);
      deps.chatLog.log(tenant.chatId, entry, ctx.chat.title, tenant.threadId);
      const text = ctx.message.text ?? ctx.message.caption ?? "";
      if (shouldRunProactiveForMessage(mention.isDirectedAtBot(ctx), text)) {
        conversation.maybeReactProactively(ctx, tenant);
      }
    }
    return next();
  });
}
