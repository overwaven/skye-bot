import { test, expect, describe, beforeEach } from "vitest";
import {
  chatConfigService,
  getChatConfig,
  getChatThreadPrompt,
  resetChatThreadPrompt,
  setChatThreadPrompt,
  setChatVoiceReplyMode,
} from "../modules/chatConfig/service.js";
import { getDb } from "../core/db.js";
import Database from "better-sqlite3";
import { migrations } from "../modules/chatConfig/migrations.js";
import { serializeChatConfig } from "../modules/chatConfig/routes.js";

const CHAT = 77;

beforeEach(() => {
  getDb().prepare("DELETE FROM chat_configs WHERE chat_id = ?").run(CHAT);
  getDb().prepare("DELETE FROM chat_thread_prompts WHERE chat_id = ?").run(CHAT);
});

describe("getChatConfig", () => {
  test("returns defaults for an unknown chat", () => {
    expect(getChatConfig(9999)).toEqual({ voiceReplyMode: "text" });
  });
});

describe("setChatVoiceReplyMode", () => {
  test("stores every voice reply mode", () => {
    setChatVoiceReplyMode(CHAT, "auto");
    expect(getChatConfig(CHAT).voiceReplyMode).toBe("auto");
    setChatVoiceReplyMode(CHAT, "always");
    expect(getChatConfig(CHAT).voiceReplyMode).toBe("always");
    setChatVoiceReplyMode(CHAT, "text");
    expect(getChatConfig(CHAT).voiceReplyMode).toBe("text");
  });

  test("is exposed on the ChatConfigService", () => {
    chatConfigService.setVoiceReplyMode(CHAT, "auto");
    expect(chatConfigService.get(CHAT).voiceReplyMode).toBe("auto");
  });
});

describe("voice reply mode migration", () => {
  test("preserves legacy disabled and enabled values", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chat_configs (
        chat_id INTEGER PRIMARY KEY,
        voice_mode INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO chat_configs (chat_id, voice_mode) VALUES (1, 0), (2, 1);
    `);

    migrations.find((migration) => migration.id === "006-flexible-voice-replies")!.up(db);

    const rows = db
      .prepare(
        "SELECT chat_id AS chatId, voice_reply_mode AS mode FROM chat_configs ORDER BY chat_id"
      )
      .all() as { chatId: number; mode: string }[];
    expect(rows).toEqual([
      { chatId: 1, mode: "text" },
      { chatId: 2, mode: "always" },
    ]);

    db.prepare("UPDATE chat_configs SET voice_reply_mode = 'auto' WHERE chat_id = 1").run();
    migrations.find((migration) => migration.id === "006-flexible-voice-replies")!.up(db);
    expect(
      db.prepare("SELECT voice_reply_mode AS mode FROM chat_configs WHERE chat_id = 1").get()
    ).toEqual({ mode: "auto" });
    db.close();
  });
});

describe("chat config API compatibility", () => {
  test("keeps the legacy boolean while exposing the flexible mode", () => {
    expect(serializeChatConfig("text")).toEqual({ voiceReplyMode: "text", voiceMode: false });
    expect(serializeChatConfig("auto")).toEqual({ voiceReplyMode: "auto", voiceMode: false });
    expect(serializeChatConfig("always")).toEqual({
      voiceReplyMode: "always",
      voiceMode: true,
    });
  });
});

describe("thread-scoped custom prompts", () => {
  test("keeps prompts isolated between topics and the main chat", () => {
    setChatThreadPrompt(CHAT, undefined, "main prompt");
    setChatThreadPrompt(CHAT, 10, "topic ten");
    setChatThreadPrompt(CHAT, 20, "topic twenty");

    expect(getChatThreadPrompt(CHAT)).toBe("main prompt");
    expect(getChatThreadPrompt(CHAT, 10)).toBe("topic ten");
    expect(getChatThreadPrompt(CHAT, 20)).toBe("topic twenty");
    expect(getChatThreadPrompt(CHAT, 30)).toBeUndefined();
  });

  test("uses chat and topic scope rather than the user who set it", () => {
    chatConfigService.setPrompt(CHAT, 42, "shared group prompt");

    expect(chatConfigService.getPrompt(CHAT, 42)).toBe("shared group prompt");
  });

  test("reset removes only the current topic prompt", () => {
    setChatThreadPrompt(CHAT, 10, "keep separate");
    setChatThreadPrompt(CHAT, 20, "remove me");

    expect(resetChatThreadPrompt(CHAT, 20)).toBe(true);
    expect(resetChatThreadPrompt(CHAT, 20)).toBe(false);
    expect(getChatThreadPrompt(CHAT, 10)).toBe("keep separate");
  });
});
