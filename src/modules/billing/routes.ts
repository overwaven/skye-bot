import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import type { BillingService } from "./service.js";
import type { TokenPack } from "./config.js";
import type { ModelEntry } from "../llm/config.js";
import type { LlmClient } from "../llm/client.js";
import {
  createPackInvoiceLink,
  createSubscriptionInvoiceLink,
  decodeInvoiceConfig,
} from "./invoices.js";

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const billing = ctx.services.get("billing") as BillingService;
  const llm = ctx.services.get("llm") as LlmClient;
  const getBot = () => (ctx.services.has("telegramBot") ? ctx.services.get("telegramBot") : null);

  return [
    {
      method: "get",
      path: "/billing/account",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const acc = billing.getAccount(userId);
        const modelId = llm.models.some((model) => model.id === acc.modelId)
          ? acc.modelId
          : llm.defaultModelId;
        res.json({
          modelId,
          subStatus: acc.subStatus,
          subExpiresAt: acc.subExpiresAt,
          subPeriodStart: acc.subPeriodStart,
          baseUsedTokens: acc.baseUsedTokens,
          baseQuotaTokens: billing.config.baseQuotaTokens,
          packsTokens: acc.packsTokens,
          totalUsedTokens: acc.totalUsedTokens,
          remaining: billing.effectiveRemaining(acc),
          hasActiveSub: billing.hasActiveSub(acc),
        });
      },
    },
    {
      method: "get",
      path: "/billing/models",
      handler: (_req, res) => {
        const models = llm.models.map((m: ModelEntry) => ({
          id: m.id,
          name: m.name,
          multiplier: m.multiplier,
        }));
        res.json({ models, defaultModelId: llm.defaultModelId });
      },
    },
    {
      method: "put",
      path: "/billing/model",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const { modelId } = req.body as { modelId?: string };
        if (!modelId) {
          res.status(400).json({ error: "modelId is required" });
          return;
        }
        if (!llm.models.some((m: ModelEntry) => m.id === modelId)) {
          res.status(400).json({ error: "Unknown model" });
          return;
        }
        billing.selectModel(userId, modelId);
        const audit = ctx.services.has("audit") ? ctx.services.get("audit") : null;
        audit?.event({ action: "model_changed", userId, details: { modelId, source: "panel" } });
        res.json({ ok: true, modelId });
      },
    },
    {
      method: "get",
      path: "/billing/plans",
      handler: (_req, res) => {
        const cfg = decodeInvoiceConfig(ctx.config);
        res.json({
          enabled: ctx.config.billing.enabled,
          currency: cfg.currency,
          title: cfg.title,
          description: cfg.description,
          subscriptionStars: cfg.subscriptionStars,
          subscriptionPeriodSeconds: cfg.subscriptionPeriodSeconds,
          baseQuotaTokens: billing.config.baseQuotaTokens,
          packs: ctx.config.billing.token_packs as TokenPack[],
        });
      },
    },
    {
      method: "post",
      path: "/billing/invoice/subscription",
      handler: async (req, res) => {
        if (!ctx.config.billing.enabled) {
          res.status(404).json({ error: "Subscriptions are disabled on this bot" });
          return;
        }
        const userId = (req as PanelRequest).tenant.userId!;
        const bot = getBot();
        if (!bot) {
          res.status(503).json({ error: "Bot unavailable" });
          return;
        }
        try {
          const cfg = decodeInvoiceConfig(ctx.config);
          const invoice = billing.issueInvoice({
            userId,
            kind: "subscription",
            productId: null,
            title: cfg.title,
            currency: cfg.currency,
            amount: cfg.subscriptionStars,
            tokens: null,
            subscriptionPeriod: cfg.subscriptionPeriodSeconds,
          });
          const link = await createSubscriptionInvoiceLink(bot.api, cfg, invoice);
          res.json({ url: link });
        } catch (e) {
          res
            .status(500)
            .json({ error: e instanceof Error ? e.message : "Failed to create invoice" });
        }
      },
    },
    {
      method: "post",
      path: "/billing/invoice/pack",
      handler: async (req, res) => {
        if (!ctx.config.billing.enabled) {
          res.status(404).json({ error: "Subscriptions are disabled on this bot" });
          return;
        }
        const userId = (req as PanelRequest).tenant.userId!;
        const { packId } = req.body as { packId?: string };
        const packs = ctx.config.billing.token_packs as TokenPack[];
        const pack = packs.find((p) => p.id === packId);
        if (!pack) {
          res.status(400).json({ error: "Unknown pack" });
          return;
        }
        const acc = billing.getAccount(userId);
        if (!billing.hasActiveSub(acc)) {
          res.status(402).json({ error: "An active subscription is required to buy token packs." });
          return;
        }
        const bot = getBot();
        if (!bot) {
          res.status(503).json({ error: "Bot unavailable" });
          return;
        }
        try {
          const cfg = decodeInvoiceConfig(ctx.config);
          const invoice = billing.issueInvoice({
            userId,
            kind: "pack",
            productId: pack.id,
            title: pack.name,
            currency: cfg.currency,
            amount: pack.stars,
            tokens: pack.tokens,
            subscriptionPeriod: null,
          });
          const link = await createPackInvoiceLink(bot.api, cfg, invoice, pack);
          res.json({ url: link });
        } catch (e) {
          res
            .status(500)
            .json({ error: e instanceof Error ? e.message : "Failed to create invoice" });
        }
      },
    },
    {
      method: "post",
      path: "/billing/cancel",
      handler: async (req, res) => {
        if (!ctx.config.billing.enabled) {
          res.status(404).json({ error: "Subscriptions are disabled on this bot" });
          return;
        }
        const userId = (req as PanelRequest).tenant.userId!;
        const acc = billing.getAccount(userId);
        if (!billing.hasActiveSub(acc) || !acc.lastChargeId) {
          res.status(400).json({ error: "No active subscription to cancel" });
          return;
        }
        const bot = getBot();
        if (bot) {
          try {
            await bot.api.editUserStarSubscription(userId, acc.lastChargeId, true);
          } catch (e) {
            res.status(500).json({ error: e instanceof Error ? e.message : "Failed to cancel" });
            return;
          }
        }
        billing.markCancelled(userId);
        res.json({ ok: true });
      },
    },
    {
      method: "get",
      path: "/billing/events",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        res.json(billing.listEvents(userId, 50));
      },
    },
  ];
}
