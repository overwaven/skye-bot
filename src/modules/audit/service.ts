import { getDb } from "../../core/db.js";
import { log } from "../../utils/log.js";

export type MsgType =
  | "text"
  | "voice"
  | "photo"
  | "image"
  | "image_edit"
  | "document"
  | "audio"
  | "video_note"
  | "sticker"
  | "animation";

export interface AuditEntry {
  chatId: number;
  chatType: string;
  threadId?: number;
  userId: number;
  username?: string;
  firstName?: string;
  msgType: MsgType;
  command?: string;
  inputLen: number;
  outputLen: number;
  latencyMs: number;
  status: "ok" | "error";
  errorMsg?: string;
  model?: string;
  inputText?: string;
  outputText?: string;
  toolCalls?: unknown;
}

export interface AuditActivity {
  action: string;
  userId: number;
  chatId?: number;
  details?: Record<string, unknown>;
}

export function logRequest(entry: AuditEntry, defaultModel: string): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO request_logs (
          ts, chat_id, chat_type, thread_id, user_id, username, first_name,
          msg_type, command, input_len, output_len, latency_ms, model, status, error_msg,
          input_text, output_text, tool_calls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.chatId,
        entry.chatType,
        entry.threadId ?? null,
        entry.userId,
        entry.username ?? null,
        entry.firstName ?? null,
        entry.msgType,
        entry.command ?? null,
        entry.inputLen,
        entry.outputLen,
        entry.latencyMs,
        entry.model ?? defaultModel,
        entry.status,
        entry.errorMsg ?? null,
        entry.inputText ?? null,
        entry.outputText ?? null,
        entry.toolCalls == null ? null : JSON.stringify(entry.toolCalls)
      );
  } catch (e) {
    log.error({ err: e }, "Failed to write audit log entry");
  }
}

export function logActivity(entry: AuditActivity): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_events (ts, user_id, chat_id, action, details)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.userId,
        entry.chatId ?? null,
        entry.action,
        entry.details == null ? null : JSON.stringify(entry.details)
      );
  } catch (e) {
    log.error({ err: e }, "Failed to write audit event");
  }
}

export function pruneAuditLog(retentionDays: number, maxRows: number): { byAge: number; byCount: number } {
  const db = getDb();
  const byAge = db
    .prepare(`DELETE FROM request_logs WHERE ts < datetime('now', '-${retentionDays} days')`)
    .run();
  const byCount = db
    .prepare(
      `DELETE FROM request_logs
       WHERE id NOT IN (SELECT id FROM request_logs ORDER BY id DESC LIMIT ${maxRows})`
    )
    .run();
  const eventsByAge = db
    .prepare(`DELETE FROM audit_events WHERE ts < datetime('now', '-${retentionDays} days')`)
    .run();
  const eventsByCount = db
    .prepare(
      `DELETE FROM audit_events
       WHERE id NOT IN (SELECT id FROM audit_events ORDER BY id DESC LIMIT ${maxRows})`
    )
    .run();
  return { byAge: byAge.changes + eventsByAge.changes, byCount: byCount.changes + eventsByCount.changes };
}

export function scheduleAuditPruning(retentionDays: number, maxRows: number): void {
  const run = () => {
    const { byAge, byCount } = pruneAuditLog(retentionDays, maxRows);
    const total = byAge + byCount;
    if (total > 0) {
      log.info({ byAge, byCount }, `Audit log: pruned ${total} rows`);
    }
  };
  run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

export interface AuditService {
  log(entry: AuditEntry): void;
  event(entry: AuditActivity): void;
}
