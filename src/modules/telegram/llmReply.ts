import { InputFile, type Context as GrammyContext } from "grammy";
import type { Message } from "grammy/types";
import type { ResponseInputItem } from "../llm/client.js";
import type { ToolDefinition } from "../../core/module.js";
import { tenantFromGrammy, threadKey } from "../../core/tenant.js";
import { hasMeteredAccess, type AccessDeps } from "./access.js";
import { createSendVoiceTool, type PreparedVoiceMessage } from "../speech/tool.js";
import type { SpeechSynthesisOptions } from "../speech/types.js";
import { oggOpusDurationSeconds } from "../speech/transcode.js";
import { createSendStickerTool, type PreparedStickerMessage } from "../stickers/tools.js";
import {
  buildDraftMarkdown,
  buildFinalReply,
  createChatActionTicker,
  createDraftManager,
  ctxAudit,
  DEFAULT_DRAFT_STATUS,
  draftStatusForMessageType,
  draftStatusForToolCalls,
  fmtError,
  reactSafely,
  sendRichReply,
  serializeError,
  type ToolCallRecord,
} from "./helpers.js";
import {
  cleanMd,
  parseVoiceToolPayload,
  unwrapStreamingTextEnvelope,
  unwrapTextEnvelope,
} from "../../utils/markdown.js";
import { log } from "../../utils/log.js";
import { QueueTimeoutError } from "./reliability.js";
import type { ContentPart, TelegramDeps } from "./deps.js";
import { VOICE_OUTPUT_REQUEST_RE } from "./deps.js";
import type { ConversationHelpers } from "./conversation.js";
import type { MediaHelpers } from "./media.js";
import { extractChecklist, replyParametersFor, shouldPreferChecklist } from "./uiHelpers.js";

export type MsgType =
  | "text"
  | "voice"
  | "photo"
  | "document"
  | "audio"
  | "video_note"
  | "sticker"
  | "animation";

