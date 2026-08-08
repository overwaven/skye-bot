import { getDb } from "../../core/db.js";

export interface UserConfig {
  /** @deprecated Migrated into primary agent instructions; kept for legacy reads. */
  systemPrompt?: string;
  /** @deprecated Migrated into primary agents; kept for legacy reads. */
  personality?: "skye" | "skye.exe" | "operator" | "muse";
  /** Stored personal agent id without the `my_` prefix. */
  primaryAgentId?: string;
}

type ConfigRow = {
  systemPrompt: string | null;
  personality: string | null;
  primaryAgentId: string | null;
};

export function getUserConfig(userId: number): UserConfig {
  const row = getDb()
    .prepare<[number], ConfigRow>(
      `SELECT system_prompt AS systemPrompt, personality,
              primary_agent_id AS primaryAgentId
       FROM user_configs WHERE user_id = ?`
    )
    .get(userId);
  if (!row) return {};
  return {
    ...(row.systemPrompt != null ? { systemPrompt: row.systemPrompt } : {}),
    personality: (["skye", "skye.exe", "operator", "muse"].includes(row.personality ?? "")
      ? row.personality
      : "skye") as UserConfig["personality"],
    ...(row.primaryAgentId ? { primaryAgentId: row.primaryAgentId } : {}),
  };
}

export function setUserConfig(userId: number, config: UserConfig): void {
  const existing = getUserConfig(userId);
  const merged = { ...existing, ...config };

  getDb()
    .prepare(
      `INSERT INTO user_configs (user_id, system_prompt, personality, primary_agent_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         system_prompt = excluded.system_prompt,
         personality = excluded.personality,
         primary_agent_id = excluded.primary_agent_id`
    )
    .run(
      userId,
      merged.systemPrompt ?? null,
      merged.personality ?? "skye",
      merged.primaryAgentId ?? null
    );
}

export function getPrimaryAgentId(userId: number): string | undefined {
  return getUserConfig(userId).primaryAgentId;
}

export function setPrimaryAgentId(userId: number, agentId: string | null): void {
  const existing = getUserConfig(userId);
  setUserConfig(userId, { ...existing, primaryAgentId: agentId ?? undefined });
  if (agentId === null) {
    getDb()
      .prepare("UPDATE user_configs SET primary_agent_id = NULL WHERE user_id = ?")
      .run(userId);
  }
}

export interface UserCustomConnector {
  id: number;
  userId: number;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
}

type ServerRow = {
  id: number;
  userId: number;
  name: string;
  config: string;
  createdAt: string;
};

export function getUserCustomConnectors(userId: number): UserCustomConnector[] {
  return getDb()
    .prepare<[number], ServerRow>(
      `SELECT id, user_id AS userId, name, config, created_at AS createdAt
       FROM user_custom_connectors WHERE user_id = ? ORDER BY created_at`
    )
    .all(userId)
    .map((row) => ({
      ...row,
      config: JSON.parse(row.config),
    }));
}

export function getUserCustomConnector(id: number, userId: number): UserCustomConnector | null {
  const row = getDb()
    .prepare<[number, number], ServerRow>(
      `SELECT id, user_id AS userId, name, config, created_at AS createdAt
       FROM user_custom_connectors WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
  if (!row) return null;
  return { ...row, config: JSON.parse(row.config) };
}

export function addUserCustomConnector(
  userId: number,
  name: string,
  config: Record<string, unknown>
): number {
  const result = getDb()
    .prepare(
      `INSERT INTO user_custom_connectors (user_id, name, config, created_at) VALUES (?, ?, ?, ?)`
    )
    .run(userId, name, JSON.stringify(config), new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function updateUserCustomConnector(
  id: number,
  userId: number,
  name: string,
  config: Record<string, unknown>
): boolean {
  const result = getDb()
    .prepare(`UPDATE user_custom_connectors SET name = ?, config = ? WHERE id = ? AND user_id = ?`)
    .run(name, JSON.stringify(config), id, userId);
  return result.changes > 0;
}

export function deleteUserCustomConnector(id: number, userId: number): boolean {
  return getDb().transaction(() => {
    getDb()
      .prepare(
        `DELETE FROM user_connector_inputs
         WHERE server_id IN (SELECT id FROM user_custom_connectors WHERE id = ? AND user_id = ?)`
      )
      .run(id, userId);
    const result = getDb()
      .prepare(`DELETE FROM user_custom_connectors WHERE id = ? AND user_id = ?`)
      .run(id, userId);
    return result.changes > 0;
  })();
}

export function setUserConnectorInput(serverId: number, inputId: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO user_connector_inputs (server_id, input_id, value) VALUES (?, ?, ?)
       ON CONFLICT(server_id, input_id) DO UPDATE SET value = excluded.value`
    )
    .run(serverId, inputId, value);
}

