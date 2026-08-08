import { getDb } from "../../core/db.js";

export interface ChatApiConfig {
  voiceReplyMode: VoiceReplyMode;
}

export type VoiceReplyMode = "text" | "auto" | "always";

type ConfigRow = {
  voiceReplyMode: string;
};

export function isVoiceReplyMode(value: unknown): value is VoiceReplyMode {
  return value === "text" || value === "auto" || value === "always";
}

export function getChatConfig(chatId: number): ChatApiConfig {
  const row = getDb()
    .prepare<
      [number],
      ConfigRow
    >("SELECT voice_reply_mode AS voiceReplyMode FROM chat_configs WHERE chat_id = ?")
    .get(chatId);
  if (!row || !isVoiceReplyMode(row.voiceReplyMode)) return { voiceReplyMode: "text" };
  return { voiceReplyMode: row.voiceReplyMode };
}

export function setChatVoiceReplyMode(chatId: number, mode: VoiceReplyMode): void {
  getDb()
    .prepare(
      `INSERT INTO chat_configs (chat_id, voice_reply_mode) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET voice_reply_mode = excluded.voice_reply_mode`
    )
    .run(chatId, mode);
}

export function resetChatVoiceReplyMode(chatId: number): void {
  getDb()
    .prepare("DELETE FROM chat_configs WHERE chat_id = ? AND voice_reply_mode = 'text'")
    .run(chatId);
}

function storedThreadId(threadId?: number): number {
  return threadId ?? 0;
}

export function getChatThreadPrompt(chatId: number, threadId?: number): string | undefined {
  return getDb()
    .prepare<[number, number], { customPrompt: string }>(
      `SELECT custom_prompt AS customPrompt
       FROM chat_thread_prompts
       WHERE chat_id = ? AND thread_id = ?`
    )
    .get(chatId, storedThreadId(threadId))?.customPrompt;
}

export function setChatThreadPrompt(
  chatId: number,
  threadId: number | undefined,
  prompt: string
): void {
  getDb()
    .prepare(
      `INSERT INTO chat_thread_prompts (chat_id, thread_id, custom_prompt, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, thread_id) DO UPDATE SET
         custom_prompt = excluded.custom_prompt,
         updated_at = excluded.updated_at`
    )
    .run(chatId, storedThreadId(threadId), prompt, new Date().toISOString());
}

export function resetChatThreadPrompt(chatId: number, threadId?: number): boolean {
  return (
    getDb()
      .prepare("DELETE FROM chat_thread_prompts WHERE chat_id = ? AND thread_id = ?")
      .run(chatId, storedThreadId(threadId)).changes > 0
  );
}

export interface ChatConfigService {
  get(chatId: number): ChatApiConfig;
  setVoiceReplyMode(chatId: number, mode: VoiceReplyMode): void;
  resetVoiceReplyMode(chatId: number): void;
  getPrompt(chatId: number, threadId?: number): string | undefined;
  setPrompt(chatId: number, threadId: number | undefined, prompt: string): void;
  resetPrompt(chatId: number, threadId?: number): boolean;
}

export const chatConfigService: ChatConfigService = {
  get: getChatConfig,
  setVoiceReplyMode: setChatVoiceReplyMode,
  resetVoiceReplyMode: resetChatVoiceReplyMode,
  getPrompt: getChatThreadPrompt,
  setPrompt: setChatThreadPrompt,
  resetPrompt: resetChatThreadPrompt,
};