export function createRunLlmReply(opts: {
  deps: TelegramDeps;
  access: AccessDeps;
  baseBuiltinTools: ToolDefinition[];
  threadReferenceImages: Map<string, string[]>;
  collectReplyMedia: MediaHelpers["collectReplyMedia"];
  storeConversation: ConversationHelpers["storeConversation"];
  contextFor: ConversationHelpers["contextFor"];
}) {
  const {
    deps,
    access,
    baseBuiltinTools,
    threadReferenceImages,
    collectReplyMedia,
    storeConversation,
    contextFor,
  } = opts;

  const maybeSendChecklist = async (
    ctx: GrammyContext,
    text: string,
    inputText: string
  ): Promise<Message | undefined> => {
    if (!shouldPreferChecklist(inputText, text)) return undefined;
    const checklist = extractChecklist(text);
    if (!checklist) return undefined;

    if (ctx.businessConnectionId) {
      try {
        return await ctx.replyWithChecklist(checklist, {
          reply_parameters: replyParametersFor(ctx),
        });
      } catch (e) {
        log.warn({ err: e }, "Native checklist failed, falling back to rich Markdown");
      }
    }
    return undefined;
  };

  const runLlmReply = async (
    ctx: GrammyContext,
    tenant: ReturnType<typeof tenantFromGrammy>,
    userItem: ResponseInputItem,
    inputText: string,
    msgType:
      | "text"
      | "voice"
      | "photo"
      | "document"
      | "audio"
      | "video_note"
      | "sticker"
      | "animation",
    options: { signal?: AbortSignal } = {}
  ) => {
    const t0 = Date.now();
    const tk = threadKey(tenant);
    const controller = new AbortController();
    const abortFromQueue = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromQueue();
    else options.signal?.addEventListener("abort", abortFromQueue, { once: true });
    const draft = createDraftManager(ctx);
    const actionTicker = createChatActionTicker(ctx, "typing");
    const toolCallHistory: ToolCallRecord[] = [];
    const voiceReplyMode = deps.chatConfig.get(tenant.chatId).voiceReplyMode;
    const preparedVoiceMessages: PreparedVoiceMessage[] = [];
    const preparedStickers: PreparedStickerMessage[] = [];
    const requestTools = [...baseBuiltinTools];
    const allowVoiceTool = voiceReplyMode !== "text" || VOICE_OUTPUT_REQUEST_RE.test(inputText);
    if (deps.speech.isTtsAvailable(tenant.chatId) && allowVoiceTool) {
      requestTools.push(
        createSendVoiceTool({
          speech: deps.speech,
          mode: voiceReplyMode,
          chatId: tenant.chatId,
          onStart: async () => {
            await ctx.replyWithChatAction("record_voice");
            void draft.send("", { kind: "voice", text: "Recording a voice response…" });
          },
          onPrepared: (message) => {
            preparedVoiceMessages.push(message);
          },
        })
      );
    }
    if (deps.stickers && deps.stickers.count(tenant.chatId) > 0) {
      requestTools.push(
        createSendStickerTool({
          stickers: deps.stickers,
          onPrepared: (message) => {
            preparedStickers.push(message);
          },
        })
      );
    }

    const hasPreparedMedia = () => preparedVoiceMessages.length > 0 || preparedStickers.length > 0;

    let lastDraftTs = 0;
    const onChunk = (snapshot: string) => {
      if (tenant.chatType !== "private") return;
      const now = Date.now();
      if (now - lastDraftTs < 300) return;
      lastDraftTs = now;
      const visibleSnapshot = unwrapStreamingTextEnvelope(snapshot);
      if (toolCallHistory.length > 0) {
        void draft.send(buildDraftMarkdown(toolCallHistory, visibleSnapshot));
      } else {
        void draft.send(visibleSnapshot);
      }
    };
    const onToolCalls = (calls: ToolCallRecord[]) => {
      toolCallHistory.push(...calls);
      const status = draftStatusForToolCalls(calls);
      void draft.send(
        tenant.chatType === "private" ? buildDraftMarkdown(toolCallHistory) : "",
        status
      );
    };

    try {
      reactSafely(ctx, "👀");
      actionTicker.start();
      void draft.send("", draftStatusForMessageType(msgType));

      // Collect media content parts from the replied-to message (photos,
      // PDFs, audio transcripts) so the model can reason about them even
      // if they were sent by a different user in the chat.
      const replyMedia = await collectReplyMedia(ctx);
      if (replyMedia.parts.length > 0) {
        const content = (userItem as { content?: unknown }).content;
        if (typeof content === "string") {
          // Upgrade string content to a content-parts array with the text + media
          const parts: ContentPart[] = [];
          if (content) parts.push({ type: "input_text", text: content });
          parts.push(...replyMedia.parts);
          (userItem as { content: unknown }).content = parts;
        } else if (Array.isArray(content)) {
          // Merge reply media parts into the existing content array
          (content as ContentPart[]).push(...replyMedia.parts);
        }
      }

      // Persist the user message BEFORE calling the LLM so it survives
      // crashes, timeouts, and failed tool calls.
      storeConversation(
        tenant,
        "user",
        (userItem as { content?: unknown }).content ?? "",
        inputText,
        ctx.message?.message_id
      );

      // Resolve the user's selected model + token quota for this turn.
      const billAcc = tenant.userId ? deps.billing.getAccount(tenant.userId) : undefined;
      const modelId = deps.llm.resolveModel(billAcc?.modelId ?? deps.llm.defaultModelId).id;
      // The user message was already persisted to chatLog above, so historyFor
      // already includes it. Do not append userItem again.
      const inputItems: ResponseInputItem[] = contextFor(tenant, modelId);
      const hasReferenceImages = threadReferenceImages.has(tk);

      // Quota pre-check: subscribers with zero tokens can't proceed.
      if (billAcc && hasMeteredAccess(access, tenant.chatId, tenant.userId)) {
        if (deps.billing.effectiveRemaining(billAcc) <= 0) {
          await draft.delete();
          await sendRichReply(
            ctx,
            "**You're out of tokens** for this month.\n\nUse `/plus` to buy a token pack, or wait for your renewal date."
          );
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType,
            inputLen: inputText.length,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "ok",
          });
          return;
        }
      }

      // Token debit is a SQLite transaction, so concurrent chats of the same
      // user can run in parallel without a process-wide billing mutex.
      const meterUsage = (
        usage: { promptTokens: number; completionTokens: number },
        usedModelId: string
      ) => {
        if (!hasMeteredAccess(access, tenant.chatId, tenant.userId)) return;
        const usedModel = deps.llm.resolveModel(usedModelId);
        const r = deps.billing.charge(
          tenant.userId!,
          usage.promptTokens,
          usage.completionTokens,
          usedModel.multiplier
        );
        if (!r.ok) throw new Error(`Quota exhausted: ${r.reason}`);
      };

      const checkRoundQuota = () => {
        if (!tenant.userId) return;
        const account = deps.billing.getAccount(tenant.userId);
        if (
          hasMeteredAccess(access, tenant.chatId, tenant.userId) &&
          deps.billing.effectiveRemaining(account) <= 0
        ) {
          throw new Error("Quota exhausted: no_quota");
        }
      };

      const runAttempt = (
        attemptModelId: string,
        tools: ToolDefinition[],
        attemptInput: ResponseInputItem[] = inputItems
      ) =>
        deps.agentRuntime.run({
          tenant,
          input: attemptInput,
          builtinTools: tools,
          allowConnectorTools: tools.length > 0,
          hasReferenceImages,
          modelId: attemptModelId,
          beforeRound: checkRoundQuota,
          onUsage: meterUsage,
          owner: deps.owner,
          onChunk,
          onToolCalls,
          acceptEmptyFinal: () => hasPreparedMedia(),
          signal: controller.signal,
        });

      const attempts = [modelId, modelId];
      let rawText = "";
      let usedModelId = modelId;
      let lastAttemptError: unknown;
      for (const attemptModelId of attempts) {
        controller.signal.throwIfAborted();
        try {
          const attemptText = await runAttempt(attemptModelId, requestTools);
          rawText = attemptText;
          if (rawText || hasPreparedMedia()) usedModelId = attemptModelId;
          if (rawText || hasPreparedMedia()) break;
          throw new Error("Model returned an empty response");
        } catch (e) {
          lastAttemptError = e;
          if (controller.signal.aborted) throw e;
          if (toolCallHistory.length > 0) break;
          log.warn(
            { err: e, modelId: attemptModelId, chatId: tenant.chatId },
            "LLM attempt failed"
          );
          void draft.send("", {
            ...DEFAULT_DRAFT_STATUS,
            text: "The first attempt did not work — trying again…",
          });
        }
      }

      if (!rawText && !hasPreparedMedia()) {
        const recoveryModelId = modelId;
        void draft.send("", { ...DEFAULT_DRAFT_STATUS, text: "Trying without tools…" });
        try {
          const recoveryInput = contextFor(tenant, recoveryModelId);
          rawText = await runAttempt(recoveryModelId, [], recoveryInput);
          if (rawText) usedModelId = recoveryModelId;
        } catch (e) {
          lastAttemptError = e;
        }
      }
      if (!rawText && !hasPreparedMedia() && lastAttemptError) {
        throw lastAttemptError;
      }
      // Recover when the model prints send_voice args as JSON instead of calling the tool.
      const leakedVoice = parseVoiceToolPayload(rawText);
      const text = cleanMd(leakedVoice ? leakedVoice.text : unwrapTextEnvelope(rawText));
      const leakedSynthesisOptions: SpeechSynthesisOptions | undefined = leakedVoice
        ? {
            voice: leakedVoice.voice,
            style: leakedVoice.style,
            scene: leakedVoice.scene,
          }
        : undefined;

      if (!text && !hasPreparedMedia()) {
        await draft.delete();
        await sendRichReply(ctx, "_I couldn't generate a response._ Please try again.");
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType,
          inputLen: inputText.length,
          outputLen: 0,
          latencyMs: Date.now() - t0,
          status: "ok",
          inputText,
        });
        return;
      }

      const shouldVoice =
        deps.speech.isTtsAvailable(tenant.chatId) &&
        (voiceReplyMode === "always" || Boolean(leakedVoice));
      if (
        preparedVoiceMessages.length === 0 &&
        preparedStickers.length === 0 &&
        text &&
        shouldVoice
      ) {
        await ctx.replyWithChatAction("record_voice");
        void draft.send("", { kind: "voice", text: "Recording a voice response…" });
        const audioBuffer = await deps.speech.synthesize(
          text,
          leakedSynthesisOptions,
          controller.signal,
          tenant.chatId
        );
        const durationSeconds = audioBuffer ? oggOpusDurationSeconds(audioBuffer) : 0;
        if (audioBuffer && durationSeconds >= 0.1) {
          await draft.delete();
          await ctx.replyWithVoice(new InputFile(audioBuffer, "response.ogg"), {
            reply_to_message_id: ctx.message?.message_id,
            duration: Math.max(1, Math.ceil(durationSeconds)),
          });
          reactSafely(ctx, "👍");
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType,
            inputLen: inputText.length,
            outputLen: text.length,
            latencyMs: Date.now() - t0,
            status: "ok",
            model: deps.llm.resolveModel(usedModelId).model,
            inputText,
            outputText: text,
            toolCalls: toolCallHistory,
          });
          return;
        }
        log.warn("TTS synthesis failed, falling back to text reply");
      }

      const finalText = buildFinalReply(toolCallHistory, text);
      await draft.delete();
      if (finalText) {
        const checklistMessage = await maybeSendChecklist(ctx, finalText, inputText);
        if (!checklistMessage) await sendRichReply(ctx, finalText);
      }
      for (const message of preparedVoiceMessages) {
        await ctx.replyWithVoice(new InputFile(message.audio, "response.ogg"), {
          reply_to_message_id: ctx.message?.message_id,
          duration: Math.max(1, Math.ceil(message.durationSeconds)),
        });
      }
      for (const prepared of preparedStickers) {
        try {
          await ctx.replyWithChatAction("choose_sticker");
          await ctx.replyWithSticker(prepared.sticker.fileId, {
            reply_to_message_id: ctx.message?.message_id,
          });
        } catch (e) {
          log.warn(
            { err: e, stickerId: prepared.sticker.id, chatId: tenant.chatId },
            "Failed to send prepared sticker"
          );
        }
      }
      reactSafely(ctx, "👍");
      const spokenText = preparedVoiceMessages.map((message) => message.transcript).join("\n");
      const stickerText = preparedStickers
        .map((p) => `[sticker ${p.sticker.id}] ${p.sticker.description}`)
        .join("\n");
      if (!text && (spokenText || stickerText)) {
        storeConversation(
          tenant,
          "assistant",
          spokenText
            ? { type: "voice", transcript: spokenText }
            : { type: "stickers", items: preparedStickers.map((p) => p.sticker.id) },
          [spokenText, stickerText].filter(Boolean).join("\n")
        );
      }
      deps.audit.log({
        ...ctxAudit(ctx),
        msgType,
        inputLen: inputText.length,
        outputLen: text.length + spokenText.length + stickerText.length,
        latencyMs: Date.now() - t0,
        status: "ok",
        model: deps.llm.resolveModel(usedModelId).model,
        inputText,
        outputText: [finalText, spokenText, stickerText].filter(Boolean).join("\n\n"),
        toolCalls: toolCallHistory,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        if (options.signal?.reason instanceof QueueTimeoutError) {
          await sendRichReply(
            ctx,
            "**This request took too long** and was stopped. Please send it again."
          ).catch(() => {});
        }
        return;
      }
      const ms = Date.now() - t0;
      log.error({ ...serializeError(e), latencyMs: ms }, `${msgType} handler failed`);
      await draft.delete();
      reactSafely(ctx, "😢");
      await sendRichReply(
        ctx,
        "**I could not complete this response** — every available attempt failed. Please send it again."
      ).catch(() => {});
      deps.audit.log({
        ...ctxAudit(ctx),
        msgType,
        inputLen: inputText.length,
        outputLen: 0,
        latencyMs: ms,
        status: "error",
        errorMsg: fmtError(e),
        inputText,
        toolCalls: toolCallHistory,
      });
    } finally {
      actionTicker.stop();
      options.signal?.removeEventListener("abort", abortFromQueue);
    }
  };

  return runLlmReply;
}

export type RunLlmReply = ReturnType<typeof createRunLlmReply>;
