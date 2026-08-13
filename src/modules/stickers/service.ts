import { getDb } from "../../core/db.js";
import { SEED_STICKERS } from "./seed.js";

const MAX_DESCRIPTION_LENGTH = 280;
const MAX_STICKERS_PER_CHAT = 100;

export interface ChatSticker {
  id: string;
  chatId: number;
  fileId: string;
  fileUniqueId: string;
  description: string;
  emoji?: string;
  setName?: string;
  thumbFileId?: string;
  isAnimated: boolean;
  isVideo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StickerInput {
  id?: string;
  fileId: string;
  fileUniqueId: string;
  description: string;
  emoji?: string;
  setName?: string;
  thumbFileId?: string;
  isAnimated?: boolean;
  isVideo?: boolean;
}

export interface TeachState {
  enabled: boolean;
  seedIndex: number | null;
  pendingDesc: string | null;
  pendingPayload: StickerInput | null;
  updatedAt: string;
}

interface StickerRow {
  chatId: number;
  id: string;
  fileId: string;
  fileUniqueId: string;
  description: string;
  emoji: string | null;
  setName: string | null;
  thumbFileId: string | null;
  isAnimated: number;
  isVideo: number;
  createdAt: string;
  updatedAt: string;
}

interface TeachRow {
  enabled: number;
  seedIndex: number | null;
  pendingDesc: string | null;
  pendingPayload: string | null;
  updatedAt: string;
}

const SELECT_COLUMNS = `
  chat_id AS chatId, id, file_id AS fileId, file_unique_id AS fileUniqueId,
  description, emoji, set_name AS setName, thumb_file_id AS thumbFileId,
  is_animated AS isAnimated, is_video AS isVideo,
  created_at AS createdAt, updated_at AS updatedAt
`;

function toSticker(row: StickerRow): ChatSticker {
  return {
    chatId: row.chatId,
    id: row.id,
    fileId: row.fileId,
    fileUniqueId: row.fileUniqueId,
    description: row.description,
    ...(row.emoji ? { emoji: row.emoji } : {}),
    ...(row.setName ? { setName: row.setName } : {}),
    ...(row.thumbFileId ? { thumbFileId: row.thumbFileId } : {}),
    isAnimated: row.isAnimated === 1,
    isVideo: row.isVideo === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeDescription(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_LENGTH);
}

export function listStickers(chatId: number): ChatSticker[] {
  return getDb()
    .prepare<[number], StickerRow>(
      `SELECT ${SELECT_COLUMNS} FROM chat_stickers
       WHERE chat_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(chatId)
    .map(toSticker);
}

export function getSticker(chatId: number, id: string): ChatSticker | undefined {
  const row = getDb()
    .prepare<
      [number, string],
      StickerRow
    >(`SELECT ${SELECT_COLUMNS} FROM chat_stickers WHERE chat_id = ? AND id = ?`)
    .get(chatId, id);
  return row ? toSticker(row) : undefined;
}

export function findByUniqueId(chatId: number, fileUniqueId: string): ChatSticker | undefined {
  const row = getDb()
    .prepare<[number, string], StickerRow>(
      `SELECT ${SELECT_COLUMNS} FROM chat_stickers
       WHERE chat_id = ? AND file_unique_id = ?`
    )
    .get(chatId, fileUniqueId);
  return row ? toSticker(row) : undefined;
}

export function countStickers(chatId: number): number {
  const row = getDb()
    .prepare<[number], { n: number }>(`SELECT COUNT(*) AS n FROM chat_stickers WHERE chat_id = ?`)
    .get(chatId);
  return row?.n ?? 0;
}

export function upsertSticker(chatId: number, input: StickerInput): ChatSticker {
  const description = normalizeDescription(input.description);
  if (!description) throw new Error("Sticker description is required.");
  if (!input.fileId.trim() || !input.fileUniqueId.trim()) {
    throw new Error("Telegram file_id and file_unique_id are required.");
  }

  const existingByUnique = findByUniqueId(chatId, input.fileUniqueId);
  const requestedId = input.id?.trim();
  const existingById = requestedId ? getSticker(chatId, requestedId) : undefined;
  const now = new Date().toISOString();

  // Caller wants a specific catalog id (seed pack). Re-key if this Telegram
  // file was previously saved under a different id.
  if (requestedId && existingByUnique && existingByUnique.id !== requestedId) {
    getDb()
      .prepare(`DELETE FROM chat_stickers WHERE chat_id = ? AND id = ?`)
      .run(chatId, existingByUnique.id);
  } else if (existingByUnique && !requestedId) {
    getDb()
      .prepare(
        `UPDATE chat_stickers SET
           file_id = ?, description = ?, emoji = ?, set_name = ?, thumb_file_id = ?,
           is_animated = ?, is_video = ?, updated_at = ?
         WHERE chat_id = ? AND id = ?`
      )
      .run(
        input.fileId,
        description,
        input.emoji ?? null,
        input.setName ?? null,
        input.thumbFileId ?? null,
        input.isAnimated ? 1 : 0,
        input.isVideo ? 1 : 0,
        now,
        chatId,
        existingByUnique.id
      );
    const saved = getSticker(chatId, existingByUnique.id);
    if (!saved) throw new Error("Failed to update sticker.");
    return saved;
  }

  const id = requestedId || existingByUnique?.id || cryptoRandomId();
  if (
    !existingById &&
    !findByUniqueId(chatId, input.fileUniqueId) &&
    countStickers(chatId) >= MAX_STICKERS_PER_CHAT
  ) {
    throw new Error(`This chat already has ${MAX_STICKERS_PER_CHAT} stickers.`);
  }

  getDb()
    .prepare(
      `INSERT INTO chat_stickers (
         chat_id, id, file_id, file_unique_id, description, emoji, set_name,
         thumb_file_id, is_animated, is_video, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, id) DO UPDATE SET
         file_id = excluded.file_id,
         file_unique_id = excluded.file_unique_id,
         description = excluded.description,
         emoji = excluded.emoji,
         set_name = excluded.set_name,
         thumb_file_id = excluded.thumb_file_id,
         is_animated = excluded.is_animated,
         is_video = excluded.is_video,
         updated_at = excluded.updated_at`
    )
    .run(
      chatId,
      id,
      input.fileId,
      input.fileUniqueId,
      description,
      input.emoji ?? null,
      input.setName ?? null,
      input.thumbFileId ?? null,
      input.isAnimated ? 1 : 0,
      input.isVideo ? 1 : 0,
      existingById?.createdAt ?? now,
      now
    );

  const saved = getSticker(chatId, id);
  if (!saved) throw new Error("Failed to save sticker.");
  return saved;
}

export function updateDescription(
  chatId: number,
  id: string,
  description: string
): ChatSticker | undefined {
  const normalized = normalizeDescription(description);
  if (!normalized) return undefined;
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE chat_stickers SET description = ?, updated_at = ? WHERE chat_id = ? AND id = ?`
    )
    .run(normalized, now, chatId, id);
  if (result.changes === 0) return undefined;
  return getSticker(chatId, id);
}

export function deleteSticker(chatId: number, id: string): boolean {
  return (
    getDb().prepare(`DELETE FROM chat_stickers WHERE chat_id = ? AND id = ?`).run(chatId, id)
      .changes > 0
  );
}

export function clearStickers(chatId: number): number {
  return getDb().prepare(`DELETE FROM chat_stickers WHERE chat_id = ?`).run(chatId).changes;
}

export function getTeachState(chatId: number): TeachState {
  const row = getDb()
    .prepare<[number], TeachRow>(
      `SELECT enabled, seed_index AS seedIndex, pending_desc AS pendingDesc,
              pending_payload AS pendingPayload, updated_at AS updatedAt
       FROM chat_sticker_teach WHERE chat_id = ?`
    )
    .get(chatId);
  if (!row) {
    return {
      enabled: false,
      seedIndex: null,
      pendingDesc: null,
      pendingPayload: null,
      updatedAt: "",
    };
  }
  let pendingPayload: StickerInput | null = null;
  if (row.pendingPayload) {
    try {
      pendingPayload = JSON.parse(row.pendingPayload) as StickerInput;
    } catch {
      pendingPayload = null;
    }
  }
  return {
    enabled: row.enabled === 1,
    seedIndex: row.seedIndex,
    pendingDesc: row.pendingDesc,
    pendingPayload,
    updatedAt: row.updatedAt,
  };
}

export function setTeachState(
  chatId: number,
  patch: {
    enabled?: boolean;
    seedIndex?: number | null;
    pendingDesc?: string | null;
    pendingPayload?: StickerInput | null;
  }
): TeachState {
  const current = getTeachState(chatId);
  const enabled = patch.enabled ?? current.enabled;
  const seedIndex = patch.seedIndex !== undefined ? patch.seedIndex : current.seedIndex;
  const pendingDesc = patch.pendingDesc !== undefined ? patch.pendingDesc : current.pendingDesc;
  const pendingPayload =
    patch.pendingPayload !== undefined ? patch.pendingPayload : current.pendingPayload;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO chat_sticker_teach
         (chat_id, enabled, seed_index, pending_desc, pending_payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         enabled = excluded.enabled,
         seed_index = excluded.seed_index,
         pending_desc = excluded.pending_desc,
         pending_payload = excluded.pending_payload,
         updated_at = excluded.updated_at`
    )
    .run(
      chatId,
      enabled ? 1 : 0,
      seedIndex,
      pendingDesc,
      pendingPayload ? JSON.stringify(pendingPayload) : null,
      now
    );
  return getTeachState(chatId);
}

export function disableTeach(chatId: number): void {
  setTeachState(chatId, {
    enabled: false,
    seedIndex: null,
    pendingDesc: null,
    pendingPayload: null,
  });
}

export function startTeach(chatId: number): TeachState {
  return setTeachState(chatId, {
    enabled: true,
    seedIndex: null,
    pendingDesc: null,
    pendingPayload: null,
  });
}

export function startSeedTeach(chatId: number): {
  state: TeachState;
  next: (typeof SEED_STICKERS)[number] | null;
} {
  const nextIndex = firstMissingSeedIndex(chatId);
  if (nextIndex == null) {
    return { state: getTeachState(chatId), next: null };
  }
  const state = setTeachState(chatId, {
    enabled: true,
    seedIndex: nextIndex,
    pendingDesc: null,
    pendingPayload: null,
  });
  return { state, next: SEED_STICKERS[nextIndex] ?? null };
}

export function firstMissingSeedIndex(chatId: number): number | null {
  const existing = new Set(listStickers(chatId).map((s) => s.id));
  for (let i = 0; i < SEED_STICKERS.length; i++) {
    if (!existing.has(SEED_STICKERS[i].id)) return i;
  }
  return null;
}

export function currentSeedTarget(chatId: number): (typeof SEED_STICKERS)[number] | null {
  const state = getTeachState(chatId);
  if (!state.enabled || state.seedIndex == null) return null;
  return SEED_STICKERS[state.seedIndex] ?? null;
}

export function advanceSeedAfterSave(chatId: number): (typeof SEED_STICKERS)[number] | null {
  const nextIndex = firstMissingSeedIndex(chatId);
  if (nextIndex == null) {
    disableTeach(chatId);
    return null;
  }
  setTeachState(chatId, {
    enabled: true,
    seedIndex: nextIndex,
    pendingDesc: null,
    pendingPayload: null,
  });
  return SEED_STICKERS[nextIndex] ?? null;
}

function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}

export interface StickersService {
  list(chatId: number): ChatSticker[];
  get(chatId: number, id: string): ChatSticker | undefined;
  findByUniqueId(chatId: number, fileUniqueId: string): ChatSticker | undefined;
  count(chatId: number): number;
  upsert(chatId: number, input: StickerInput): ChatSticker;
  updateDescription(chatId: number, id: string, description: string): ChatSticker | undefined;
  delete(chatId: number, id: string): boolean;
  clear(chatId: number): number;
  getTeachState(chatId: number): TeachState;
  setTeachState(
    chatId: number,
    patch: {
      enabled?: boolean;
      seedIndex?: number | null;
      pendingDesc?: string | null;
      pendingPayload?: StickerInput | null;
    }
  ): TeachState;
  disableTeach(chatId: number): void;
  startTeach(chatId: number): TeachState;
  startSeedTeach(chatId: number): {
    state: TeachState;
    next: (typeof SEED_STICKERS)[number] | null;
  };
  currentSeedTarget(chatId: number): (typeof SEED_STICKERS)[number] | null;
  advanceSeedAfterSave(chatId: number): (typeof SEED_STICKERS)[number] | null;
  maxPerChat: number;
  seedStickers: typeof SEED_STICKERS;
}

export const stickersService: StickersService = {
  list: listStickers,
  get: getSticker,
  findByUniqueId,
  count: countStickers,
  upsert: upsertSticker,
  updateDescription,
  delete: deleteSticker,
  clear: clearStickers,
  getTeachState,
  setTeachState,
  disableTeach,
  startTeach,
  startSeedTeach,
  currentSeedTarget,
  advanceSeedAfterSave,
  maxPerChat: MAX_STICKERS_PER_CHAT,
  seedStickers: SEED_STICKERS,
};
