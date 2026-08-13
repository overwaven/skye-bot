import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../core/db.js";
import { ServiceRegistry, type ModuleContext } from "../../../core/module.js";
import type { PanelRequest } from "../../panel/index.js";
import { buildProviderRoutes } from "../routes.js";
import type { ProviderService } from "../service.js";

const USER_ID = 84_201;
const GROUP_ID = -100_84201;

beforeEach(() => {
  getDb().prepare("DELETE FROM request_logs WHERE user_id = ?").run(USER_ID);
});

describe("provider panel routes", () => {
  it("lists recent chats using the deployed request_logs schema", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO request_logs (
        ts, chat_id, chat_type, user_id, msg_type, input_len, output_len,
        latency_ms, model, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      new Date().toISOString(),
      GROUP_ID,
      "supergroup",
      USER_ID,
      "text",
      1,
      1,
      10,
      "test",
      "ok"
    );

    const services = new ServiceRegistry();
    services.set("admin", { isAdmin: () => false } as never);
    const providers = {
      textCatalog: () => [],
      listProviders: () => [],
      getRouting: () => ({}),
      getChatRoutingOverrides: () => ({}),
      listAvailableModels: () => [],
    } as unknown as ProviderService;
    const route = buildProviderRoutes({ db, services } as unknown as ModuleContext, providers).find(
      (candidate) => candidate.method === "get" && candidate.path === "/ai/catalog"
    )!;
    const state: { body?: unknown } = {};
    const response = {
      json(body: unknown) {
        state.body = body;
        return response;
      },
    };

    await route.handler(
      {
        query: {},
        params: {},
        initData: { user: { id: USER_ID } },
        tenant: { userId: USER_ID, chatId: USER_ID, chatType: "private" },
      } as unknown as PanelRequest,
      response as never,
      vi.fn()
    );

    expect(state.body).toMatchObject({
      chatId: USER_ID,
      chats: [
        { chatId: USER_ID, name: "Personal chat", type: "private" },
        { chatId: GROUP_ID, name: `Chat ${GROUP_ID}`, type: "supergroup" },
      ],
    });
  });
});
