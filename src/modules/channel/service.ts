import { getDb } from "../../core/db.js";
import type { Context as GrammyContext } from "grammy";
import type { Message } from "grammy/types";

export interface ChannelPost {
  id: number;
  chatId: number;
  messageId: number;
  sender: string | null;
  text: string | null;
  mediaType: string | null;
  mediaCaption: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

interface ChannelPostRow {
  id: number;
  chat_id: number;
  message_id: number;
  sender: string | null;
  text: string | null;
  media_type: string | null;
  media_caption: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

function rowToPost(row: ChannelPostRow): ChannelPost {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    sender: row.sender,
    text: row.text,
    mediaType: row.media_type,
    mediaCaption: row.media_caption,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

function extractPostFields(msg: Message): {
  text: string | null;
  mediaType: string | null;
  mediaCaption: string | null;
} {
  if ("text" in msg && msg.text) return { text: msg.text, mediaType: null, mediaCaption: null };
  if ("caption" in msg && msg.caption) {
    let mediaType = "media";
    if ("photo" in msg && msg.photo) mediaType = "photo";
    else if ("video" in msg && msg.video) mediaType = "video";
    else if ("animation" in msg && msg.animation) mediaType = "animation";
    else if ("document" in msg && msg.document) mediaType = "document";
    else if ("audio" in msg && msg.audio) mediaType = "audio";
    else if ("voice" in msg && msg.voice) mediaType = "voice";
    return { text: null, mediaType, mediaCaption: msg.caption };
  }
  if ("photo" in msg && msg.photo) return { text: null, mediaType: "photo", mediaCaption: null };
  if ("video" in msg && msg.video) return { text: null, mediaType: "video", mediaCaption: null };
  if ("document" in msg && msg.document)
    return { text: null, mediaType: "document", mediaCaption: null };
  if ("audio" in msg && msg.audio) return { text: null, mediaType: "audio", mediaCaption: null };
  if ("animation" in msg && msg.animation)
    return { text: null, mediaType: "animation", mediaCaption: null };
  if ("voice" in msg && msg.voice) return { text: null, mediaType: "voice", mediaCaption: null };
  if ("video_note" in msg && msg.video_note)
    return { text: null, mediaType: "video_note", mediaCaption: null };
  if ("sticker" in msg && msg.sticker)
    return { text: null, mediaType: "sticker", mediaCaption: null };
  return { text: null, mediaType: null, mediaCaption: null };
}

function senderName(ctx: GrammyContext): string | null {
  const from = (ctx.channelPost ?? ctx.editedChannelPost)?.sender_chat;
  if (from) {
    if (from.title) return from.title;
    if ("username" in from && from.username) return `@${from.username}`;
  }
  return null;
}

/**
 * Insert (or re-insert) a channel post captured from a Telegram update.
 * Uses UPSERT so re-deliveries and edits are idempotent. On edit, updates the
 * text/caption and stamps `edited_at`.
 */
export function captureChannelPost(ctx: GrammyContext): ChannelPost | null {
  const msg = ctx.channelPost ?? ctx.editedChannelPost;
  if (!msg) return null;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const sender = senderName(ctx);
  const isEdit = !!ctx.editedChannelPost;
  const { text, mediaType, mediaCaption } = extractPostFields(msg);
  const now = new Date().toISOString();
  const originalDate = new Date(msg.date * 1000).toISOString();

  if (isEdit) {
    getDb()
      .prepare(
        `INSERT INTO channel_posts (chat_id, message_id, sender, text, media_type, media_caption, created_at, edited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id) DO UPDATE SET
           text = COALESCE(excluded.text, channel_posts.text),
           media_caption = COALESCE(excluded.media_caption, channel_posts.media_caption),
           edited_at = excluded.edited_at`
      )
      .run(chatId, messageId, sender, text, mediaType, mediaCaption, originalDate, now);
  } else {
    getDb()
      .prepare(
        `INSERT INTO channel_posts (chat_id, message_id, sender, text, media_type, media_caption, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id) DO UPDATE SET
           sender = COALESCE(excluded.sender, channel_posts.sender),
           text = COALESCE(excluded.text, channel_posts.text),
           media_type = COALESCE(excluded.media_type, channel_posts.media_type),
           media_caption = COALESCE(excluded.media_caption, channel_posts.media_caption)`
      )
      .run(chatId, messageId, sender, text, mediaType, mediaCaption, originalDate);
  }

  return getChannelPost(chatId, messageId);
}

export function getChannelPost(chatId: number, messageId: number): ChannelPost | null {
  const row = getDb()
    .prepare<
      [number, number],
      ChannelPostRow
    >("SELECT * FROM channel_posts WHERE chat_id = ? AND message_id = ?")
    .get(chatId, messageId);
  return row ? rowToPost(row) : null;
}

export function listChannelPosts(chatId: number, limit = 20): ChannelPost[] {
  const rows = getDb()
    .prepare<[number, number], ChannelPostRow>(
      `SELECT * FROM channel_posts
       WHERE chat_id = ? AND deleted_at IS NULL
       ORDER BY message_id DESC
       LIMIT ?`
    )
    .all(chatId, limit);
  return rows.reverse().map(rowToPost);
}

export function markChannelPostDeleted(chatId: number, messageId: number): boolean {
  const now = new Date().toISOString();
  const r = getDb()
    .prepare(
      "UPDATE channel_posts SET deleted_at = ? WHERE chat_id = ? AND message_id = ? AND deleted_at IS NULL"
    )
    .run(now, chatId, messageId);
  return r.changes > 0;
}

export function countChannelPosts(chatId: number): number {
  const row = getDb()
    .prepare<
      [number],
      { count: number }
    >("SELECT COUNT(*) AS count FROM channel_posts WHERE chat_id = ? AND deleted_at IS NULL")
    .get(chatId);
  return row?.count ?? 0;
}

export interface ChannelService {
  capture(ctx: GrammyContext): ChannelPost | null;
  get(chatId: number, messageId: number): ChannelPost | null;
  list(chatId: number, limit?: number): ChannelPost[];
  markDeleted(chatId: number, messageId: number): boolean;
  count(chatId: number): number;
}

export const channelService: ChannelService = {
  capture: captureChannelPost,
  get: getChannelPost,
  list: listChannelPosts,
  markDeleted: markChannelPostDeleted,
  count: countChannelPosts,
};
