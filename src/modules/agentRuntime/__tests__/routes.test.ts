import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../core/db.js";
import { ServiceRegistry, type ModuleContext, type PanelRoute } from "../../../core/module.js";
import { buildAgentRoutes } from "../routes.js";
import { UserAgentService } from "../userAgents.js";

const OWNER = 92_001;

beforeEach(() => {
  getDb().prepare("DELETE FROM user_thread_agents WHERE owner_user_id = ?").run(OWNER);
  getDb().prepare("DELETE FROM user_agents WHERE owner_user_id = ?").run(OWNER);
  getDb().prepare("DELETE FROM user_configs WHERE user_id = ?").run(OWNER);
});

function response() {
  const state: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res, state };
}

async function invoke(route: PanelRoute, body?: unknown, params: Record<string, string> = {}) {
  const result = response();
  await route.handler(
    {
      body,
      params,
      tenant: { userId: OWNER, chatId: OWNER, chatType: "private" },
    } as never,
    result.res as never,
    vi.fn()
  );
  return result.state;
}

describe("personal agent panel routes", () => {
  it("creates agents with a supported model and selects them", async () => {
    const services = new ServiceRegistry();
    services.set("llm", {
      models: [
        {
          id: "fast",
          name: "Fast",
          model: "openai/gpt-5-mini",
          multiplier: 1,
          contextWindow: 128_000,
          provider: "openrouter",
        },
        {
          id: "search",
          name: "Search",
          model: "sonar",
          multiplier: 1,
          contextWindow: 128_000,
          provider: "perplexity",
        },
      ],
    } as never);
    const userAgents = new UserAgentService(getDb(), 10);
    const routes = buildAgentRoutes(
      {
        db: getDb(),
        services,
        config: { agent_runtime: { max_user_agents: 10, agents: [] } },
      } as unknown as ModuleContext,
      userAgents
    );
    const find = (method: PanelRoute["method"], path: string) =>
      routes.find((route) => route.method === method && route.path === path)!;

    const created = await invoke(find("post", "/agents"), {
      name: "Release editor",
      description: "Writes release notes",
      instructions: "Be factual and concise.",
      modelId: "fast",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: "my_release_editor", modelId: "fast" });

    const selected = await invoke(find("put", "/agents/selection"), {
      agentId: "my_release_editor",
    });
    expect(selected.body).toEqual({ ok: true, activeAgentId: "my_release_editor" });

    const primary = await invoke(find("put", "/agents/primary"), {
      agentId: "my_release_editor",
    });
    expect(primary.body).toEqual({ ok: true, primaryAgentId: "my_release_editor" });

    const listed = await invoke(find("get", "/agents"));
    expect(listed.body).toMatchObject({
      activeAgentId: "my_release_editor",
      primaryAgentId: "my_release_editor",
      models: [{ id: "fast", name: "Fast", multiplier: 1 }],
    });
  });

  it("rejects unsupported agent models", async () => {
    const services = new ServiceRegistry();
    services.set("llm", { models: [] } as never);
    const routes = buildAgentRoutes(
      {
        db: getDb(),
        services,
        config: { agent_runtime: { max_user_agents: 10, agents: [] } },
      } as unknown as ModuleContext,
      new UserAgentService(getDb(), 10)
    );
    const create = routes.find((route) => route.method === "post" && route.path === "/agents")!;

    const result = await invoke(create, {
      name: "Researcher",
      description: "Researches",
      instructions: "Check every source.",
      modelId: "missing",
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Unknown or unsupported agent model" });
  });
});
