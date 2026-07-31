import { getDb } from "../../core/db.js";

export interface DeletionSummary {
  userConfigs: number;
  customConnectors: number;
  customConnectorInputs: number;
  connectorSessions: number;
  billingAccounts: number;
  billingEvents: number;
  memories: number;
  chatSummaries: number;
  conversationItems: number;
  groupMessages: number;
  chatConfigs: number;
  chatStickers: number;
  chatStickerTeach: number;
  reminders: number;
  requestLogs: number;
  adminPrincipals: number;
}

/**
 * Permanently delete all data associated with a Telegram user.
 *
 * Two scopes are wiped:
 *   1. Per-user data keyed by `user_id` — user configs, custom connectors (+
 *      their inputs), managed connector sessions, billing accounts/events, reminders, audit
 *      request logs.
 *   2. Private-chat data where `chat_id = userId` (in DMs chatId === userId) —
 *      memories, chat summaries, conversation items, group messages, chat
 *      config.
 *
 * Group-scoped data (memories, summaries, conversation history in shared
 * chats) is left intact because it belongs to the group, not the individual.
 * Channel posts are shared content and are never touched here.
 */
export function deleteUserData(userId: number): DeletionSummary {
  const db = getDb();
  return db.transaction(() => {
    const changes = (sql: string): number => db.prepare(sql).run(userId).changes;
    const customConnectorInputs = changes(
      `DELETE FROM user_connector_inputs
       WHERE server_id IN (SELECT id FROM user_custom_connectors WHERE user_id = ?)`
    );
    return {
      userConfigs: changes("DELETE FROM user_configs WHERE user_id = ?"),
      customConnectors: changes("DELETE FROM user_custom_connectors WHERE user_id = ?"),
      customConnectorInputs,
      connectorSessions: changes("DELETE FROM user_connector_sessions WHERE user_id = ?"),
      billingAccounts: changes("DELETE FROM billing_accounts WHERE user_id = ?"),
      billingEvents: changes("DELETE FROM billing_events WHERE user_id = ?"),
      memories: changes("DELETE FROM memories WHERE chat_id = ?"),
      chatSummaries: changes("DELETE FROM chat_summaries WHERE chat_id = ?"),
      conversationItems: changes("DELETE FROM conversation_items WHERE chat_id = ?"),
      groupMessages: changes("DELETE FROM group_messages WHERE chat_id = ?"),
      chatConfigs: changes("DELETE FROM chat_configs WHERE chat_id = ?"),
      chatStickers: changes("DELETE FROM chat_stickers WHERE chat_id = ?"),
      chatStickerTeach: changes("DELETE FROM chat_sticker_teach WHERE chat_id = ?"),
      reminders: changes("DELETE FROM reminders WHERE user_id = ?"),
      requestLogs: changes("DELETE FROM request_logs WHERE user_id = ?"),
      adminPrincipals: changes("DELETE FROM admin_principals WHERE user_id = ? AND role = 'admin'"),
    };
  })();
}

export interface LegalService {
  deleteUserData(userId: number): DeletionSummary;
}

export const legalService: LegalService = {
  deleteUserData,
};
