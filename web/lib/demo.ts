import type {
  AboutInfo,
  AdminPrincipalsResponse,
  AgentsResponse,
  AuditEvent,
  BillingAccount,
  ChatConfig,
  ConnectorsResponse,
  Memory,
  ModelEntry,
  Monitoring,
  Plans,
  Stats,
} from "@/lib/api"

const now = Date.now()

export const DEMO_USER = {
  name: "overwave",
  handle: "@overwave",
}

export const DEMO_CHAT: ChatConfig = { voiceReplyMode: "text" }

export const DEMO_MODELS: ModelEntry[] = [
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", multiplier: 1 },
  { id: "openai/gpt-5", name: "GPT-5", multiplier: 1.2 },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", multiplier: 0.8 },
]

export const DEMO_ACCOUNT: BillingAccount = {
  modelId: DEMO_MODELS[0].id,
  hasActiveSub: true,
  subStatus: "active",
  subExpiresAt: Math.floor(now / 1000) + 20 * 86_400,
  subPeriodStart: Math.floor(now / 1000) - 10 * 86_400,
  remaining: 42_100,
  baseQuotaTokens: 68_000,
  packsTokens: 0,
  baseUsedTokens: 25_900,
  totalUsedTokens: 25_900,
}

export const DEMO_PLANS: Plans = {
  enabled: true,
  currency: "XTR",
  title: "Skye Plus",
  description: "More room to think.",
  subscriptionStars: 499,
  subscriptionPeriodSeconds: 30 * 86_400,
  baseQuotaTokens: 68_000,
  packs: [
    { id: "quick", name: "Quick Boost", tokens: 500_000, stars: 499 },
    { id: "big", name: "Big Boost", tokens: 1_500_000, stars: 999 },
    { id: "mega", name: "Mega Boost", tokens: 5_000_000, stars: 2499 },
  ],
}

export const DEMO_CONNECTORS: ConnectorsResponse = {
  managed: {
    enabled: true,
    connectors: [
      {
        slug: "gmail",
        name: "Gmail",
        connected: true,
        status: "Inbox access",
      },
      {
        slug: "notion",
        name: "Notion",
        connected: false,
        status: "Pages and databases",
      },
      {
        slug: "github",
        name: "GitHub",
        connected: false,
        status: "Repos and issues",
      },
      {
        slug: "calendar",
        name: "Google Calendar",
        connected: true,
        status: "Events",
      },
    ],
  },
  custom: [
    {
      id: 1,
      name: "Home Assistant",
      config: { type: "http", url: "https://ha.home" },
      connected: true,
      toolCount: 12,
    },
  ],
  customEnabled: true,
  maxCustom: 8,
}

export const DEMO_MEMORIES: Memory[] = [
  {
    id: "1",
    chatId: 1,
    chatName: "Private",
    content: "Prefers concise answers",
    category: "preference",
    createdAt: new Date(now - 2 * 86_400_000).toISOString(),
  },
  {
    id: "2",
    chatId: 2,
    chatName: "Work",
    content: "Working on Skye panel redesign with Liquid Glass",
    category: "project",
    createdAt: new Date(now - 3_600_000).toISOString(),
  },
  {
    id: "3",
    chatId: 1,
    chatName: "Private",
    content: "Timezone: Europe/Moscow",
    category: "fact",
    createdAt: new Date(now - 5 * 86_400_000).toISOString(),
  },
  {
    id: "4",
    chatId: 2,
    chatName: "Work",
    content: "Likes Liquid Glass UI",
    category: "preference",
    createdAt: new Date(now - 2_000_000).toISOString(),
  },
  {
    id: "5",
    chatId: 1,
    chatName: "Private",
    content: "Uses Telegram Stars for Skye Plus and token packs",
    category: "fact",
    createdAt: new Date(now - 7 * 86_400_000).toISOString(),
  },
  {
    id: "6",
    chatId: 1,
    chatName: "Private",
    content: "Speaks Russian and English",
    category: "fact",
    createdAt: new Date(now - 21 * 86_400_000).toISOString(),
  },
]

