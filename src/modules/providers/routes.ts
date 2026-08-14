import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { resolveChatNames } from "../panel/chatNames.js";
import type { AiRouting } from "./types.js";
import type { ProviderService } from "./service.js";

function isAdmin(ctx: ModuleContext, req: PanelRequest): boolean {
  return ctx.services.get("admin").isAdmin(req.initData.user.id);
}

function routingPatch(body: unknown): Partial<AiRouting> {
  const value = body as Record<string, unknown>;
  const imageModelId = value?.imageModelId;
  if (imageModelId !== null && typeof imageModelId !== "string") {
    throw new Error("imageModelId must be a string or null");
  }
  return {
    imageGenerationModelId: imageModelId,
    imageEditModelId: imageModelId,
  };
}

function canUseChat(ctx: ModuleContext, req: PanelRequest, chatId: number): boolean {
  const userId = req.initData.user.id;
  if (chatId === userId || isAdmin(ctx, req)) return true;
  return Boolean(
    ctx.db
      .prepare<
        [number, number],
        { found: number }
      >("SELECT 1 AS found FROM request_logs WHERE user_id = ? AND chat_id = ? LIMIT 1")
      .get(userId, chatId)
  );
}

async function recentChats(ctx: ModuleContext, userId: number) {
  const rows = ctx.db
    .prepare<[number], { chatId: number; chatType: string | null; lastSeen: string }>(
      `SELECT chat_id AS chatId, MAX(chat_type) AS chatType, MAX(ts) AS lastSeen
       FROM request_logs
       WHERE user_id = ? AND chat_id IS NOT NULL
       GROUP BY chat_id
       ORDER BY lastSeen DESC
       LIMIT 30`
    )
    .all(userId);
  if (!rows.some((row) => row.chatId === userId)) {
    rows.unshift({ chatId: userId, chatType: "private", lastSeen: "" });
  }
  const names = await resolveChatNames(
    ctx,
    rows.filter((row) => row.chatId !== userId).map((row) => row.chatId)
  );
  return rows.map((row) => ({
    chatId: row.chatId,
    name: row.chatId === userId ? "Personal chat" : names.get(row.chatId) || `Chat ${row.chatId}`,
    type: row.chatType || (row.chatId === userId ? "private" : "group"),
  }));
}

export function buildProviderRoutes(ctx: ModuleContext, providers: ProviderService): PanelRoute[] {
  return [
    {
      method: "get",
      path: "/ai/catalog",
      handler: async (req, res) => {
        const panelReq = req as PanelRequest;
        const requested = Number(req.query.chatId ?? panelReq.initData.user.id);
        const chatId =
          Number.isSafeInteger(requested) && canUseChat(ctx, panelReq, requested)
            ? requested
            : panelReq.initData.user.id;
        res.json({
          chatId,
          chats: await recentChats(ctx, panelReq.initData.user.id),
          imageModelId: providers.getChatRoutingOverrides(chatId).imageGenerationModelId,
          defaultImageModelId: providers.getRouting().imageGenerationModelId,
          models: providers
            .listAvailableModels()
            .filter(
              (model) =>
                model.capabilities.includes("image_generation") &&
                model.capabilities.includes("image_edit")
            )
            .map((model) => ({ id: model.id, name: model.name })),
        });
      },
    },
    {
      method: "put",
      path: "/ai/routing/:chatId",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        const chatId = Number(req.params.chatId);
        if (!Number.isSafeInteger(chatId) || !canUseChat(ctx, panelReq, chatId)) {
          res.status(403).json({ error: "This chat is not available to you" });
          return;
        }
        try {
          const routing = providers.setChatRouting(chatId, routingPatch(req.body));
          if (ctx.services.has("audit")) {
            ctx.services.get("audit").event({
              action: "chat_ai_routing_changed",
              userId: panelReq.initData.user.id,
              chatId,
              details: { source: "panel", setting: "image_model" },
            });
          }
          res.json({ imageModelId: routing.imageGenerationModelId });
        } catch (error) {
          res.status(400).json({
            error: error instanceof Error ? error.message : "Unable to update the image model",
          });
        }
      },
    },
  ];
}
