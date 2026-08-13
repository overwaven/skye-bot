import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reminders (
          id            TEXT    PRIMARY KEY,
          chat_id       INTEGER NOT NULL,
          thread_id     INTEGER,
          user_id       INTEGER,
          prompt        TEXT    NOT NULL,
          fire_at       TEXT    NOT NULL,
          repeat        TEXT    NOT NULL DEFAULT 'none',
          created_at    TEXT    NOT NULL,
          active        INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_chat ON reminders(chat_id, active);
        CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(fire_at, active);
      `);
    },
  },
];
