import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-provider-registry",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_providers (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          kind            TEXT NOT NULL,
          base_url        TEXT NOT NULL,
          api_key_enc     TEXT NOT NULL DEFAULT '',
          enabled         INTEGER NOT NULL DEFAULT 1,
          status          TEXT NOT NULL DEFAULT 'untested',
          last_error      TEXT,
          tested_at       TEXT,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_models (
          id              TEXT PRIMARY KEY,
          provider_id     TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          upstream_id     TEXT NOT NULL,
          capabilities    TEXT NOT NULL,
          context_window  INTEGER NOT NULL DEFAULT 128000,
          multiplier      REAL NOT NULL DEFAULT 1,
          enabled         INTEGER NOT NULL DEFAULT 1,
          config          TEXT NOT NULL DEFAULT '{}',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          UNIQUE(provider_id, upstream_id, capabilities)
        );
        CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);

        CREATE TABLE IF NOT EXISTS ai_routing_defaults (
          singleton                  INTEGER PRIMARY KEY CHECK(singleton = 1),
          text_model_id              TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          image_generation_model_id  TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          image_edit_model_id        TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          tts_model_id               TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          stt_model_id               TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          tts_voice                  TEXT,
          updated_at                 TEXT NOT NULL
        );
        INSERT OR IGNORE INTO ai_routing_defaults (singleton, updated_at)
        VALUES (1, datetime('now'));

        CREATE TABLE IF NOT EXISTS chat_ai_routing (
          chat_id                    INTEGER PRIMARY KEY,
          text_model_id              TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          image_generation_model_id  TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          image_edit_model_id        TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          tts_model_id               TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          stt_model_id               TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
          tts_voice                  TEXT,
          updated_at                 TEXT NOT NULL
        );
      `);
    },
  },
];
