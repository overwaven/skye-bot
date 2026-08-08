import type Database from "better-sqlite3";
import { z } from "zod";
import type { AgentProfile } from "./config.js";
import { agentIdFromName } from "./userAgents.js";

export const CHAT_AGENT_PREFIX = "chat_";

const chatAgentIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, numbers, underscores, or hyphens")
  .refine((id) => !id.startsWith(CHAT_AGENT_PREFIX), 'Do not repeat the "chat_" prefix')
  .refine((id) => !id.startsWith("my_"), 'Do not use the "my_" prefix for chat agents');

const chatAgentInputSchema = z.object({
  id: chatAgentIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  instructions: z.string().min(1).max(16_000),
  modelId: z.string().min(1).max(80).optional(),
});

export type ChatAgentInput = z.infer<typeof chatAgentInputSchema>;

export interface ChatAgentRecord extends ChatAgentInput {
  chatId: number;
  createdAt: string;
  updatedAt: string;
}

interface ChatAgentRow {
  chatId: number;
  id: string;
  name: string;
  description: string;
  instructions: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeId(id: string): string {
  return id.startsWith(CHAT_AGENT_PREFIX) ? id.slice(CHAT_AGENT_PREFIX.length) : id;
}

function recordFromRow(row: ChatAgentRow): ChatAgentRecord {
  return {
    chatId: row.chatId,
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    ...(row.modelId ? { modelId: row.modelId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function chatProfileId(id: string): string {
  return `${CHAT_AGENT_PREFIX}${normalizeId(id)}`;
}

export function isChatProfileId(id: string): boolean {
  return id.startsWith(CHAT_AGENT_PREFIX);
}

export class ChatAgentService {
  constructor(
    private readonly db: Database.Database,
    private readonly maxAgents: number
  ) {}

  list(chatId: number): ChatAgentRecord[] {
    return this.db
      .prepare<[number], ChatAgentRow>(
        `SELECT chat_id AS chatId, id, name, description, instructions,
                model_id AS modelId,
                created_at AS createdAt, updated_at AS updatedAt
         FROM chat_agents
         WHERE chat_id = ?
         ORDER BY created_at, id`
      )
      .all(chatId)
      .map(recordFromRow);
  }

  profiles(chatId: number): AgentProfile[] {
    return this.list(chatId).map((agent) => ({
      id: chatProfileId(agent.id),
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      ...(agent.modelId ? { model_id: agent.modelId } : {}),
      enabled: true,
    }));
  }

  get(chatId: number, id: string): ChatAgentRecord | undefined {
    const row = this.db
      .prepare<[number, string], ChatAgentRow>(
        `SELECT chat_id AS chatId, id, name, description, instructions,
                model_id AS modelId,
                created_at AS createdAt, updated_at AS updatedAt
         FROM chat_agents
         WHERE chat_id = ? AND id = ?`
      )
      .get(chatId, normalizeId(id));
    return row ? recordFromRow(row) : undefined;
  }

  nextId(chatId: number, name: string): string {
    const baseId = agentIdFromName(name);
    let id = baseId;
    for (let suffix = 2; this.get(chatId, id); suffix++) {
      const suffixText = `_${suffix}`;
      id = `${baseId.slice(0, 32 - suffixText.length)}${suffixText}`;
    }
    return id;
  }

  create(chatId: number, input: ChatAgentInput): ChatAgentRecord {
    const parsed = chatAgentInputSchema.parse({ ...input, id: normalizeId(input.id) });
    if (this.list(chatId).length >= this.maxAgents) {
      throw new Error(`This chat can have at most ${this.maxAgents} agents.`);
    }
    if (this.get(chatId, parsed.id)) {
      throw new Error(`Chat agent "${chatProfileId(parsed.id)}" already exists.`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO chat_agents
          (chat_id, id, name, description, instructions, model_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        chatId,
        parsed.id,
        parsed.name,
        parsed.description,
        parsed.instructions,
        parsed.modelId ?? null,
        now,
        now
      );
    return this.get(chatId, parsed.id)!;
  }

  update(chatId: number, id: string, input: Omit<ChatAgentInput, "id">): ChatAgentRecord {
    const storedId = normalizeId(id);
    const parsed = chatAgentInputSchema.omit({ id: true }).parse(input);
    const result = this.db
      .prepare(
        `UPDATE chat_agents
         SET name = ?, description = ?, instructions = ?, model_id = ?, updated_at = ?
         WHERE chat_id = ? AND id = ?`
      )
      .run(
        parsed.name,
        parsed.description,
        parsed.instructions,
        parsed.modelId ?? null,
        new Date().toISOString(),
        chatId,
        storedId
      );
    if (result.changes === 0) {
      throw new Error(`Chat agent "${chatProfileId(storedId)}" does not exist.`);
    }
    return this.get(chatId, storedId)!;
  }

  rename(chatId: number, id: string, newId: string): ChatAgentRecord {
    const fromId = normalizeId(id);
    const toId = chatAgentIdSchema.parse(normalizeId(newId));
    if (fromId === toId) return this.get(chatId, fromId)!;
    const existing = this.get(chatId, fromId);
    if (!existing) {
      throw new Error(`Chat agent "${chatProfileId(fromId)}" does not exist.`);
    }
    if (this.get(chatId, toId)) {
      throw new Error(`Chat agent "${chatProfileId(toId)}" already exists.`);
    }
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO chat_agents
            (chat_id, id, name, description, instructions, model_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          chatId,
          toId,
          existing.name,
          existing.description,
          existing.instructions,
          existing.modelId ?? null,
          existing.createdAt,
          now
        );
      this.db
        .prepare(
          `UPDATE chat_agent_selection SET agent_id = ?
           WHERE chat_id = ? AND agent_id = ?`
        )
        .run(toId, chatId, fromId);
      this.db.prepare("DELETE FROM chat_agents WHERE chat_id = ? AND id = ?").run(chatId, fromId);
    })();
    return this.get(chatId, toId)!;
  }

  delete(chatId: number, id: string): boolean {
    const storedId = normalizeId(id);
    return this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM chat_agent_selection WHERE chat_id = ? AND agent_id = ?")
        .run(chatId, storedId);
      return (
        this.db.prepare("DELETE FROM chat_agents WHERE chat_id = ? AND id = ?").run(chatId, storedId)
          .changes > 0
      );
    })();
  }

  getSelection(chatId: number): string | undefined {
    const row = this.db
      .prepare<[number], { agentId: string }>(
        `SELECT selection.agent_id AS agentId
         FROM chat_agent_selection AS selection
         INNER JOIN chat_agents AS agent
           ON agent.chat_id = selection.chat_id
          AND agent.id = selection.agent_id
         WHERE selection.chat_id = ?`
      )
      .get(chatId);
    return row ? chatProfileId(row.agentId) : undefined;
  }

  setSelection(chatId: number, id: string): void {
    const storedId = normalizeId(id);
    if (!this.get(chatId, storedId)) {
      throw new Error(`Chat agent "${chatProfileId(storedId)}" does not exist.`);
    }
    this.db
      .prepare(
        `INSERT INTO chat_agent_selection (chat_id, agent_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           agent_id = excluded.agent_id,
           updated_at = excluded.updated_at`
      )
      .run(chatId, storedId, new Date().toISOString());
  }

  resetSelection(chatId: number): boolean {
    return (
      this.db.prepare("DELETE FROM chat_agent_selection WHERE chat_id = ?").run(chatId).changes > 0
    );
  }

  /** Fork a template profile into an editable chat agent and activate it. */
  installFromTemplate(chatId: number, template: AgentProfile): ChatAgentRecord {
    const baseId = normalizeId(template.id).slice(0, 32);
    const existing = this.get(chatId, baseId);
    if (existing) {
      this.setSelection(chatId, existing.id);
      return existing;
    }
    const agent = this.create(chatId, {
      id: baseId,
      name: template.name,
      description: template.description,
      instructions: template.instructions,
      ...(template.model_id ? { modelId: template.model_id } : {}),
    });
    this.setSelection(chatId, agent.id);
    return agent;
  }
}
