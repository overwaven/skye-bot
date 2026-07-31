import { test, expect, describe, beforeEach } from "vitest";
import { deleteUserData, legalService } from "../service.js";
import { getDb } from "../../../core/db.js";

const USER = 424242;

function seed(userId: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare("INSERT INTO user_configs (user_id, system_prompt) VALUES (?, ?)").run(
    userId,
    "custom prompt"
  );
  db.prepare(
    "INSERT INTO user_custom_connectors (user_id, name, config, created_at) VALUES (?, ?, ?, ?)"
  ).run(userId, "srv", "{}", now);
  db.prepare("INSERT INTO user_connector_inputs (server_id, input_id, value) VALUES (?, ?, ?)").run(
    1,
    "tok",
    "abc"
  );
  db.prepare(
    "INSERT INTO user_connector_sessions (user_id, provider, session_id, created_at, updated_at) VALUES (?, 'composio', 'session_1', ?, ?)"
  ).run(userId, now, now);

  db.prepare(
    `INSERT INTO billing_accounts
      (user_id, model_id, sub_status, sub_expires_at, sub_period_start,
       base_used_tokens, packs_tokens, total_used_tokens, last_charge_id,
       created_at, updated_at)
     VALUES (?, 'sydney', 'active', 0, 0, 0, 0, 0, NULL, ?, ?)`
  ).run(userId, now, now);
  db.prepare(
    "INSERT INTO billing_events (user_id, type, payload, amount, created_at) VALUES (?, 'token_spend', NULL, 1, ?)"
  ).run(userId, now);

  db.prepare("INSERT INTO memories (id, chat_id, content, created_at) VALUES (?, ?, ?, ?)").run(
    "mem_x",
    userId,
    "a memory",
    now
  );
  db.prepare("INSERT INTO chat_summaries (chat_id, summary) VALUES (?, ?)").run(userId, "summary");
  db.prepare(
    `INSERT INTO conversation_items
      (chat_id, thread_key, message_id, role, content_json, text, created_at)
     VALUES (?, ?, NULL, 'user', '{}', 'hi', ?)`
  ).run(userId, String(userId), now);
  db.prepare(
    "INSERT INTO group_messages (chat_id, message_id, sender, timestamp, type, content, reply_to) VALUES (?, NULL, 'u', ?, 'text', 'hi', NULL)"
  ).run(userId, now);
  db.prepare("INSERT INTO chat_configs (chat_id, voice_reply_mode) VALUES (?, 'always')").run(
    userId
  );
  db.prepare(
    `INSERT INTO chat_stickers
      (chat_id, id, file_id, file_unique_id, description, emoji, set_name, thumb_file_id,
       is_animated, is_video, created_at, updated_at)
     VALUES (?, 'st1', 'fid', 'fuid', 'test sticker', NULL, NULL, NULL, 0, 0, ?, ?)`
  ).run(userId, now, now);
  db.prepare(
    `INSERT INTO chat_sticker_teach (chat_id, enabled, seed_index, pending_desc, pending_payload, updated_at)
     VALUES (?, 1, 0, NULL, NULL, ?)`
  ).run(userId, now);
  db.prepare(
    "INSERT INTO reminders (id, chat_id, thread_id, user_id, prompt, fire_at, repeat, created_at, active) VALUES (?, ?, NULL, ?, 'x', ?, 'none', ?, 1)"
  ).run("rem_1", userId, userId, now, now);
  db.prepare(
    `INSERT INTO request_logs
      (ts, chat_id, chat_type, thread_id, user_id, username, first_name,
       msg_type, command, input_len, output_len, latency_ms, model, status, error_msg)
     VALUES (?, ?, 'private', NULL, ?, NULL, NULL, 'text', NULL, 1, 1, 1, 'sydney', 'ok', NULL)`
  ).run(now, userId, userId);
}

function counts(userId: number): Record<string, number> {
  const db = getDb();
  const byUser = [
    "user_configs",
    "user_custom_connectors",
    "user_connector_sessions",
    "billing_accounts",
    "billing_events",
    "reminders",
    "request_logs",
  ];
  const byChat = [
    "memories",
    "chat_summaries",
    "conversation_items",
    "group_messages",
    "chat_configs",
    "chat_stickers",
    "chat_sticker_teach",
  ];
  const out: Record<string, number> = {};
  for (const t of byUser) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE user_id = ?`).get(userId) as {
      c: number;
    };
    out[t] = row.c;
  }
  for (const t of byChat) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE chat_id = ?`).get(userId) as {
      c: number;
    };
    out[t] = row.c;
  }
  const connectorInputs = db
    .prepare(
      `SELECT COUNT(*) AS c FROM user_connector_inputs
       WHERE server_id IN (SELECT id FROM user_custom_connectors WHERE user_id = ?)`
    )
    .get(userId) as { c: number };
  out.user_connector_inputs = connectorInputs.c;
  return out;
}

beforeEach(() => {
  const db = getDb();
  db.exec(`
    DELETE FROM user_connector_inputs;
    DELETE FROM user_custom_connectors;
    DELETE FROM user_connector_sessions;
    DELETE FROM user_configs;
    DELETE FROM billing_events;
    DELETE FROM billing_accounts;
    DELETE FROM memories;
    DELETE FROM chat_summaries;
    DELETE FROM conversation_items;
    DELETE FROM group_messages;
    DELETE FROM chat_configs;
    DELETE FROM chat_stickers;
    DELETE FROM chat_sticker_teach;
    DELETE FROM reminders;
    DELETE FROM request_logs;
  `);
});

describe("deleteUserData", () => {
  test("wipes all per-user and private-chat data", () => {
    seed(USER);

    const summary = deleteUserData(USER);

    expect(summary.userConfigs).toBe(1);
    expect(summary.customConnectors).toBe(1);
    expect(summary.customConnectorInputs).toBe(1);
    expect(summary.connectorSessions).toBe(1);
    expect(summary.billingAccounts).toBe(1);
    expect(summary.billingEvents).toBe(1);
    expect(summary.memories).toBe(1);
    expect(summary.chatSummaries).toBe(1);
    expect(summary.conversationItems).toBe(1);
    expect(summary.groupMessages).toBe(1);
    expect(summary.chatConfigs).toBe(1);
    expect(summary.chatStickers).toBe(1);
    expect(summary.chatStickerTeach).toBe(1);
    expect(summary.reminders).toBe(1);
    expect(summary.requestLogs).toBe(1);
    expect(summary.adminPrincipals).toBe(0);

    const after = counts(USER);
    for (const v of Object.values(after)) expect(v).toBe(0);
  });

  test("is a no-op for an unknown user", () => {
    const summary = deleteUserData(999999);
    for (const v of Object.values(summary)) expect(v).toBe(0);
  });

  test("is exposed on the LegalService", () => {
    expect(legalService.deleteUserData).toBe(deleteUserData);
  });
});
