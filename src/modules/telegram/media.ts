import type { Context as GrammyContext } from "grammy";
import type { Message } from "grammy/types";
import {
  downloadVisionDataUrl,
  resolveVisualMedia,
  visualSourceFromMessage,
} from "../stickers/media.js";
import { toDataUrl, toFileDataUrl } from "./helpers.js";
import { log } from "../../utils/log.js";
import type { ContentPart, TelegramDeps } from "./deps.js";
import { PDF_EXT_RE, PDF_MIME, SUPPORTED_TEXT_EXT_RE, SUPPORTED_TEXT_MIME_RE } from "./deps.js";
import type { ConversationHelpers } from "./conversation.js";

export function createMediaHelpers(opts: {
  deps: TelegramDeps;
  downloadTelegramFile: ConversationHelpers["downloadTelegramFile"];
}) {
  const { deps } = opts;
  const downloadTelegramFile = opts.downloadTelegramFile;

  async function collectReferenceImages(ctx: GrammyContext): Promise<string[]> {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    const images: string[] = [];
    const targets: { photo?: Message["photo"] }[] = [];
    if (reply?.photo?.length) targets.push(reply);
    if (ctx.message?.photo?.length) targets.push(ctx.message);
    for (const t of targets) {
      if (!t.photo?.length) continue;
      try {
        const file = await ctx.api.getFile(t.photo[t.photo.length - 1].file_id);
        const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        images.push(await toDataUrl(url, 60_000, deps.maxAttachmentBytes));
      } catch (e) {
        log.warn({ err: e }, "Failed to download reference image");
      }
    }
    return images;
  }

  /**
   * Collect media content parts (images, PDFs, audio transcripts) from the
   * replied-to message so the model can reason about them. This handles:
   * - Photos → input_image parts (if vision supported)
   * - Stickers / GIF animations → thumbnail or static WEBP (if vision supported)
   * - PDF documents → input_file parts (if file parsing supported)
   * - Audio/voice → transcribed text (if STT available)
   * - Text documents → extracted text
   *
   * Returns an object with content parts (to merge into the user message) and
   * a textual summary (to include in the reply context).
   */
  async function collectReplyMedia(
    ctx: GrammyContext
  ): Promise<{ parts: ContentPart[]; summary: string }> {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    if (!reply) return { parts: [], summary: "" };

    const parts: ContentPart[] = [];
    const summaryParts: string[] = [];
    const supportsImages = deps.llm.supportsImages() !== false;
    const hasPdfEngine = !!deps.llm.settings.pdfEngine;
    const supportsFiles = supportsImages || hasPdfEngine;

    // Photo in replied message
    if (reply.photo?.length && supportsImages) {
      try {
        const file = await ctx.api.getFile(reply.photo[reply.photo.length - 1].file_id);
        const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        const dataUrl = await toDataUrl(url, 60_000, deps.maxAttachmentBytes);
        parts.push({ type: "input_image", image_url: dataUrl });
        const cap = "caption" in reply && reply.caption ? reply.caption : "photo";
        summaryParts.push(`[replied photo: ${cap}]`);
      } catch (e) {
        log.warn({ err: e }, "Failed to download replied photo");
      }
    }

    // Sticker or GIF animation in replied message
    if (supportsImages) {
      const visual = visualSourceFromMessage(reply as Message);
      if (visual) {
        const resolved = resolveVisualMedia(visual);
        if (resolved) {
          try {
            const dataUrl = await downloadVisionDataUrl(
              deps.botToken,
              resolved.visionFileId,
              (fileId) => ctx.api.getFile(fileId),
              deps.maxAttachmentBytes
            );
            parts.push({ type: "input_image", image_url: dataUrl });
            summaryParts.push(`[replied ${resolved.summary}]`);
          } catch (e) {
            log.warn({ err: e }, "Failed to download replied sticker/GIF thumbnail");
            summaryParts.push(`[replied ${resolved.summary} — thumbnail unavailable]`);
          }
        } else {
          summaryParts.push(
            visual.kind === "sticker"
              ? `[replied sticker: ${visual.sticker.emoji ?? "sticker"}]`
              : "[replied GIF]"
          );
        }
      }
    }

    // Document (PDF or text) in replied message
    if (reply.document) {
      const doc = reply.document;
      const filename = doc.file_name ?? "document";
      const mime = doc.mime_type ?? "";
      const isPdf = mime === PDF_MIME || PDF_EXT_RE.test(filename);

      if (isPdf && supportsFiles) {
        try {
          const file = await ctx.api.getFile(doc.file_id);
          const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
          const dataUrl = await toFileDataUrl(url, PDF_MIME, 60_000, deps.maxAttachmentBytes);
          parts.push({ type: "input_file", file_data: dataUrl, filename });
          summaryParts.push(`[replied PDF: ${filename}]`);
        } catch (e) {
          log.warn({ err: e }, "Failed to download replied PDF");
        }
      } else if (
        !isPdf &&
        (SUPPORTED_TEXT_MIME_RE.test(mime) || SUPPORTED_TEXT_EXT_RE.test(filename))
      ) {
        try {
          const { buffer } = await downloadTelegramFile(doc.file_id);
          const text = buffer.toString("utf8").replace(/\0/g, "").slice(0, 16000);
          if (text.trim()) {
            parts.push({ type: "input_text", text: `[Replied document: ${filename}]\n${text}` });
            summaryParts.push(`[replied document: ${filename}]`);
          }
        } catch (e) {
          log.warn({ err: e }, "Failed to download replied document");
        }
      } else if (!isPdf) {
        summaryParts.push(`[replied document: ${filename}]`);
      }
    }

    // Voice in replied message
    if (reply.voice && deps.speech.isSttAvailable()) {
      try {
        const { buffer } = await downloadTelegramFile(reply.voice.file_id);
        const transcript = await deps.speech.recognize(buffer);
        if (transcript) {
          parts.push({
            type: "input_text",
            text: `[Replied voice message transcript]\n${transcript}`,
          });
          summaryParts.push("[replied voice message]");
        }
      } catch (e) {
        log.warn({ err: e }, "Failed to transcribe replied voice");
      }
    }

    // Audio file in replied message
    if (reply.audio && deps.speech.isSttAvailable()) {
      try {
        const { buffer } = await downloadTelegramFile(reply.audio.file_id);
        const transcript = await deps.speech.recognize(buffer);
        if (transcript) {
          parts.push({ type: "input_text", text: `[Replied audio transcript]\n${transcript}` });
          summaryParts.push(
            `[replied audio: ${reply.audio.title ?? reply.audio.file_name ?? "audio"}]`
          );
        }
      } catch (e) {
        log.warn({ err: e }, "Failed to transcribe replied audio");
      }
    }

    return { parts, summary: summaryParts.join(" ") };
  }

  async function downloadPhotos(ctxs: GrammyContext[]): Promise<string[]> {
    const out: string[] = [];
    for (const c of ctxs) {
      if (!c.message?.photo?.length) continue;
      try {
        const file = await c.api.getFile(c.message.photo[c.message.photo.length - 1].file_id);
        const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        out.push(await toDataUrl(url, 60_000, deps.maxAttachmentBytes));
      } catch (e) {
        log.warn({ err: e }, "Failed to download album photo");
      }
    }
    return out;
  }

  return {
    collectReferenceImages,
    collectReplyMedia,
    downloadPhotos,
  };
}

export type MediaHelpers = ReturnType<typeof createMediaHelpers>;