export const DEMO_STATS: Stats = {
  totalRequests: 1284,
  requestsToday: 42,
  avgLatencyMs: 840,
  errorRate: 0.012,
}

export const DEMO_MONITORING: Monitoring = {
  status: "ok",
  startedAt: new Date(now - 412_000_000).toISOString(),
  uptimeSeconds: 412_000,
  logs: { out: [], error: [] },
}

function audit(
  partial: Partial<AuditEvent> &
    Pick<AuditEvent, "id" | "action" | "ts" | "model">
): AuditEvent {
  return {
    kind: "request",
    userId: 1,
    chatId: 1,
    chatName: "Private",
    chatType: "private",
    threadId: null,
    username: "overwave",
    firstName: "overwave",
    command: null,
    inputLength: null,
    outputLength: null,
    status: "ok",
    latencyMs: null,
    inputText: null,
    outputText: null,
    toolCalls: null,
    details: null,
    error: null,
    ...partial,
  }
}

export const DEMO_AUDIT: AuditEvent[] = [
  audit({
    id: 1,
    ts: new Date(now - 120_000).toISOString(),
    action: "Chat completion",
    model: "Claude Sonnet 4",
    inputLength: 1200,
    outputLength: 900,
    latencyMs: 2100,
  }),
  audit({
    id: 2,
    ts: new Date(now - 18 * 60_000).toISOString(),
    action: "Image generation",
    model: "Flux",
    outputLength: 1,
    latencyMs: 6400,
  }),
  audit({
    id: 3,
    ts: new Date(now - 60 * 60_000).toISOString(),
    action: "Speech transcription",
    model: "Yandex",
    chatId: 2,
    chatName: "Work",
    latencyMs: 42_000,
  }),
]

export const DEMO_ABOUT: AboutInfo = {
  name: "Skye",
  version: "1.4.0",
  commit: "a1b2c3d4e5f6",
  license: "AGPL-3.0",
  accessMode: "subscription",
  billingEnabled: true,
  isAdmin: true,
  isOwner: true,
  sourceUrl: "https://github.com/example/skye-bot",
  securityUrl: "https://skye-bot.com/security",
  maintainer: {
    name: "Evvy",
    alias: "overwave",
    telegram: "@overwave",
    email: "hello@skye-bot.com",
  },
}

export const DEMO_ADMINS: AdminPrincipalsResponse = {
  ownerUserId: 1,
  canManage: true,
  admins: [
    {
      userId: 1,
      role: "owner",
      removable: false,
      source: "config",
      addedBy: null,
      createdAt: new Date(now - 100 * 86_400_000).toISOString(),
    },
    {
      userId: 42,
      role: "admin",
      removable: true,
      source: "database",
      addedBy: 1,
      createdAt: new Date(now - 30 * 86_400_000).toISOString(),
    },
  ],
}

export const DEMO_AGENTS: AgentsResponse = {
  agents: [
    {
      id: "researcher",
      name: "Researcher",
      description: "Deep reading · model override",
      instructions: "Research carefully and cite sources.",
      modelId: DEMO_MODELS[1].id,
      createdAt: new Date(now - 10 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 2 * 86_400_000).toISOString(),
    },
    {
      id: "writer",
      name: "Writing coach",
      description: "Calm edits · short notes",
      instructions: "Edit with restraint and clarity.",
      modelId: null,
      createdAt: new Date(now - 8 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 1 * 86_400_000).toISOString(),
    },
  ],
  templates: [
    {
      id: "coder",
      name: "Coding partner",
      description: "Ship small, clear changes",
      instructions: "Prefer minimal diffs and tests.",
    },
  ],
  models: DEMO_MODELS,
  maxAgents: 8,
  activeAgentId: null,
  primaryAgentId: null,
}

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("demo") === "1"
}
