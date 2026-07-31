import type { Message, Sticker, Animation } from "grammy/types";
import { toDataUrl } from "../telegram/helpers.js";

export type VisualStickerSource =
  | { kind: "sticker"; sticker: Sticker }
  | { kind: "animation"; animation: Animation };

export interface ResolvedVisualMedia {
  /** Preferred Telegram file_id to download for vision (thumbnail or static file). */
  visionFileId: string;
  /** Human-readable meta for the text part. */
  summary: string;
  source: VisualStickerSource;
}

/**
 * Pick the best image Telegram can give us for vision:
 * - static stickers → the sticker file itself (WEBP)
 * - animated / video stickers → thumbnail when present
 * - animations (GIF/mp4) → thumbnail when present
 */
export function resolveVisualMedia(source: VisualStickerSource): ResolvedVisualMedia | null {
  if (source.kind === "sticker") {
    const s = source.sticker;
    const meta = [
      s.emoji ? `emoji=${s.emoji}` : null,
      s.set_name ? `set=${s.set_name}` : null,
      s.is_animated ? "animated" : null,
      s.is_video ? "video" : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (!s.is_animated && !s.is_video) {
      return {
        visionFileId: s.file_id,
        summary: `[sticker${meta ? `: ${meta}` : ""}]`,
        source,
      };
    }
    if (s.thumbnail?.file_id) {
      return {
        visionFileId: s.thumbnail.file_id,
        summary: `[sticker thumbnail${meta ? `: ${meta}` : ""}]`,
        source,
      };
    }
    return null;
  }

  const a = source.animation;
  const meta = [
    a.file_name ? `name=${a.file_name}` : null,
    a.duration ? `duration=${a.duration}s` : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (a.thumbnail?.file_id) {
    return {
      visionFileId: a.thumbnail.file_id,
      summary: `[GIF thumbnail${meta ? `: ${meta}` : ""}]`,
      source,
    };
  }
  // Some clients omit thumbnail; without ffmpeg we cannot extract a frame.
  return null;
}

export function visualSourceFromMessage(msg: Message): VisualStickerSource | null {
  if ("sticker" in msg && msg.sticker) return { kind: "sticker", sticker: msg.sticker };
  if ("animation" in msg && msg.animation) return { kind: "animation", animation: msg.animation };
  return null;
}

export async function downloadVisionDataUrl(
  botToken: string,
  fileId: string,
  getFile: (fileId: string) => Promise<{ file_path?: string }>,
  maxBytes: number
): Promise<string> {
  const file = await getFile(fileId);
  if (!file.file_path) throw new Error("Telegram file_path missing");
  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  return toDataUrl(url, 60_000, maxBytes);
}
