function telegramInitData(): string {
  if (typeof window === "undefined") return ""
  return window.Telegram?.WebApp?.initData ?? ""
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": telegramInitData(),
        ...init.headers,
      },
    })

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`
      try {
        const body = (await response.json()) as { error?: string; code?: string }
        if (body.error) message = body.error
      } catch {
        // The status text is still useful when the response is not JSON.
      }
      throw new Error(message)
    }

    if (response.status === 204) return null as T
    return (await response.json()) as T
  } finally {
    window.clearTimeout(timeout)
  }
}

export type Personality = "skye" | "skye.exe" | "operator" | "muse"
export type VoiceReplyMode = "text" | "auto" | "always"

export interface UserConfig {
  primaryAgentId?: string
}

export interface ChatConfig {
  voiceReplyMode: VoiceReplyMode
}

export type ProviderKind =
  | "openai"
  | "openrouter"
  | "xai"
  | "perplexity"
  | "openai-compatible"

export type ModelCapability =
  | "text"
  | "vision"
  | "image_generation"
  | "image_edit"
  | "tts"
  | "stt"

export interface AiModelConfig {
  apiMode?: "responses" | "chat-completions"
  builtinTools?: Array<
    "web_search" | "fetch_url" | "finance_search" | "people_search" | "sandbox"
  >
  preset?: string
  aspectRatio?: string
  resolution?: "1k" | "2k" | ""
  voice?: string
  voices?: string[]
  language?: string
  audioFormat?: "mp3" | "wav" | "pcm" | "oggopus"
  expressive?: boolean
}

export interface AiModelRecord {
  id: string
  providerId: string
  providerName?: string
  name: string
  upstreamId: string
  capabilities: ModelCapability[]
  contextWindow: number
  multiplier: number
  enabled: boolean
  config: AiModelConfig
  createdAt: string
  updatedAt: string
}

export interface AiProviderRecord {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  enabled: boolean
  status: "untested" | "ready" | "error" | "disabled"
  hasApiKey: boolean
  lastError: string | null
  testedAt: string | null
  createdAt: string
  updatedAt: string
  models: AiModelRecord[]
}

export interface AiRouting {
  textModelId: string | null
  imageGenerationModelId: string | null
  imageEditModelId: string | null
  ttsModelId: string | null
  sttModelId: string | null
  ttsVoice: string | null
}

export interface AiCatalog {
  configured: boolean
  chatId: number
  chats: Array<{ chatId: number; name: string; type: string }>
  routing: AiRouting
  overrides: AiRouting
  defaults: AiRouting
  models: AiModelRecord[]
  canManageProviders: boolean
}

export interface ProviderAdminResponse {
  providers: AiProviderRecord[]
  defaults: AiRouting
  onboardingRequired: boolean
}

export interface DiscoveredAiModel {
  upstreamId: string
  name: string
  capabilities: ModelCapability[]
  contextWindow?: number
}

export interface ProviderInput {
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey?: string
  enabled?: boolean
}

export interface AiModelInput {
  name: string
  upstreamId: string
  capabilities: ModelCapability[]
  contextWindow?: number
  multiplier?: number
  enabled?: boolean
  config?: AiModelConfig
}

export interface CustomConnector {
  id: number
  name: string
  config: Record<string, unknown>
  connected: boolean
  toolCount: number
}

export interface ManagedConnector {
  slug: string
  name: string
  logo?: string
  connected: boolean
  status?: string
}

export interface ConnectorsResponse {
  managed: {
    enabled: boolean
    connectors: ManagedConnector[]
  }
  custom: CustomConnector[]
  customEnabled: boolean
  maxCustom: number
  managedUnavailable?: boolean
}

export interface Memory {
  id: string
  content: string
  createdAt: string
  chatId: number
  chatName: string
  category: "preference" | "fact" | "task" | "project"
  updatedAt?: string
  expiresAt?: string | null
  archivedAt?: string | null
}

export interface MemoryExport {
  version: number
  exportedAt: string
  memories: Memory[]
}

export interface Stats {
  totalRequests: number
  requestsToday: number
  avgLatencyMs: number
  errorRate: number
}

export interface Monitoring {
  status: "ok"
  startedAt: string
  uptimeSeconds: number
  logs: { out: string[]; error: string[] }
}

export interface AuditEvent {
  ts: string
  kind: "request" | "activity" | "billing"
  id: number
  userId: number
  chatId: number | null
  chatName: string | null
  chatType: string | null
  threadId: number | null
  username: string | null
  firstName: string | null
  action: string
  command: string | null
  inputLength: number | null
  outputLength: number | null
  model: string | null
  status: string | null
  latencyMs: number | null
  inputText: string | null
  outputText: string | null
  toolCalls: unknown
  details: unknown
  error: string | null
}

export interface BillingAccount {
  modelId: string
  subStatus: "none" | "active" | "cancelled"
  subExpiresAt: number
  subPeriodStart: number
  baseUsedTokens: number
  baseQuotaTokens: number
  packsTokens: number
  totalUsedTokens: number
  remaining: number
  hasActiveSub: boolean
}

export interface ModelEntry {
  id: string
  name: string
  multiplier: number
}

export interface ModelsResponse {
  models: ModelEntry[]
  defaultModelId: string
}

export interface PersonalAgent {
  id: string
  name: string
  description: string
  instructions: string
  modelId: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentTemplate {
  id: string
  name: string
  description: string
  instructions: string
}

export interface AgentsResponse {
  agents: PersonalAgent[]
  activeAgentId: string | null
  primaryAgentId: string | null
  maxAgents: number
  models: ModelEntry[]
  templates: AgentTemplate[]
}

export interface PersonalAgentInput {
  name: string
  description: string
  instructions: string
  modelId: string | null
}

export interface TokenPack {
  id: string
  name: string
  stars: number
  tokens: number
}

export interface Plans {
  enabled: boolean
  currency: string
  title: string
  description: string
  subscriptionStars: number
  subscriptionPeriodSeconds: number
  baseQuotaTokens: number
  packs: TokenPack[]
}

export type AccessMode = "private" | "allowlist" | "subscription" | "open"

export interface AboutInfo {
  name: string
  version: string
  commit: string | null
  sourceUrl: string
  securityUrl: string
  license: string
  maintainer: {
    name: string
    alias: string
    telegram: string
    email: string
  }
  accessMode: AccessMode
  billingEnabled: boolean
  isAdmin: boolean
  isOwner: boolean
}

export interface AdminPrincipal {
  userId: number
  role: "owner" | "admin"
  source: "config" | "database"
  removable: boolean
  addedBy: number | null
  createdAt: string | null
}

export interface AdminPrincipalsResponse {
  ownerUserId: number | null
  canManage: boolean
  admins: AdminPrincipal[]
}

export interface BillingEvent {
  id: number
  type: string
  payload: unknown
  amount: number | null
  createdAt: string
}

export interface SystemConfigSection {
  key: string
  line: number
}

export interface SystemConfigIssue {
  path: string
  message: string
}

export interface SystemConfigResponse {
  name: string
  path: string
  size: number
  mtimeMs: number
  etag: string
  byteLength: number
  content: string
  sections: SystemConfigSection[]
  restartRequired: boolean
  note: string
  warnings?: string[]
  backupName?: string | null
  restartScheduled?: boolean
}

export interface SystemConfigValidateResult {
  ok: boolean
  issues?: SystemConfigIssue[]
  warnings: string[]
  sections: SystemConfigSection[]
}

export const api = {
  getAbout: () => request<AboutInfo>("/about"),
  getAdminPrincipals: () =>
    request<AdminPrincipalsResponse>("/admin/principals"),
  addAdminPrincipal: (userId: number) =>
    request<{ admins: AdminPrincipal[] }>("/admin/principals", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  removeAdminPrincipal: (userId: number) =>
    request<{ admins: AdminPrincipal[] }>(`/admin/principals/${userId}`, {
      method: "DELETE",
    }),
  getSystemConfig: () => request<SystemConfigResponse>("/admin/system-config"),
  validateSystemConfig: (content: string) =>
    request<SystemConfigValidateResult>("/admin/system-config/validate", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  saveSystemConfig: (content: string, etag: string, restart = false) =>
    request<SystemConfigResponse>("/admin/system-config", {
      method: "PUT",
      body: JSON.stringify({ content, etag, restart }),
    }),
  getConfig: () => request<UserConfig>("/config"),
  updateConfig: (config: UserConfig) =>
    request<UserConfig>("/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  getChatConfig: (chatId?: number) =>
    request<ChatConfig>(`/chat-config${chatId === undefined ? "" : `?chatId=${chatId}`}`),
  updateChatConfig: (config: ChatConfig & { chatId?: number }) =>
    request<ChatConfig>("/chat-config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  getAgents: () => request<AgentsResponse>("/agents"),
  createAgent: (agent: PersonalAgentInput) =>
    request<PersonalAgent>("/agents", {
      method: "POST",
      body: JSON.stringify(agent),
    }),
  updateAgent: (id: string, agent: PersonalAgentInput) =>
    request<PersonalAgent>(`/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(agent),
    }),
  deleteAgent: (id: string) =>
    request<{ ok: true }>(`/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  selectAgent: (agentId: string | null) =>
    request<{ ok: true; activeAgentId: string | null }>("/agents/selection", {
      method: "PUT",
      body: JSON.stringify({ agentId }),
    }),
  setPrimaryAgent: (agentId: string | null) =>
    request<{ ok: true; primaryAgentId: string | null }>("/agents/primary", {
      method: "PUT",
      body: JSON.stringify({ agentId }),
    }),
  getConnectors: () => request<ConnectorsResponse>("/connectors"),
  authorizeManagedConnector: (toolkit: string) =>
    request<{ redirectUrl: string }>(
      `/connectors/managed/${encodeURIComponent(toolkit)}/authorize`,
      { method: "POST" }
    ),
  disconnectManagedConnector: (toolkit: string) =>
    request<{ ok: true }>(
      `/connectors/managed/${encodeURIComponent(toolkit)}`,
      {
        method: "DELETE",
      }
    ),
  addCustomConnector: (
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>
  ) =>
    request<CustomConnector>("/connectors/custom", {
      method: "POST",
      body: JSON.stringify({ name, config, inputs, acknowledgeRisk: true }),
    }),
  updateCustomConnector: (
    id: number,
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>
  ) =>
    request<CustomConnector>(`/connectors/custom/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, config, inputs, acknowledgeRisk: true }),
    }),
  deleteCustomConnector: (id: number) =>
    request<{ ok: true }>(`/connectors/custom/${id}`, { method: "DELETE" }),
  getMemories: () => request<Memory[]>("/memories"),
  exportMemories: (chatId?: number) =>
    request<MemoryExport>(
      `/memories/export${chatId === undefined ? "" : `?chatId=${chatId}`}`
    ),
  importMemories: (chatId: number, memories: unknown[]) =>
    request<{ ok: true; imported: number; merged: number }>(
      "/memories/import",
      {
        method: "POST",
        body: JSON.stringify({ chatId, memories }),
      }
    ),
  deleteMemory: (chatId: number, id: string) =>
    request<{ ok: true }>(`/memories/${chatId}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  clearMemoriesForChat: (chatId: number) =>
    request<{ ok: true }>(`/memories/${chatId}`, { method: "DELETE" }),
  getStats: () => request<Stats>("/stats"),
  getMonitoring: () => request<Monitoring>("/monitoring"),
  getAuditEvents: () => request<AuditEvent[]>("/audit/events"),
  getBillingAccount: () => request<BillingAccount>("/billing/account"),
  getModels: () => request<ModelsResponse>("/billing/models"),
  selectModel: (modelId: string) =>
    request<{ ok: true }>("/billing/model", {
      method: "PUT",
      body: JSON.stringify({ modelId }),
    }),
  getPlans: () => request<Plans>("/billing/plans"),
  createSubscriptionInvoice: () =>
    request<{ url: string }>("/billing/invoice/subscription", {
      method: "POST",
    }),
  createPackInvoice: (packId: string) =>
    request<{ url: string }>("/billing/invoice/pack", {
      method: "POST",
      body: JSON.stringify({ packId }),
    }),
  cancelSubscription: () =>
    request<{ ok: true }>("/billing/cancel", { method: "POST" }),
  getBillingEvents: () => request<BillingEvent[]>("/billing/events"),
  getAiCatalog: (chatId?: number) =>
    request<AiCatalog>(`/ai/catalog${chatId === undefined ? "" : `?chatId=${chatId}`}`),
  updateAiRouting: (chatId: number, patch: Partial<AiRouting>) =>
    request<{ routing: AiRouting; overrides: AiRouting }>(`/ai/routing/${chatId}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  getProviders: () => request<ProviderAdminResponse>("/admin/providers"),
  createProvider: (input: ProviderInput) =>
    request<AiProviderRecord>("/admin/providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProvider: (id: string, input: ProviderInput) =>
    request<AiProviderRecord>(`/admin/providers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteProvider: (id: string) =>
    request<null>(`/admin/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testProvider: (id: string) =>
    request<{ ok: boolean; error?: string }>(`/admin/providers/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }),
  discoverProviderModels: (id: string) =>
    request<{ models: DiscoveredAiModel[] }>(
      `/admin/providers/${encodeURIComponent(id)}/discover`
    ),
  createProviderModel: (providerId: string, input: AiModelInput) =>
    request<AiModelRecord>(`/admin/providers/${encodeURIComponent(providerId)}/models`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProviderModel: (id: string, input: AiModelInput) =>
    request<AiModelRecord>(`/admin/models/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteProviderModel: (id: string) =>
    request<null>(`/admin/models/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateAiDefaults: (patch: Partial<AiRouting>) =>
    request<{ defaults: AiRouting }>("/admin/ai-defaults", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
}
