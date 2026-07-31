import { describe, expect, test, beforeEach } from "vitest";
import { getDb } from "../../../core/db.js";
import { SEED_STICKERS } from "../seed.js";
import {
  advanceSeedAfterSave,
  clearStickers,
  findByUniqueId,
  getSticker,
  getTeachState,
  listStickers,
  startSeedTeach,
  startTeach,
  upsertSticker,
} from "../service.js";
import { resolveVisualMedia } from "../media.js";
import { formatStickerCatalog, createSendStickerTool } from "../tools.js";
import { stickersService } from "../service.js";
import type { TenantContext } from "../../../core/tenant.js";

const CHAT = 1001;

beforeEach(() => {
  getDb().exec(`
    DELETE FROM chat_stickers;
    DELETE FROM chat_sticker_teach;
  `);
});

describe("stickers service", () => {
  test("upserts per-chat stickers with descriptions", () => {
    const saved = upsertSticker(CHAT, {
      id: SEED_STICKERS[0].id,
      fileId: "file-hamster",
      fileUniqueId: "unique-hamster",
      description: SEED_STICKERS[0].description,
      emoji: "🐹",
    });
    expect(saved.id).toBe(SEED_STICKERS[0].id);
    expect(listStickers(CHAT)).toHaveLength(1);
    expect(listStickers(CHAT + 1)).toHaveLength(0);
    expect(getSticker(CHAT, saved.id)?.description).toContain("хомяк");
  });

  test("dedupes by file_unique_id within a chat", () => {
    upsertSticker(CHAT, {
      fileId: "file-a",
      fileUniqueId: "same-unique",
      description: "first",
    });
    const second = upsertSticker(CHAT, {
      fileId: "file-b",
      fileUniqueId: "same-unique",
      description: "updated description",
    });
    expect(listStickers(CHAT)).toHaveLength(1);
    expect(second.description).toBe("updated description");
    expect(second.fileId).toBe("file-b");
  });

  test("seed teach walks missing seed ids", () => {
    const { next } = startSeedTeach(CHAT);
    expect(next?.id).toBe(SEED_STICKERS[0].id);
    expect(getTeachState(CHAT).enabled).toBe(true);

    upsertSticker(CHAT, {
      id: SEED_STICKERS[0].id,
      fileId: "f0",
      fileUniqueId: "u0",
      description: SEED_STICKERS[0].description,
    });
    const following = advanceSeedAfterSave(CHAT);
    expect(following?.id).toBe(SEED_STICKERS[1].id);

    for (const seed of SEED_STICKERS) {
      upsertSticker(CHAT, {
        id: seed.id,
        fileId: `f-${seed.id}`,
        fileUniqueId: `u-${seed.id}`,
        description: seed.description,
      });
    }
    expect(advanceSeedAfterSave(CHAT)).toBeNull();
    expect(getTeachState(CHAT).enabled).toBe(false);
    expect(listStickers(CHAT)).toHaveLength(SEED_STICKERS.length);
  });

  test("clear removes catalog", () => {
    upsertSticker(CHAT, {
      fileId: "f",
      fileUniqueId: "u",
      description: "x",
    });
    expect(clearStickers(CHAT)).toBe(1);
    expect(listStickers(CHAT)).toHaveLength(0);
  });

  test("re-keys to seed id when same unique file is taught again", () => {
    upsertSticker(CHAT, {
      fileId: "f",
      fileUniqueId: "u-shared",
      description: "temp",
    });
    const seeded = upsertSticker(CHAT, {
      id: SEED_STICKERS[2].id,
      fileId: "f2",
      fileUniqueId: "u-shared",
      description: SEED_STICKERS[2].description,
    });
    expect(seeded.id).toBe(SEED_STICKERS[2].id);
    expect(listStickers(CHAT)).toHaveLength(1);
    expect(findByUniqueId(CHAT, "u-shared")?.id).toBe(SEED_STICKERS[2].id);
  });
});

describe("resolveVisualMedia", () => {
  test("uses static sticker file_id directly", () => {
    const resolved = resolveVisualMedia({
      kind: "sticker",
      sticker: {
        file_id: "static-file",
        file_unique_id: "u",
        type: "regular",
        width: 512,
        height: 512,
        is_animated: false,
        is_video: false,
      },
    });
    expect(resolved?.visionFileId).toBe("static-file");
  });

  test("uses thumbnail for animated stickers", () => {
    const resolved = resolveVisualMedia({
      kind: "sticker",
      sticker: {
        file_id: "tgs-file",
        file_unique_id: "u",
        type: "regular",
        width: 512,
        height: 512,
        is_animated: true,
        is_video: false,
        thumbnail: {
          file_id: "thumb-file",
          file_unique_id: "tu",
          width: 128,
          height: 128,
        },
      },
    });
    expect(resolved?.visionFileId).toBe("thumb-file");
  });

  test("uses animation thumbnail for GIFs", () => {
    const resolved = resolveVisualMedia({
      kind: "animation",
      animation: {
        file_id: "gif-mp4",
        file_unique_id: "u",
        width: 320,
        height: 240,
        duration: 2,
        thumbnail: {
          file_id: "gif-thumb",
          file_unique_id: "tu",
          width: 320,
          height: 240,
        },
      },
    });
    expect(resolved?.visionFileId).toBe("gif-thumb");
  });
});

describe("send_sticker tool", () => {
  test("prepares a sticker from the catalog", async () => {
    upsertSticker(CHAT, {
      id: "abc",
      fileId: "tg-file",
      fileUniqueId: "u",
      description: "test reaction",
    });
    const prepared: string[] = [];
    const tool = createSendStickerTool({
      stickers: stickersService,
      onPrepared: ({ sticker }) => {
        prepared.push(sticker.fileId);
      },
    });
    const tenant = {
      chatId: CHAT,
      userId: 1,
      chatType: "private",
    } as TenantContext;
    const result = await tool.execute({ sticker_id: "abc" }, tenant);
    expect(result).toContain("prepared");
    expect(prepared).toEqual(["tg-file"]);
    expect(formatStickerCatalog(listStickers(CHAT))).toContain("test reaction");
  });

  test("startTeach enables teach mode", () => {
    startTeach(CHAT);
    expect(getTeachState(CHAT).enabled).toBe(true);
  });
});
