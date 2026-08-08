import type Database from "better-sqlite3";
import type { Migration } from "../../core/module.js";
import { PERSONALITY_TEMPLATES } from "../llm/prompt.js";

export const migrations: Migration[] = [
  {
    id: "001-thread-agents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_thread_agents (
          chat_id    INTEGER NOT NULL,
          thread_id  INTEGER NOT NULL DEFAULT 0,
          agent_id   TEXT    NOT NULL,
          updated_at TEXT    NOT NULL,
          PRIMARY KEY (chat_id, thread_id)
        );
      `);
    },
  },
  {
    id: "002-user-agents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_agents (
          owner_user_id INTEGER NOT NULL,
          id            TEXT    NOT NULL,
          name          TEXT    NOT NULL,
          description   TEXT    NOT NULL,
          instructions  TEXT    NOT NULL,
          model_id      TEXT,
          created_at    TEXT    NOT NULL,
          updated_at    TEXT    NOT NULL,
          PRIMARY KEY (owner_user_id, id)
        );

        CREATE TABLE IF NOT EXISTS user_thread_agents (
          owner_user_id INTEGER NOT NULL,
          chat_id       INTEGER NOT NULL,
          thread_id     INTEGER NOT NULL DEFAULT 0,
          agent_id      TEXT    NOT NULL,
          updated_at    TEXT    NOT NULL,
          PRIMARY KEY (owner_user_id, chat_id, thread_id),
          FOREIGN KEY (owner_user_id, agent_id)
            REFERENCES user_agents(owner_user_id, id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: "003-user-agent-drafts",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_agent_drafts (
          owner_user_id INTEGER NOT NULL,
          chat_id       INTEGER NOT NULL,
          thread_id     INTEGER NOT NULL DEFAULT 0,
          step          TEXT    NOT NULL,
          name          TEXT,
          description   TEXT,
          instructions  TEXT,
          model_id      TEXT,
          updated_at    TEXT    NOT NULL,
          PRIMARY KEY (owner_user_id, chat_id, thread_id)
        );
      `);
    },
  },
  {
    id: "004-user-agent-models",
    up: (db) => {
      const agentColumns = new Set(
        (db.pragma("table_info(user_agents)") as { name: string }[]).map((column) => column.name)
      );
      if (!agentColumns.has("model_id")) {
        db.exec("ALTER TABLE user_agents ADD COLUMN model_id TEXT");
      }
      const draftColumns = new Set(
        (db.pragma("table_info(user_agent_drafts)") as { name: string }[]).map(
          (column) => column.name
        )
      );
      if (!draftColumns.has("model_id")) {
        db.exec("ALTER TABLE user_agent_drafts ADD COLUMN model_id TEXT");
      }
    },
  },
  {
    id: "005-chat-agents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_agents (
          chat_id       INTEGER NOT NULL,
          id            TEXT    NOT NULL,
          name          TEXT    NOT NULL,
          description   TEXT    NOT NULL,
          instructions  TEXT    NOT NULL,
          model_id      TEXT,
          created_at    TEXT    NOT NULL,
          updated_at    TEXT    NOT NULL,
          PRIMARY KEY (chat_id, id)
        );

        CREATE TABLE IF NOT EXISTS chat_agent_selection (
          chat_id    INTEGER PRIMARY KEY,
          agent_id   TEXT    NOT NULL,
          updated_at TEXT    NOT NULL,
          FOREIGN KEY (chat_id, agent_id)
            REFERENCES chat_agents(chat_id, id) ON DELETE CASCADE
        );
      `);

      migrateThreadAgentsToChatAgents(db);
      clearGroupPersonalSelections(db);
      migratePersonalityToPrimaryAgents(db);
    },
  },
];

function migrateThreadAgentsToChatAgents(db: Database.Database): void {
  const tables = (
    db.pragma("table_info(chat_thread_agents)") as { name: string }[] | undefined
  )?.map((column) => column.name);
  if (!tables?.length) return;

  const rows = db
    .prepare(
      `SELECT chat_id AS chatId, thread_id AS threadId, agent_id AS agentId, updated_at AS updatedAt
       FROM chat_thread_agents
       ORDER BY chat_id, CASE WHEN thread_id = 0 THEN 0 ELSE 1 END, thread_id`
    )
    .all() as Array<{ chatId: number; threadId: number; agentId: string; updatedAt: string }>;

  const seenChats = new Set<number>();
  const insertAgent = db.prepare(
    `INSERT OR IGNORE INTO chat_agents
      (chat_id, id, name, description, instructions, model_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
  );
  const insertSelection = db.prepare(
    `INSERT OR IGNORE INTO chat_agent_selection (chat_id, agent_id, updated_at)
     VALUES (?, ?, ?)`
  );

  for (const row of rows) {
    if (seenChats.has(row.chatId)) continue;
    seenChats.add(row.chatId);

    const storedId = row.agentId.startsWith("chat_")
      ? row.agentId.slice("chat_".length)
      : row.agentId.startsWith("my_")
        ? row.agentId.slice("my_".length)
        : row.agentId;
    const id = storedId.slice(0, 32);
    const now = row.updatedAt || new Date().toISOString();
    insertAgent.run(
      row.chatId,
      id,
      id,
      `Migrated agent ${id}`,
      `You are ${id}. Continue helping this chat with clear, useful answers.`,
      now,
      now
    );
    insertSelection.run(row.chatId, id, now);
  }
}

function clearGroupPersonalSelections(db: Database.Database): void {
  // Telegram group/supergroup chat ids are negative; DM chat id equals the user id.
  db.prepare(
    `DELETE FROM user_thread_agents
     WHERE chat_id < 0 OR chat_id != owner_user_id`
  ).run();
}

function migratePersonalityToPrimaryAgents(db: Database.Database): void {
  const configCols = new Set(
    (db.pragma("table_info(user_configs)") as { name: string }[]).map((column) => column.name)
  );
  if (!configCols.has("user_id")) return;
  if (!configCols.has("primary_agent_id")) {
    db.exec("ALTER TABLE user_configs ADD COLUMN primary_agent_id TEXT");
  }

  const users = db
    .prepare(
      `SELECT user_id AS userId, personality, system_prompt AS systemPrompt, primary_agent_id AS primaryAgentId
       FROM user_configs`
    )
    .all() as Array<{
    userId: number;
    personality: string | null;
    systemPrompt: string | null;
    primaryAgentId: string | null;
  }>;

  const insertAgent = db.prepare(
    `INSERT OR IGNORE INTO user_agents
      (owner_user_id, id, name, description, instructions, model_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
  );
  const setPrimary = db.prepare(
    `UPDATE user_configs SET primary_agent_id = ? WHERE user_id = ?`
  );

  for (const user of users) {
    if (user.primaryAgentId) continue;
    const personality = user.personality ?? "skye";
    const custom = user.systemPrompt?.trim() ?? "";
    const needsMigration = (personality !== "skye" && personality !== "") || custom.length > 0;
    if (!needsMigration) continue;

    const templateId = personality === "skye.exe" ? "skye_exe" : personality;
    const template =
      PERSONALITY_TEMPLATES.find((item) => item.id === templateId) ?? PERSONALITY_TEMPLATES[0]!;
    const instructions = custom
      ? `${template.instructions}\n\nAdditional user preferences:\n${custom}`
      : template.instructions;
    const now = new Date().toISOString();
    const id = "primary";
    insertAgent.run(
      user.userId,
      id,
      template.name,
      template.description,
      instructions,
      now,
      now
    );
    setPrimary.run(id, user.userId);
  }
}
