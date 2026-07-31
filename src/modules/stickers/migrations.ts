import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_stickers (
          chat_id          INTEGER NOT NULL,
          id               TEXT    NOT NULL,
          file_id          TEXT    NOT NULL,
          file_unique_id   TEXT    NOT NULL,
          description      TEXT    NOT NULL,
          emoji            TEXT,
          set_name         TEXT,
          thumb_file_id    TEXT,
          is_animated      INTEGER NOT NULL DEFAULT 0,
          is_video         INTEGER NOT NULL DEFAULT 0,
          created_at       TEXT    NOT NULL,
          updated_at       TEXT    NOT NULL,
          PRIMARY KEY (chat_id, id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_stickers_unique
          ON chat_stickers(chat_id, file_unique_id);
        CREATE INDEX IF NOT EXISTS idx_chat_stickers_chat
          ON chat_stickers(chat_id);

        CREATE TABLE IF NOT EXISTS chat_sticker_teach (
          chat_id         INTEGER PRIMARY KEY,
          enabled         INTEGER NOT NULL DEFAULT 0,
          seed_index      INTEGER,
          pending_desc    TEXT,
          pending_payload TEXT,
          updated_at      TEXT    NOT NULL
        );
      `);
    },
  },
];
