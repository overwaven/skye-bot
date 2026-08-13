import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import {
  MODEL_CAPABILITIES,
  PROVIDER_KINDS,
  type AiModelConfig,
  type AiRouting,
  type ModelCapability,
  type ProviderKind,
} from "./types.js";
import type { ModelInput, ProviderInput, ProviderService } from "./service.js";

function isAdmin(ctx: ModuleContext, req: PanelRequest): boolean {
  return ctx.services.get("admin").isAdmin(req.initData.user.id);
}

function requireAdmin(
  ctx: ModuleContext,
  req: PanelRequest,
  res: { status: (code: number) => { json: (body: unknown) => void } }
): boolean {
  if (isAdmin(ctx, req)) return true;
  res.status(403).json({ error: "Administrator access required" });
  return false;
}

function providerInput(body: unknown): ProviderInput {
  const value = body as Record<string, unknown>;
  const name = String(value?.name ?? "").trim();
  const kind = String(value?.kind ?? "") as ProviderKind;
  const baseUrl = String(value?.baseUrl ?? "").trim();
  if (!name) throw new Error("Enter a provider name");
  if (!PROVIDER_KINDS.includes(kind)) throw new Error("Choose a supported provider type");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      throw new Error("Use an HTTPS base URL");
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === "Use an HTTPS base URL"
        ? error.message
        : "Enter a valid base URL"
    );
  }
  return {
    name,
    kind,
    baseUrl,
    ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
  };
}

function modelInput(body: unknown): ModelInput {
  const value = body as Record<string, unknown>;
  const name = String(value?.name ?? "").trim();
  const upstreamId = String(value?.upstreamId ?? "").trim();
  const rawCapabilities = Array.isArray(value?.capabilities) ? value.capabilities : [];
  const capabilities = rawCapabilities.filter((candidate): candidate is ModelCapability =>
    MODEL_CAPABILITIES.includes(candidate as ModelCapability)
  );
  const contextWindow = Number(value?.contextWindow ?? 128_000);
  const multiplier = Number(value?.multiplier ?? 1);
  if (!name) throw new Error("Enter a model name");
  if (!upstreamId) throw new Error("Enter the provider model ID");
  if (capabilities.length === 0) throw new Error("Choose at least one capability");
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)
    throw new Error("Context window must be a positive integer");
  if (!Number.isFinite(multiplier) || multiplier <= 0)
    throw new Error("Token multiplier must be positive");
  return {
    name,
    upstreamId,
    capabilities,
    contextWindow,
    multiplier,
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    config:
      value.config && typeof value.config === "object" && !Array.isArray(value.config)
        ? (value.config as AiModelConfig)
        : {},
  };
}

function routingPatch(body: unknown): Partial<AiRouting> {
  const value = body as Record<string, unknown>;
  const patch: Partial<AiRouting> = {};
  for (const key of [
    "textModelId",
    "imageGenerationModelId",
    "imageEditModelId",
    "ttsModelId",
    "sttModelId",
    "ttsVoice",
  ] as const) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if (candidate !== null && typeof candidate !== "string") {
      throw new Error(`${key} must be a string or null`);
    }
    patch[key] = candidate;
  }
  return patch;
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

function recentChats(ctx: ModuleContext, userId: number) {
  const rows = ctx.db
    .prepare<
      [number],
      { chatId: number; chatName: string | null; chatType: string | null; lastSeen: string }
    >(
      `SELECT chat_id AS chatId, MAX(chat_name) AS chatName, MAX(chat_type) AS chatType,
              MAX(ts) AS lastSeen
       FROM request_logs
       WHERE user_id = ? AND chat_id IS NOT NULL
       GROUP BY chat_id
       ORDER BY lastSeen DESC
       LIMIT 30`
    )
    .all(userId);
  if (!rows.some((row) => row.chatId === userId)) {
    rows.unshift({ chatId: userId, chatName: "Personal chat", chatType: "private", lastSeen: "" });
  }
  return rows.map((row) => ({
    chatId: row.chatId,
    name: row.chatId === userId ? "Personal chat" : row.chatName || `Chat ${row.chatId}`,
    type: row.chatType || (row.chatId === userId ? "private" : "group"),
  }));
}

