import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../core/db.js";
import { ChatAgentService } from "../chatAgents.js";
import { UserAgentService } from "../userAgents.js";
import { agentTools } from "../tools.js";
import type { TenantContext } from "../../../core/tenant.js";

const OWNER = 94_001;
const GROUP = -94_100;

beforeEach(() => {
  getDb().prepare("DELETE FROM chat_agent_selection WHERE chat_id = ?").run(GROUP);
  getDb().prepare("DELETE FROM chat_agents WHERE chat_id = ?").run(GROUP);
  getDb().prepare("DELETE FROM user_thread_agents WHERE owner_user_id = ?").run(OWNER);
  getDb().prepare("DELETE FROM user_agents WHERE owner_user_id = ?").run(OWNER);
  getDb().prepare("DELETE FROM user_configs WHERE user_id = ?").run(OWNER);
});

function tools() {
  return agentTools({
    userAgents: new UserAgentService(getDb(), 10),
    chatAgents: new ChatAgentService(getDb(), 10),
    admin: { isAdmin: (id?: number) => id === OWNER } as never,
    maxUserAgents: 10,
    maxChatAgents: 10,
    getTelegramApi: () => undefined,
  });
}

function find(name: string) {
  return tools().find((tool) => tool.name === name)!;
}

const dm: TenantContext = {
  chatId: OWNER,
  chatType: "private",
  userId: OWNER,
};

const group: TenantContext = {
  chatId: GROUP,
  chatType: "supergroup",
  userId: OWNER,
};

describe("agent tools", () => {
  it("creates and updates personal agents in DMs", async () => {
    const created = await find("create_agent").execute(
      {
        name: "Tutor",
        description: "Helps with study",
        instructions: "Ask guiding questions.",
        activate: true,
        set_primary: true,
      },
      dm
    );
    expect(created).toContain("Created personal agent Tutor");
    expect(created).toContain("my_tutor");

    const listed = await find("list_agents").execute({}, dm);
    expect(listed).toContain("Tutor");
    expect(listed).toContain("primary");

    const updated = await find("update_agent").execute(
      {
        agent_id: "my_tutor",
        name: "Study Tutor",
        instructions: "Stay brief.",
      },
      dm
    );
    expect(updated).toContain("Study Tutor");
  });

  it("lets bot admins manage shared group agents", async () => {
    const created = await find("create_agent").execute(
      {
        name: "Moderator",
        description: "Keeps the group on topic",
        instructions: "Be fair and clear.",
        activate: true,
      },
      group
    );
    expect(created).toContain("chat_moderator");

    const listed = await find("list_agents").execute({}, group);
    expect(listed).toContain("Moderator");
    expect(listed).toContain("active");
  });

  it("blocks non-admins in groups when Telegram API is unavailable", async () => {
    const blocked = agentTools({
      userAgents: new UserAgentService(getDb(), 10),
      chatAgents: new ChatAgentService(getDb(), 10),
      admin: { isAdmin: () => false } as never,
      maxUserAgents: 10,
      maxChatAgents: 10,
      getTelegramApi: () => undefined,
    });
    const create = blocked.find((tool) => tool.name === "create_agent")!;
    await expect(
      create.execute(
        {
          name: "Nope",
          description: "Nope",
          instructions: "Nope",
        },
        { ...group, userId: 99 }
      )
    ).resolves.toMatch(/only bot administrators/i);
  });
});
