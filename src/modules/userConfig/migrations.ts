import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_configs (
          user_id       INTEGER PRIMARY KEY,
          api_key       TEXT,
          base_url      TEXT,
          model         TEXT,
          max_tokens    INTEGER,
          system_prompt TEXT
        );

        CREATE TABLE IF NOT EXISTS user_mcp_servers (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          name       TEXT    NOT NULL,
          config     TEXT    NOT NULL,
          created_at TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_umcp_user_id ON user_mcp_servers(user_id);

        CREATE TABLE IF NOT EXISTS user_mcp_inputs (
          server_id  INTEGER NOT NULL,
          input_id   TEXT    NOT NULL,
          value      TEXT    NOT NULL,
          PRIMARY KEY (server_id, input_id)
        );
      `);
    },
  },
  {
    // Skye is now SaaS-first: per-user provider config (BYOK) is removed.
    // Drop the now-unused columns where the SQLite version supports it; on
    // older SQLite (<3.35) the orphan columns are harmless and unread.
    id: "002-drop-provider-columns",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(user_configs)") as { name: string }[]).map((c) => c.name)
      );
      for (const col of ["api_key", "base_url", "model", "max_tokens"]) {
        if (!cols.has(col)) continue;
        try {
          db.exec(`ALTER TABLE user_configs DROP COLUMN ${col}`);
        } catch {
          // Older SQLite — leave the orphan column.
        }
      }
    },
  },
  {
    id: "003-add-personality",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(user_configs)") as { name: string }[]).map((c) => c.name)
      );
      if (!cols.has("personality")) {
        db.exec("ALTER TABLE user_configs ADD COLUMN personality TEXT NOT NULL DEFAULT 'skye'");
      }
    },
  },
  {
    id: "004-connector-sessions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_connector_sessions (
          user_id    INTEGER NOT NULL,
          provider   TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, provider)
        );
      `);
    },
  },
  {
    id: "005-remove-unsafe-connector-transports",
    up: (db) => {
      const rows = db.prepare("SELECT id, config FROM user_mcp_servers").all() as Array<{
        id: number;
        config: string;
      }>;
      const remove = db.prepare("DELETE FROM user_mcp_servers WHERE id = ?");
      const removeInputs = db.prepare("DELETE FROM user_mcp_inputs WHERE server_id = ?");
      for (const row of rows) {
        let safe = false;
        try {
          const config = JSON.parse(row.config) as Record<string, unknown>;
          const url = typeof config.url === "string" ? new URL(config.url) : null;
          const headers = config.headers;
          const safeHeaders =
            headers === undefined ||
            (headers !== null &&
              typeof headers === "object" &&
              !Array.isArray(headers) &&
              Object.entries(headers).every(
                ([key, value]) =>
                  /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key) &&
                  typeof value === "string" &&
                  /^\$\{input:[A-Za-z_][A-Za-z0-9_]{0,63}\}$/.test(value)
              ));
          safe =
            config.type === "http" &&
            url?.protocol === "https:" &&
            !url.username &&
            !url.password &&
            safeHeaders &&
            !Object.keys(config).some((key) => !["type", "url", "headers"].includes(key));
        } catch {
          safe = false;
        }
        if (!safe) {
          removeInputs.run(row.id);
          remove.run(row.id);
        }
      }
    },
  },
  {
    id: "006-connector-session-provider-key",
    up: (db) => {
      const columns = db.pragma("table_info(user_connector_sessions)") as Array<{
        name: string;
        pk: number;
      }>;
      const userKey = columns.find((column) => column.name === "user_id")?.pk;
      const providerKey = columns.find((column) => column.name === "provider")?.pk;
      if (userKey === 1 && providerKey === 2) return;
      db.exec(`
        CREATE TABLE user_connector_sessions_v2 (
          user_id    INTEGER NOT NULL,
          provider   TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, provider)
        );
        INSERT OR REPLACE INTO user_connector_sessions_v2
          (user_id, provider, session_id, created_at, updated_at)
        SELECT user_id, provider, session_id, created_at, updated_at
        FROM user_connector_sessions;
        DROP TABLE user_connector_sessions;
        ALTER TABLE user_connector_sessions_v2 RENAME TO user_connector_sessions;
      `);
    },
  },
  {
    id: "007-rename-custom-connector-tables",
    up: (db) => {
      db.exec(`
        ALTER TABLE user_mcp_servers RENAME TO user_custom_connectors;
        ALTER TABLE user_mcp_inputs RENAME TO user_connector_inputs;
        DROP INDEX IF EXISTS idx_umcp_user_id;
        CREATE INDEX idx_ucc_user_id ON user_custom_connectors(user_id);
      `);
    },
  },
  {
    id: "008-primary-agent",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(user_configs)") as { name: string }[]).map((c) => c.name)
      );
      if (!cols.has("primary_agent_id")) {
        db.exec("ALTER TABLE user_configs ADD COLUMN primary_agent_id TEXT");
      }
    },
  },
];