export function buildProviderRoutes(ctx: ModuleContext, providers: ProviderService): PanelRoute[] {
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);
  const auditAdmin = (req: PanelRequest, action: string, details: Record<string, unknown>) => {
    audit()?.event({
      action,
      userId: req.initData.user.id,
      details: { ...details, source: "panel" },
    });
  };

  return [
    {
      method: "get",
      path: "/ai/catalog",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        const requested = Number(req.query.chatId ?? panelReq.initData.user.id);
        const chatId =
          Number.isSafeInteger(requested) && canUseChat(ctx, panelReq, requested)
            ? requested
            : panelReq.initData.user.id;
        const providerNames = new Map(
          providers.listProviders().map((provider) => [provider.id, provider.name])
        );
        res.json({
          configured: providers.textCatalog().length > 0,
          chatId,
          chats: recentChats(ctx, panelReq.initData.user.id),
          routing: providers.getRouting(chatId),
          overrides: providers.getChatRoutingOverrides(chatId),
          defaults: providers.getRouting(),
          models: providers.listAvailableModels().map((model) => ({
            ...model,
            providerName: providerNames.get(model.providerId) ?? "Provider",
          })),
          canManageProviders: isAdmin(ctx, panelReq),
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
          audit()?.event({
            action: "chat_ai_routing_changed",
            userId: panelReq.initData.user.id,
            chatId,
            details: { source: "panel" },
          });
          res.json({ routing, overrides: providers.getChatRoutingOverrides(chatId) });
        } catch (error) {
          res.status(400).json({
            error: error instanceof Error ? error.message : "Unable to update chat AI settings",
          });
        }
      },
    },
    {
      method: "get",
      path: "/admin/providers",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        res.json({
          providers: providers.listProviders().map((provider) => ({
            ...provider,
            models: providers.listModels(provider.id),
          })),
          defaults: providers.getRouting(),
          onboardingRequired: providers.textCatalog().length === 0,
        });
      },
    },
    {
      method: "post",
      path: "/admin/providers",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        try {
          const provider = providers.createProvider(providerInput(req.body));
          auditAdmin(panelReq, "ai_provider_added", {
            providerId: provider.id,
            kind: provider.kind,
          });
          res.status(201).json(provider);
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Unable to add provider" });
        }
      },
    },
    {
      method: "put",
      path: "/admin/providers/:providerId",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        try {
          const provider = providers.updateProvider(
            String(req.params.providerId),
            providerInput(req.body)
          );
          if (!provider) {
            res.status(404).json({ error: "Provider not found" });
            return;
          }
          auditAdmin(panelReq, "ai_provider_updated", { providerId: provider.id });
          res.json(provider);
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Unable to update provider" });
        }
      },
    },
    {
      method: "delete",
      path: "/admin/providers/:providerId",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        if (!providers.deleteProvider(String(req.params.providerId))) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }
        auditAdmin(panelReq, "ai_provider_deleted", { providerId: String(req.params.providerId) });
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/admin/providers/:providerId/test",
      handler: async (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        const result = await providers.testProvider(String(req.params.providerId));
        res.status(result.ok ? 200 : 400).json(result);
      },
    },
    {
      method: "get",
      path: "/admin/providers/:providerId/discover",
      handler: async (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        try {
          res.json({ models: await providers.discoverModels(String(req.params.providerId)) });
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Unable to discover models" });
        }
      },
    },
    {
      method: "post",
      path: "/admin/providers/:providerId/models",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        try {
          const providerId = String(req.params.providerId);
          const model = providers.createModel(providerId, modelInput(req.body));
          auditAdmin(panelReq, "ai_model_added", { providerId, modelId: model.id });
          res.status(201).json(model);
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Unable to add model" });
        }
      },
    },
    {
      method: "put",
      path: "/admin/models/:modelId",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        try {
          const model = providers.updateModel(String(req.params.modelId), modelInput(req.body));
          if (!model) {
            res.status(404).json({ error: "Model not found" });
            return;
          }
          auditAdmin(panelReq, "ai_model_updated", { modelId: model.id });
          res.json(model);
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Unable to update model" });
        }
      },
    },
    {
      method: "delete",
      path: "/admin/models/:modelId",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        if (!providers.deleteModel(String(req.params.modelId))) {
          res.status(404).json({ error: "Model not found" });
          return;
        }
        auditAdmin(panelReq, "ai_model_deleted", { modelId: String(req.params.modelId) });
        res.status(204).end();
      },
    },
    {
      method: "put",
      path: "/admin/ai-defaults",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!requireAdmin(ctx, panelReq, res)) return;
        try {
          const defaults = providers.setDefaultRouting(routingPatch(req.body));
          auditAdmin(panelReq, "ai_defaults_changed", {});
          res.json({ defaults });
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Unable to update defaults" });
        }
      },
    },
  ];
}
