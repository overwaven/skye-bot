import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../core/db.js";
import { ChatAgentService } from "../chatAgents.js";
import { UserAgentService } from "../userAgents.js";
import { AgentRuntimeService } from "../service.js";
import { canManageChatAgents, clearChatAgentPermissionCache } from "../permissions.js";
import type { AgentRuntimeDeps } from "../types.js";

const OWNER = 93_001;
const GROUP = -93_100;

beforeEach(() => {
  getDb().prepare("DELETE FROM chat_agent_selection WHERE chat_id = ?").run(GROUP);
  getDb().prepare("DELETE FROM chat_agents WHERE chat_id = ?").run(GROUP);
  getDb().prepare("DELETE FROM user_thread_agents WHERE owner_user_id = ?").run(OWNER);
  getDb().prepare("DELETE FROM user_agents WHERE owner_user_id = ?").run(OWNER);
  getDb().prepare("DELETE FROM user_configs WHERE user_id = ?").run(OWNER);
  clearChatAgentPermissionCache();
});

function makeService() {
  const db = getDb();
  const userAgents = new UserAgentService(db, 10);
  const chatAgents = new ChatAgentService(db, 10);
  const deps = {
    userAgents,
    chatAgents,
    llm: {
      models: [],
      settings: { apiKey: "test", baseUrl: "https://example.test", useChatCompletions: false },
      resolveModel: () => ({ id: "default", name: "Default" }),
    },
  } as unknown as AgentRuntimeDeps;
  const service = new AgentRuntimeService(deps, {
    engine: "legacy",
    max_turns: 21,
    subagent_max_turns: 8,
    tracing: false,
    trace_include_sensitive_data: false,
    max_user_agents: 10,
    max_chat_agents: 10,
    agents: [
      {
        id: "researcher",
        name: "Researcher",
        description: "Research",
        instructions: "Research carefully.",
        enabled: true,
      },
    ],
  });
  return { service, userAgents, chatAgents };
}

describe("AgentRuntimeService resolution", () => {
  it("uses personal primary then DM override", () => {
    const { service, userAgents } = makeService();
    userAgents.create(OWNER, {
      id: "primary_bot",
      name: "Primary",
      description: "Primary agent",
      instructions: "Be primary.",
    });
    userAgents.create(OWNER, {
      id: "override_bot",
      name: "Override",
      description: "Override agent",
      instructions: "Be override.",
    });
    userAgents.setPrimary(OWNER, "primary_bot");

    expect(
      service.activeProfileFor({
        chatId: OWNER,
        chatType: "private",
        userId: OWNER,
      })?.id
    ).toBe("my_primary_bot");

    userAgents.setSelection(OWNER, OWNER, undefined, "override_bot");
    expect(
      service.activeProfileFor({
        chatId: OWNER,
        chatType: "private",
        userId: OWNER,
      })?.id
    ).toBe("my_override_bot");
  });

  it("uses shared chat agents in groups and ignores personal selection", () => {
    const { service, userAgents, chatAgents } = makeService();
    userAgents.create(OWNER, {
      id: "personal",
      name: "Personal",
      description: "Personal",
      instructions: "Personal only.",
    });
    userAgents.setSelection(OWNER, GROUP, undefined, "personal");
    chatAgents.create(GROUP, {
      id: "shared",
      name: "Shared",
      description: "Shared",
      instructions: "Shared with the group.",
    });
    chatAgents.setSelection(GROUP, "shared");

    expect(
      service.activeProfileFor({
        chatId: GROUP,
        chatType: "supergroup",
        userId: OWNER,
      })?.id
    ).toBe("chat_shared");
  });
});

describe("ChatAgentService", () => {
  it("keeps one active agent for the whole chat", () => {
    const chatAgents = new ChatAgentService(getDb(), 10);
    chatAgents.create(GROUP, {
      id: "alpha",
      name: "Alpha",
      description: "A",
      instructions: "Alpha.",
    });
    chatAgents.create(GROUP, {
      id: "beta",
      name: "Beta",
      description: "B",
      instructions: "Beta.",
    });
    chatAgents.setSelection(GROUP, "alpha");
    expect(chatAgents.getSelection(GROUP)).toBe("chat_alpha");
    chatAgents.setSelection(GROUP, "beta");
    expect(chatAgents.getSelection(GROUP)).toBe("chat_beta");
    expect(chatAgents.resetSelection(GROUP)).toBe(true);
    expect(chatAgents.getSelection(GROUP)).toBeUndefined();
  });
});

describe("canManageChatAgents", () => {
  it("allows bot admins without Telegram lookup", async () => {
    const api = { getChatMember: vi.fn() };
    await expect(
      canManageChatAgents({
        api: api as never,
        admin: { isAdmin: () => true } as never,
        chatId: GROUP,
        chatType: "supergroup",
        userId: OWNER,
      })
    ).resolves.toBe(true);
    expect(api.getChatMember).not.toHaveBeenCalled();
  });

  it("allows Telegram group administrators and caches the result", async () => {
    const getChatMember = vi.fn().mockResolvedValue({ status: "administrator" });
    const options = {
      api: { getChatMember } as never,
      admin: { isAdmin: () => false } as never,
      chatId: GROUP,
      chatType: "supergroup" as const,
      userId: OWNER,
    };
    await expect(canManageChatAgents(options)).resolves.toBe(true);
    await expect(canManageChatAgents(options)).resolves.toBe(true);
    expect(getChatMember).toHaveBeenCalledTimes(1);
  });
});
