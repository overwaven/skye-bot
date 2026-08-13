import { InputFile, type Bot, type Context as GrammyContext } from "grammy";
import { tenantFromGrammy, threadKey } from "../../core/tenant.js";
import type { ToolDefinition } from "../../core/module.js";
import { checkAccess } from "./access.js";
import { ctxAudit, fmtError, sendRichReply, serializeError, toDataUrl } from "./helpers.js";
import { log } from "../../utils/log.js";
import type { ImageControl, TelegramDeps } from "./deps.js";
import { IMAGE_CONTROL_TTL_MS } from "./deps.js";
import type { ConversationHelpers } from "./conversation.js";
import { imageControlKey, imageKeyboard } from "./uiHelpers.js";

export function createGenerateImageTool(opts: {
  bot: Bot;
  deps: TelegramDeps;
  threadReferenceImages: Map<string, string[]>;
  imageControls: Map<string, ImageControl>;
  storeConversation: ConversationHelpers["storeConversation"];
}): ToolDefinition {
  const { bot, deps, threadReferenceImages, imageControls, storeConversation } = opts;

  const generateImageTool: ToolDefinition = {
    name: "generate_image",
    description:
      "Generate a new image or edit an existing reference image. Use this when the user asks you to create, draw, generate, edit, or modify an image. If reference images were provided in the conversation, they will be used as the basis for editing. Output only the prompt — the image is sent to the user automatically.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The image generation/editing prompt. Be concrete and descriptive. For editing, describe the full desired result (not just the change).",
        },
      },
      required: ["prompt"],
    },
    timeoutMs: 180_000,
    execute: async (args, tenant, signal) => {
      const prompt = String(args.prompt ?? "");
      if (!prompt) return "No prompt provided for image generation.";

      const tk = threadKey(tenant);
      const references = threadReferenceImages.get(tk) ?? [];
      const referenceUrls = references.length > 0 ? references : undefined;
      const referenceCount = references.length;

      try {
        const buffer = await deps.llm.generateImage(prompt, referenceUrls, signal, tenant.chatId);
        if (!buffer) {
          storeConversation(
            tenant,
            "tool",
            { name: "generate_image", prompt, references: referenceCount, result: "no image" },
            `generate_image(prompt=${prompt.slice(0, 100)}, refs=${referenceCount}) -> no image`
          );
          return "No image was generated. Try a different prompt.";
        }

        const sent = await bot.api.sendPhoto(tenant.chatId, new InputFile(buffer, "image.png"), {
          ...(tenant.threadId != null ? { message_thread_id: tenant.threadId } : {}),
          reply_markup: imageKeyboard(),
        });
        imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
          prompt,
          imageUrl: references[0],
          ownerUserId: tenant.userId!,
          expiresAt: Date.now() + IMAGE_CONTROL_TTL_MS,
        });
        storeConversation(
          tenant,
          "tool",
          {
            name: "generate_image",
            prompt,
            references: referenceCount,
            messageId: sent.message_id,
          },
          `generate_image(prompt=${prompt.slice(0, 100)}, refs=${referenceCount}) -> sent image (message_id ${sent.message_id})`
        );
        return `Image generated and sent to the user (message_id: ${sent.message_id}).`;
      } catch (e) {
        log.error({ err: e }, "generate_image tool failed");
        const errMsg = fmtError(e);
        storeConversation(
          tenant,
          "tool",
          { name: "generate_image", prompt, references: referenceCount, error: errMsg },
          `generate_image(prompt=${prompt.slice(0, 100)}, refs=${referenceCount}) -> FAILED: ${errMsg}`
        );
        return `Failed to generate image: ${errMsg}`;
      }
    },
  };

  return generateImageTool;
}

export function createRunImageEditCommand(opts: {
  deps: TelegramDeps;
  imageControls: Map<string, ImageControl>;
  storeConversation: ConversationHelpers["storeConversation"];
}) {
  const { deps, imageControls, storeConversation } = opts;

  async function runImageEditCommand(
    ctx: GrammyContext,
    tenant: ReturnType<typeof tenantFromGrammy>,
    prompt: string,
    explicitPhotoUrls?: string[]
  ): Promise<void> {
    const t0 = Date.now();
    log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Image editing");

    const actionInterval = setInterval(() => {
      ctx.replyWithChatAction("upload_photo").catch(() => {});
    }, 4000);

    try {
      await ctx.replyWithChatAction("upload_photo");
      let photoUrls: string[] | undefined = explicitPhotoUrls;
      if (!photoUrls) {
        const file = await ctx.api.getFile(ctx.message!.photo!.pop()!.file_id);
        const photoUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        photoUrls = [await toDataUrl(photoUrl, 60_000, deps.maxAttachmentBytes)];
      }
      const buffer = await deps.llm.generateImage(
        prompt,
        photoUrls,
        AbortSignal.timeout(180_000),
        tenant.chatId
      );

      if (!buffer) {
        await sendRichReply(ctx, "_No image was generated._ Try a different prompt.");
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType: "image_edit",
          command: "/image",
          inputLen: prompt.length,
          outputLen: 0,
          latencyMs: Date.now() - t0,
          status: "ok",
        });
        return;
      }

      const sent = await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
        reply_to_message_id: ctx.message!.message_id,
        reply_markup: imageKeyboard(),
      });
      imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
        prompt,
        imageUrl: photoUrls[0],
        ownerUserId: tenant.userId!,
        expiresAt: Date.now() + IMAGE_CONTROL_TTL_MS,
      });
      storeConversation(
        tenant,
        "assistant",
        {
          kind: "image_edited",
          prompt,
          references: photoUrls.length,
          messageId: sent.message_id,
        },
        `edited image with prompt: ${prompt.slice(0, 200)} (refs=${photoUrls.length}, message_id ${sent.message_id})`
      );
      deps.audit.log({
        ...ctxAudit(ctx),
        msgType: "image_edit",
        command: "/image",
        inputLen: prompt.length,
        outputLen: 0,
        latencyMs: Date.now() - t0,
        status: "ok",
        inputText: prompt,
      });
    } catch (e) {
      const ms = Date.now() - t0;
      log.error({ ...serializeError(e), latencyMs: ms }, "Image editing failed");
      storeConversation(
        tenant,
        "assistant",
        { kind: "image_edit_failed", prompt, error: fmtError(e) },
        `image edit failed: ${fmtError(e)}`
      );
      await sendRichReply(ctx, "**Failed to edit the image.** Please try again.").catch(() => {});
      deps.audit.log({
        ...ctxAudit(ctx),
        msgType: "image_edit",
        command: "/image",
        inputLen: prompt.length,
        outputLen: 0,
        latencyMs: ms,
        status: "error",
        errorMsg: fmtError(e),
        inputText: prompt,
      });
    } finally {
      clearInterval(actionInterval);
    }
  }

  return runImageEditCommand;
}

