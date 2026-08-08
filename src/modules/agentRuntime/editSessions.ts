import type Database from "better-sqlite3";

const SESSION_TTL_MS = 60 * 60 * 1000;

export type AgentEditScope = "personal" | "chat";
export type AgentEditField = "name" | "description" | "instructions" | "id";

export interface AgentEditSession {
  scope: AgentEditScope;
  agentId: string;
  pendingId?: string;
  name: string;
  description: string;
  instructions: string;
  modelId?: string;
  awaitingField?: AgentEditField;
  updatedAt: string;
}

interface AgentEditSessionRow {
  scope: AgentEditScope;
  agentId: string;
  pendingId: string | null;
  name: string;
  description: string;
  instructions: string;
  modelId: string | null;
  awaitingField: AgentEditField | null;
  updatedAt: string;
}

function storedThreadId(threadId?: number): number {
  return threadId ?? 0;
}

function fromRow(row: AgentEditSessionRow): AgentEditSession {
  return {
    scope: row.scope,
    agentId: row.agentId,
    ...(row.pendingId ? { pendingId: row.pendingId } : {}),
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    ...(row.modelId ? { modelId: row.modelId } : {}),
    ...(row.awaitingField ? { awaitingField: row.awaitingField } : {}),
    updatedAt: row.updatedAt,
  };
}

export class AgentEditSessionService {
  constructor(private readonly db: Database.Database) {}

  get(ownerUserId: number, chatId: number, threadId?: number): AgentEditSession | undefined {
    const row = this.db
      .prepare<[number, number, number], AgentEditSessionRow>(
        `SELECT scope, agent_id AS agentId, pending_id AS pendingId,
                name, description, instructions, model_id AS modelId,
                awaiting_field AS awaitingField, updated_at AS updatedAt
         FROM agent_edit_sessions
         WHERE owner_user_id = ? AND chat_id = ? AND thread_id = ?`
      )
      .get(ownerUserId, chatId, storedThreadId(threadId));
    if (!row) return undefined;
    if (Date.now() - Date.parse(row.updatedAt) > SESSION_TTL_MS) {
      this.clear(ownerUserId, chatId, threadId);
      return undefined;
    }
    return fromRow(row);
  }

  start(
    ownerUserId: number,
    chatId: number,
    threadId: number | undefined,
    session: Omit<AgentEditSession, "updatedAt" | "awaitingField">
  ): AgentEditSession {
    return this.save(ownerUserId, chatId, threadId, { ...session });
  }

  save(
    ownerUserId: number,
    chatId: number,
    threadId: number | undefined,
    session: Omit<AgentEditSession, "updatedAt">
  ): AgentEditSession {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_edit_sessions
          (owner_user_id, chat_id, thread_id, scope, agent_id, pending_id,
           name, description, instructions, model_id, awaiting_field, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_user_id, chat_id, thread_id) DO UPDATE SET
           scope = excluded.scope,
           agent_id = excluded.agent_id,
           pending_id = excluded.pending_id,
           name = excluded.name,
           description = excluded.description,
           instructions = excluded.instructions,
           model_id = excluded.model_id,
           awaiting_field = excluded.awaiting_field,
           updated_at = excluded.updated_at`
      )
      .run(
        ownerUserId,
        chatId,
        storedThreadId(threadId),
        session.scope,
        session.agentId,
        session.pendingId ?? null,
        session.name,
        session.description,
        session.instructions,
        session.modelId ?? null,
        session.awaitingField ?? null,
        updatedAt
      );
    return { ...session, updatedAt };
  }

  clear(ownerUserId: number, chatId: number, threadId?: number): boolean {
    return (
      this.db
        .prepare(
          `DELETE FROM agent_edit_sessions
           WHERE owner_user_id = ? AND chat_id = ? AND thread_id = ?`
        )
        .run(ownerUserId, chatId, storedThreadId(threadId)).changes > 0
    );
  }
}