export function getUserConnectorInputs(serverId: number): Record<string, string> {
  const rows = getDb()
    .prepare<
      [number],
      { inputId: string; value: string }
    >(`SELECT input_id AS inputId, value FROM user_connector_inputs WHERE server_id = ?`)
    .all(serverId);
  return Object.fromEntries(rows.map((r) => [r.inputId, r.value]));
}

export function retainUserConnectorInputs(serverId: number, inputIds: string[]): void {
  if (inputIds.length === 0) {
    getDb().prepare("DELETE FROM user_connector_inputs WHERE server_id = ?").run(serverId);
    return;
  }
  const placeholders = inputIds.map(() => "?").join(", ");
  getDb()
    .prepare(
      `DELETE FROM user_connector_inputs
       WHERE server_id = ? AND input_id NOT IN (${placeholders})`
    )
    .run(serverId, ...inputIds);
}

export function getAllUserCustomConnectors(): UserCustomConnector[] {
  return getDb()
    .prepare<[], ServerRow>(
      `SELECT id, user_id AS userId, name, config, created_at AS createdAt
       FROM user_custom_connectors ORDER BY user_id, created_at`
    )
    .all()
    .map((row) => ({
      ...row,
      config: JSON.parse(row.config),
    }));
}

export function getConnectorSession(userId: number, provider: string): string | null {
  return (
    getDb()
      .prepare<[number, string], { sessionId: string }>(
        `SELECT session_id AS sessionId
         FROM user_connector_sessions WHERE user_id = ? AND provider = ?`
      )
      .get(userId, provider)?.sessionId ?? null
  );
}

export function setConnectorSession(userId: number, provider: string, sessionId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO user_connector_sessions (user_id, provider, session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         session_id = excluded.session_id,
         updated_at = excluded.updated_at`
    )
    .run(userId, provider, sessionId, now, now);
}

export function deleteConnectorSession(userId: number, provider: string): boolean {
  return (
    getDb()
      .prepare("DELETE FROM user_connector_sessions WHERE user_id = ? AND provider = ?")
      .run(userId, provider).changes > 0
  );
}

export interface UserConfigService {
  get(userId: number): UserConfig;
  set(userId: number, config: UserConfig): void;
  getPrimaryAgentId(userId: number): string | undefined;
  setPrimaryAgentId(userId: number, agentId: string | null): void;
  listCustomConnectors(userId: number): UserCustomConnector[];
  getCustomConnector(id: number, userId: number): UserCustomConnector | null;
  addCustomConnector(userId: number, name: string, config: Record<string, unknown>): number;
  updateCustomConnector(
    id: number,
    userId: number,
    name: string,
    config: Record<string, unknown>
  ): boolean;
  deleteCustomConnector(id: number, userId: number): boolean;
  setConnectorInput(serverId: number, inputId: string, value: string): void;
  retainConnectorInputs(serverId: number, inputIds: string[]): void;
  getConnectorInputs(serverId: number): Record<string, string>;
  listAllCustomConnectors(): UserCustomConnector[];
  getConnectorSession(userId: number, provider: string): string | null;
  setConnectorSession(userId: number, provider: string, sessionId: string): void;
  deleteConnectorSession(userId: number, provider: string): boolean;
}

export const userConfigService: UserConfigService = {
  get: getUserConfig,
  set: setUserConfig,
  getPrimaryAgentId,
  setPrimaryAgentId,
  listCustomConnectors: getUserCustomConnectors,
  getCustomConnector: getUserCustomConnector,
  addCustomConnector: addUserCustomConnector,
  updateCustomConnector: updateUserCustomConnector,
  deleteCustomConnector: deleteUserCustomConnector,
  setConnectorInput: setUserConnectorInput,
  retainConnectorInputs: retainUserConnectorInputs,
  getConnectorInputs: getUserConnectorInputs,
  listAllCustomConnectors: getAllUserCustomConnectors,
  getConnectorSession,
  setConnectorSession,
  deleteConnectorSession,
};