export function registerImageControlCallbacks(opts: {
  bot: Bot;
  deps: TelegramDeps;
  access: import("./access.js").AccessDeps;
  imageControls: Map<string, ImageControl>;
  enqueue: ConversationHelpers["enqueue"];
  storeConversation: ConversationHelpers["storeConversation"];
}): void {
  const { bot, deps, access, imageControls, enqueue, storeConversation } = opts;

  bot.callbackQuery(/^img:(var|prompt|square|wide)$/, async (ctx) => {
    const tenant = tenantFromGrammy(ctx);
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!messageId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = imageControlKey(tenant.chatId, messageId);
    const control = imageControls.get(key);
    if (!control || control.expiresAt <= Date.now()) {
      imageControls.delete(key);
      await ctx.answerCallbackQuery("Image controls expired");
      return;
    }
    if (tenant.userId !== control.ownerUserId) {
      await ctx.answerCallbackQuery("Only the image creator can use these controls");
      return;
    }
    const decision = checkAccess(access, tenant.chatId, tenant.userId);
    if (!decision.ok) {
      await ctx.answerCallbackQuery(decision.message);
      return;
    }
    const account = deps.billing.getAccount(control.ownerUserId);
    if (deps.billing.hasActiveSub(account) && deps.billing.effectiveRemaining(account) <= 0) {
      await ctx.answerCallbackQuery("You're out of tokens");
      return;
    }
    if (deps.billing.hasActiveSub(account)) {
      const debit = deps.billing.charge(control.ownerUserId, 0, 0, 1);
      if (!debit.ok) {
        await ctx.answerCallbackQuery("You're out of tokens");
        return;
      }
    }
    imageControls.delete(key);

    const action = ctx.match[1];
    await ctx.answerCallbackQuery("Working on it");
    await enqueue(threadKey(tenant), async (signal) => {
      try {
        signal.throwIfAborted();
        await ctx.replyWithChatAction("upload_photo");
        if (action === "prompt") {
          const promptRes = await deps.llm.ask(
            "Improve the user's image prompt. Keep it concise, concrete, and directly usable. Output only the improved prompt.",
            control.prompt
          );
          await sendRichReply(ctx, promptRes.output_text || control.prompt);
          return;
        }

        const nextPrompt =
          action === "var"
            ? `Create a polished variation of this image. Preserve the core subject and improve composition, lighting, and detail.\n\nOriginal prompt: ${control.prompt}`
            : action === "square"
              ? `${control.prompt}\n\nRender as a square 1:1 composition.`
              : `${control.prompt}\n\nRender as a wide 16:9 composition.`;
        let sourceImageUrl = control.imageUrl;
        const photo =
          ctx.callbackQuery.message && "photo" in ctx.callbackQuery.message
            ? ctx.callbackQuery.message.photo
            : undefined;
        if (!sourceImageUrl && photo?.length) {
          const file = await ctx.api.getFile(photo[photo.length - 1].file_id);
          const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
          sourceImageUrl = await toDataUrl(telegramUrl, 60_000, deps.maxAttachmentBytes);
        }
        const buffer = await deps.llm.generateImage(
          nextPrompt,
          sourceImageUrl ? [sourceImageUrl] : undefined,
          signal,
          tenant.chatId
        );
        signal.throwIfAborted();
        if (!buffer) {
          await sendRichReply(ctx, "_No image was generated._ Try another variation.");
          return;
        }
        const sent = await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
          reply_to_message_id: messageId,
          reply_markup: imageKeyboard(),
        });
        imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
          prompt: nextPrompt,
          imageUrl: sourceImageUrl,
          ownerUserId: control.ownerUserId,
          expiresAt: Date.now() + IMAGE_CONTROL_TTL_MS,
        });
        storeConversation(
          tenant,
          "assistant",
          { kind: "image_variant", prompt: nextPrompt, messageId: sent.message_id },
          `image variant: ${nextPrompt.slice(0, 200)} (message_id ${sent.message_id})`
        );
      } catch (e) {
        log.error({ ...serializeError(e) }, "Image control failed");
        storeConversation(
          tenant,
          "assistant",
          { kind: "image_variant_failed", error: fmtError(e) },
          `image variant failed: ${fmtError(e)}`
        );
        await sendRichReply(ctx, "**Failed to generate this image variant.**");
      }
    });
  });
}
