import type { Bot, Context as GrammyContext } from "grammy";
import type { Message } from "grammy/types";
import type { ResponseInputItem } from "../llm/client.js";
import { tenantFromGrammy, threadKey, type TenantContext } from "../../core/tenant.js";
import { downloadVisionDataUrl, resolveVisualMedia } from "../stickers/media.js";
import {
  fmtError,
  reactSafely,
  senderTag,
  sendRichReply,
  serializeError,
  toDataUrl,
  toFileDataUrl,
} from "./helpers.js";
import { log } from "../../utils/log.js";
import type { ContentPart, MediaGroupEntry, TelegramDeps } from "./deps.js";
import {
  IMAGE_CMD_RE,
  MEDIA_GROUP_GRACE_MS,
  PDF_EXT_RE,
  PDF_MIME,
  SUPPORTED_TEXT_EXT_RE,
  SUPPORTED_TEXT_MIME_RE,
} from "./deps.js";
import type { ConversationHelpers } from "./conversation.js";
import type { MediaHelpers } from "./media.js";
import type { MentionHelpers } from "./mention.js";
import type { RunLlmReply } from "./llmReply.js";

export function registerMessageHandlers(opts: {
  bot: Bot;
  deps: TelegramDeps;
  mediaGroups: Map<string, MediaGroupEntry>;
  threadReferenceImages: Map<string, string[]>;
  mention: MentionHelpers;
  conversation: ConversationHelpers;
  media: MediaHelpers;
  runLlmReply: RunLlmReply;
  runImageEditCommand: (
    ctx: GrammyContext,
    tenant: TenantContext,
    prompt: string,
    explicitPhotoUrls?: string[]
  ) => Promise<void>;
}): void {
  const {
    bot,
    deps,
    mediaGroups,
    threadReferenceImages,
    mention,
    conversation,
    media,
    runLlmReply,
    runImageEditCommand,
  } = opts;
  const { isDirectedAtBot } = mention;
  const { enqueue, replyContext, replyImageContextNote, downloadTelegramFile } = conversation;
  const { collectReferenceImages, downloadPhotos } = media;

  bot.on("message:text", async (ctx) => {
    const tenantEarly = tenantFromGrammy(ctx);
    if (
      deps.stickers?.getTeachState(tenantEarly.chatId).pendingPayload &&
      (isDirectedAtBot(ctx) || ctx.chat?.type === "private")
    ) {
      const handled = await handleTeachDescriptionText(ctx, tenantEarly, ctx.message.text || "");
      if (handled) return;
    }

    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    reactSafely(ctx, "👀");

    // Collect reference images from replied-to message for the generate_image tool.
    const refs = await collectReferenceImages(ctx);
    if (refs.length > 0) threadReferenceImages.set(tk, refs);

    const text = ctx.message.text || "";
    await enqueue(tk, async (signal) => {
      const content = `${replyContext(ctx)}${replyImageContextNote(ctx)}${senderTag(ctx)}${text}`;
      const userItem: ResponseInputItem = {
        type: "message",
        role: "user",
        content,
      };
      await runLlmReply(ctx, tenant, userItem, text, "text", { signal });
      threadReferenceImages.delete(tk);
    });
  });

  // --- Photo handler (image edit or vision) ---
  bot.on("message:photo", async (ctx) => {
    const captionRaw = ctx.message.caption?.trim() || "";
    const imageMatch = captionRaw.match(IMAGE_CMD_RE);
    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    const mediaGroupId = (ctx.message as Message & { media_group_id?: string }).media_group_id;

    // --- Album / media-group: buffer all photos, process once after grace ---
    if (mediaGroupId) {
      const existing = mediaGroups.get(mediaGroupId);
      if (existing) {
        existing.ctxs.push(ctx);
        await existing.completion;
      } else {
        let resolveCompletion!: () => void;
        let rejectCompletion!: (error: unknown) => void;
        const completion = new Promise<void>((resolve, reject) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        });
        const entry = {
          tenant,
          ctxs: [ctx],
          timer: undefined as unknown as NodeJS.Timeout,
          completion,
        };
        entry.timer = setTimeout(() => {
          mediaGroups.delete(mediaGroupId);
          void processMediaGroup(entry.tenant, entry.ctxs).then(
            resolveCompletion,
            rejectCompletion
          );
        }, MEDIA_GROUP_GRACE_MS);
        mediaGroups.set(mediaGroupId, entry);
        await completion;
      }
      return;
    }

    // --- /image command with single photo → editing ---
    if (imageMatch) {
      const prompt = imageMatch[1].trim();
      if (!prompt) {
        await sendRichReply(
          ctx,
          "Provide a description after `/image`, e.g. `/image make it cartoon`"
        );
        return;
      }
      await runImageEditCommand(ctx, tenant, prompt);
      return;
    }

    // --- Vision analysis (single photo sent with a question for Skye) ---
    if (!isDirectedAtBot(ctx)) return;
    if (deps.llm.supportsImages() === false) {
      await sendRichReply(
        ctx,
        "The current model does not support image input. Send text or switch to a **vision-capable** model."
      );
      return;
    }
    const replyRefs = await collectReferenceImages(ctx);
    if (replyRefs.length > 0) threadReferenceImages.set(tk, replyRefs);
    await enqueue(tk, async (signal) => {
      try {
        const file = await ctx.api.getFile(ctx.message.photo.pop()!.file_id);
        const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        const dataUrl = await toDataUrl(telegramUrl, 60_000, deps.maxAttachmentBytes);

        const tag = senderTag(ctx);
        const contentParts: { type: string; text?: string; image_url?: string }[] = [];
        const textPart = `${replyContext(ctx)}${replyImageContextNote(ctx)}${tag}${captionRaw || "Please analyze this image."}`;
        if (textPart) contentParts.push({ type: "input_text", text: textPart });
        else if (tag) contentParts.push({ type: "input_text", text: tag.trim() });
        contentParts.push({ type: "input_image", image_url: dataUrl });

        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: contentParts as never,
        };
        await runLlmReply(ctx, tenant, userItem, textPart, "photo", { signal });
        threadReferenceImages.delete(tk);
      } catch (e) {
        log.error({ ...serializeError(e) }, "Photo preparation failed");
        await sendRichReply(
          ctx,
          "**Failed to process the image.** Please try again or send text instead."
        ).catch(() => {});
      }
    });
  });

  async function processMediaGroup(
    tenant: ReturnType<typeof tenantFromGrammy>,
    ctxs: GrammyContext[]
  ): Promise<void> {
    const tk = threadKey(tenant);
    const captionCtx = ctxs.find((c) => (c.message?.caption ?? "").trim().length > 0);
    const captionRaw = captionCtx?.message?.caption?.trim() ?? "";
    const imageMatch = captionRaw.match(IMAGE_CMD_RE);

    const photoUrls = await downloadPhotos(ctxs);
    if (photoUrls.length === 0) {
      log.warn({ chatId: tenant.chatId }, "Media group had no downloadable photos");
      return;
    }

    // --- /image with album → editing using ALL album photos as references ---
    if (imageMatch) {
      const prompt = imageMatch[1].trim();
      if (!prompt) {
        await sendRichReply(
          captionCtx ?? ctxs[0],
          "Provide a description after `/image`, e.g. `/image make it cartoon`"
        );
        return;
      }
      await runImageEditCommand(captionCtx ?? ctxs[0], tenant, prompt, photoUrls);
      return;
    }

    // --- Vision analysis: feed all photos to the model at once ---
    if (!isDirectedAtBot(captionCtx ?? ctxs[0])) return;
    if (deps.llm.supportsImages() === false) {
      await sendRichReply(
        captionCtx ?? ctxs[0],
        "The current model does not support image input. Send text or switch to a **vision-capable** model."
      );
      return;
    }

    // Also collect reference images from replied-to message for the generate_image tool.
    const replyRefs = captionCtx ? await collectReferenceImages(captionCtx) : [];
    const allRefs = [...replyRefs, ...photoUrls];
    if (allRefs.length > 0) threadReferenceImages.set(tk, allRefs);

    await enqueue(tk, async (signal) => {
      try {
        const tag = senderTag(captionCtx ?? ctxs[0]);
        const contentParts: { type: string; text?: string; image_url?: string }[] = [];
        const textPart = `${replyContext(captionCtx ?? ctxs[0])}${replyImageContextNote(captionCtx ?? ctxs[0])}${tag}${captionRaw || `Please analyze these ${photoUrls.length} images.`}`;
        if (textPart) contentParts.push({ type: "input_text", text: textPart });
        else if (tag) contentParts.push({ type: "input_text", text: tag.trim() });
        for (const url of photoUrls) {
          contentParts.push({ type: "input_image", image_url: url });
        }

        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: contentParts as never,
        };
        await runLlmReply(captionCtx ?? ctxs[0], tenant, userItem, textPart, "photo", { signal });
        threadReferenceImages.delete(tk);
      } catch (e) {
        log.error({ ...serializeError(e) }, "Media group preparation failed");
        await sendRichReply(
          captionCtx ?? ctxs[0],
          "**Failed to process the images.** Please try again or send text instead."
        ).catch(() => {});
      }
    });
  }

  async function handleTeachSticker(
    ctx: GrammyContext,
    tenant: TenantContext,
    sticker: NonNullable<Message["sticker"]>
  ): Promise<boolean> {
    if (!deps.stickers) return false;
    const teach = deps.stickers.getTeachState(tenant.chatId);
    if (!teach.enabled) return false;

    const seedTarget = deps.stickers.currentSeedTarget(tenant.chatId);
    const payload = {
      ...(seedTarget ? { id: seedTarget.id } : {}),
      fileId: sticker.file_id,
      fileUniqueId: sticker.file_unique_id,
      description: seedTarget?.description ?? "",
      ...(sticker.emoji ? { emoji: sticker.emoji } : {}),
      ...(sticker.set_name ? { setName: sticker.set_name } : {}),
      ...(sticker.thumbnail?.file_id ? { thumbFileId: sticker.thumbnail.file_id } : {}),
      isAnimated: sticker.is_animated,
      isVideo: sticker.is_video,
    };

    // Seed pack: description is fixed — save immediately.
    if (seedTarget) {
      try {
        const saved = deps.stickers.upsert(tenant.chatId, {
          ...payload,
          description: seedTarget.description,
        });
        const next = deps.stickers.advanceSeedAfterSave(tenant.chatId);
        const followUp = next
          ? `\n\nNext: _${next.description}_`
          : "\n\n🌱 **Seed pack complete.** Teach mode is off.";
        await sendRichReply(
          ctx,
          [`✅ Saved sticker \`${saved.id}\``, "", `_${saved.description}_`, followUp].join("\n")
        );
      } catch (e) {
        await sendRichReply(ctx, `**Could not save sticker:** ${fmtError(e)}`);
      }
      return true;
    }

    // Free teach: ask for a text description (stickers have no captions in Telegram).
    deps.stickers.setTeachState(tenant.chatId, {
      enabled: true,
      pendingPayload: payload,
      pendingDesc: null,
    });
    await sendRichReply(
      ctx,
      [
        "Got the sticker. Reply with a short description of when I should send it.",
        "",
        "_Example: ухмыляющийся хомяк / smug hamster_",
        "",
        "Or send `/stickers_teach` to cancel.",
      ].join("\n")
    );
    return true;
  }

  async function handleTeachDescriptionText(
    ctx: GrammyContext,
    tenant: TenantContext,
    text: string
  ): Promise<boolean> {
    if (!deps.stickers) return false;
    const teach = deps.stickers.getTeachState(tenant.chatId);
    if (!teach.enabled || !teach.pendingPayload) return false;
    const description = text.trim();
    if (!description) {
      await sendRichReply(ctx, "Send a **non-empty description** for the sticker.");
      return true;
    }
    try {
      const saved = deps.stickers.upsert(tenant.chatId, {
        ...teach.pendingPayload,
        description,
      });
      deps.stickers.setTeachState(tenant.chatId, {
        enabled: true,
        pendingPayload: null,
        pendingDesc: null,
      });
      await sendRichReply(
        ctx,
        [
          `✅ Saved sticker \`${saved.id}\``,
          "",
          `_${saved.description}_`,
          "",
          "Send another sticker to keep teaching, or `/stickers_teach` to stop.",
        ].join("\n")
      );
    } catch (e) {
      await sendRichReply(ctx, `**Could not save sticker:** ${fmtError(e)}`);
    }
    return true;
  }

  bot.on("message:sticker", async (ctx) => {
    const tenant = tenantFromGrammy(ctx);
    const teachEnabled = deps.stickers?.getTeachState(tenant.chatId).enabled === true;
    if (teachEnabled) {
      // In DMs any sticker teaches; in groups still require a directed message.
      if (!isDirectedAtBot(ctx) && ctx.chat?.type !== "private") return;
      await enqueue(threadKey(tenant), async () => {
        await handleTeachSticker(ctx, tenant, ctx.message.sticker);
      });
      return;
    }

    if (!isDirectedAtBot(ctx)) return;
    if (deps.llm.supportsImages() === false) {
      await sendRichReply(
        ctx,
        "The current model does not support image input, so I can't see this sticker. Switch to a **vision-capable** model."
      );
      return;
    }

    const tk = threadKey(tenant);
    await enqueue(tk, async (signal) => {
      try {
        const sticker = ctx.message.sticker;
        const resolved = resolveVisualMedia({ kind: "sticker", sticker });
        const tag = senderTag(ctx);
        const contentParts: ContentPart[] = [];
        const textPart = `${replyContext(ctx)}${tag}[sticker${sticker.emoji ? ` ${sticker.emoji}` : ""}]`;
        contentParts.push({ type: "input_text", text: textPart });

        if (resolved) {
          const dataUrl = await downloadVisionDataUrl(
            deps.botToken,
            resolved.visionFileId,
            (fileId) => ctx.api.getFile(fileId),
            deps.maxAttachmentBytes
          );
          contentParts.push({ type: "input_image", image_url: dataUrl });
        } else {
          contentParts.push({
            type: "input_text",
            text: "[Sticker has no viewable thumbnail — animated/video without thumb]",
          });
        }

        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: contentParts as never,
        };
        await runLlmReply(ctx, tenant, userItem, textPart, "sticker", { signal });
      } catch (e) {
        log.error({ ...serializeError(e) }, "Sticker preparation failed");
        await sendRichReply(
          ctx,
          "**Failed to process the sticker.** Please try again or send text instead."
        ).catch(() => {});
      }
    });
  });

  // --- Animation / GIF handler ---
  bot.on("message:animation", async (ctx) => {
    if (!isDirectedAtBot(ctx)) return;
    if (deps.llm.supportsImages() === false) {
      await sendRichReply(
        ctx,
        "The current model does not support image input, so I can't see this GIF. Switch to a **vision-capable** model."
      );
      return;
    }

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    const captionRaw = ctx.message.caption?.trim() || "";
    await enqueue(tk, async (signal) => {
      try {
        const animation = ctx.message.animation;
        const resolved = resolveVisualMedia({ kind: "animation", animation });
        const tag = senderTag(ctx);
        const contentParts: ContentPart[] = [];
        const textPart = `${replyContext(ctx)}${tag}${captionRaw || "[GIF]"}`;
        contentParts.push({ type: "input_text", text: textPart });

        if (resolved) {
          const dataUrl = await downloadVisionDataUrl(
            deps.botToken,
            resolved.visionFileId,
            (fileId) => ctx.api.getFile(fileId),
            deps.maxAttachmentBytes
          );
          contentParts.push({ type: "input_image", image_url: dataUrl });
        } else {
          contentParts.push({
            type: "input_text",
            text: "[GIF has no thumbnail available]",
          });
        }

        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: contentParts as never,
        };
        await runLlmReply(ctx, tenant, userItem, textPart, "animation", { signal });
      } catch (e) {
        log.error({ ...serializeError(e) }, "Animation preparation failed");
        await sendRichReply(
          ctx,
          "**Failed to process the GIF.** Please try again or send text instead."
        ).catch(() => {});
      }
    });
  });

  // --- Voice handler ---
  bot.on("message:voice", async (ctx) => {
    if (!deps.speech.isSttAvailable()) {
      await sendRichReply(
        ctx,
        "**Voice recognition is not configured.** Ask the bot administrator to set up a speech provider (Yandex SpeechKit or OpenRouter)."
      );
      return;
    }

    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    await enqueue(tk, async (signal) => {
      try {
        await ctx.replyWithChatAction("typing");
        const file = await ctx.api.getFile(ctx.message.voice.file_id);
        const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        const audioRes = await fetch(telegramUrl);
        if (!audioRes.ok) {
          throw new Error(`Failed to download voice: ${audioRes.status}`);
        }
        const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

        const recognized = await deps.speech.recognize(audioBuffer);

        if (!recognized) {
          await sendRichReply(ctx, "_Could not recognize speech._ Please try again or send text.");
          return;
        }

        log.info({ chatId: tenant.chatId, recognizedLen: recognized.length }, "STT recognized");

        const tag = senderTag(ctx);
        const content = `${replyContext(ctx)}${tag}${recognized}`;
        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content,
        };
        await runLlmReply(ctx, tenant, userItem, recognized, "voice", { signal });
      } catch (e) {
        log.error({ ...serializeError(e) }, "Voice preparation failed");
        await sendRichReply(
          ctx,
          "**Failed to process the voice message.** Please try again or send text."
        ).catch(() => {});
      }
    });
  });

  // --- Text/code document handler ---
  bot.on("message:document", async (ctx) => {
    const captionRaw = ctx.message.caption?.trim() || "";
    if (!isDirectedAtBot(ctx)) return;

    const doc = ctx.message.document;
    const filename = doc.file_name ?? "document";
    const mime = doc.mime_type ?? "";
    const isTextDocument =
      SUPPORTED_TEXT_MIME_RE.test(mime) || SUPPORTED_TEXT_EXT_RE.test(filename);
    const isPdf = mime === PDF_MIME || PDF_EXT_RE.test(filename);
    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);

    await enqueue(tk, async (signal) => {
      try {
        await ctx.replyWithChatAction("upload_document");

        // --- PDF: send as file content part to the LLM ---
        if (isPdf) {
          const supportsFiles =
            deps.llm.supportsImages() !== false || !!deps.llm.settings.pdfEngine;
          if (!supportsFiles) {
            await sendRichReply(
              ctx,
              "The current model/provider does not support PDF file input. Try switching to a vision-capable model or configuring a PDF parsing engine."
            );
            return;
          }

          const file = await ctx.api.getFile(doc.file_id);
          const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
          const dataUrl = await toFileDataUrl(url, PDF_MIME, 60_000, deps.maxAttachmentBytes);

          const tag = senderTag(ctx);
          const prompt = captionRaw || "Please analyze this PDF document.";
          const contentParts: ContentPart[] = [
            { type: "input_text", text: `${replyContext(ctx)}${tag}${prompt}` },
            { type: "input_file", file_data: dataUrl, filename },
          ];

          const userItem: ResponseInputItem = {
            type: "message",
            role: "user",
            content: contentParts as never,
          };
          await runLlmReply(ctx, tenant, userItem, `${prompt}\n${filename}`, "document", {
            signal,
          });
          return;
        }

        // --- Text/code documents ---
        if (!isTextDocument) {
          await sendRichReply(
            ctx,
            `I can read text/code documents and PDFs, but this file looks like ${mime || "a binary file"}. Send a .txt/.md/.json/.csv/code file or a PDF.`
          );
          return;
        }

        const { buffer } = await downloadTelegramFile(doc.file_id);
        const fileText = buffer.toString("utf8").replace(/\0/g, "").slice(0, 16000);
        if (!fileText.trim()) {
          await sendRichReply(ctx, "_I couldn't read text from this document._");
          return;
        }

        const prompt = captionRaw || "Please analyze this document.";
        const tag = senderTag(ctx);
        const content = `${replyContext(ctx)}${tag}${prompt}\n\nAttached document: ${filename}\n\n${fileText}`;
        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content,
        };
        await runLlmReply(
          ctx,
          tenant,
          userItem,
          `${prompt}\n${filename}\n${fileText}`,
          "document",
          { signal }
        );
      } catch (e) {
        log.error({ ...serializeError(e) }, "Document preparation failed");
        await sendRichReply(
          ctx,
          "**Failed to process the document.** Please try again or paste the text."
        ).catch(() => {});
      }
    });
  });

  // --- Audio file handler (best effort; provider may transcode via ffmpeg) ---
  bot.on("message:audio", async (ctx) => {
    const captionRaw = ctx.message.caption?.trim() || "";
    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    await enqueue(tk, async (signal) => {
      if (!deps.speech.isSttAvailable()) {
        await sendRichReply(ctx, "**Audio recognition is not configured.**");
        return;
      }
      try {
        await ctx.replyWithChatAction("typing");
        const { buffer } = await downloadTelegramFile(ctx.message.audio.file_id);
        const recognized = await deps.speech.recognize(buffer);
        if (!recognized) {
          await sendRichReply(
            ctx,
            "I couldn't transcribe this audio file. Voice notes work best; other audio formats may need transcoding first."
          );
          return;
        }
        const prompt = captionRaw || "Please answer based on this audio transcript.";
        const content = `${replyContext(ctx)}${senderTag(ctx)}${prompt}\n\nAudio transcript:\n${recognized}`;
        const userItem: ResponseInputItem = { type: "message", role: "user", content };
        await runLlmReply(ctx, tenant, userItem, `${prompt}\n${recognized}`, "audio", { signal });
      } catch (e) {
        log.error({ ...serializeError(e) }, "Audio preparation failed");
        await sendRichReply(ctx, "**Failed to process the audio file.**");
      }
    });
  });

  bot.on("message:video_note", async (ctx) => {
    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    await enqueue(tk, async (signal) => {
      if (!deps.speech.isSttAvailable()) {
        await sendRichReply(ctx, "**Video-note transcription is not configured.**");
        return;
      }
      try {
        await ctx.replyWithChatAction("typing");
        const { buffer } = await downloadTelegramFile(ctx.message.video_note.file_id);
        const recognized = await deps.speech.recognize(buffer);
        if (!recognized) {
          await sendRichReply(
            ctx,
            "I received the video note, but couldn't extract speech from it without transcoding. Send it as a voice note for reliable transcription."
          );
          return;
        }
        const content = `${replyContext(ctx)}${senderTag(ctx)}Video note transcript:\n${recognized}`;
        const userItem: ResponseInputItem = { type: "message", role: "user", content };
        await runLlmReply(ctx, tenant, userItem, recognized, "video_note", { signal });
      } catch (e) {
        log.error({ ...serializeError(e) }, "Video-note preparation failed");
        await sendRichReply(ctx, "**Failed to process the video note.**");
      }
    });
  });
}
