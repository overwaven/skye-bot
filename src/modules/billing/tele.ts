import { InlineKeyboard, type Context as GrammyContext, type NextFunction } from "grammy";
import type { TelegramCommand, TelegramHandler } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import type { BillingService } from "./service.js";
import type { ModelEntry } from "../llm/config.js";
import type { LlmClient } from "../llm/client.js";
import type { TokenPack } from "./config.js";
import { decodeInvoicePayload, invoicePayload, type InvoiceConfig } from "./invoices.js";
import { sendRichReply, sendRichEdit } from "../telegram/helpers.js";
import { log } from "../../utils/log.js";

function isPrivateChat(ctx: GrammyContext): boolean {
  return ctx.chat?.type === "private";
}

interface SuccessfulPaymentLike {
  telegram_payment_charge_id: string;
  total_amount: number;
  subscription_expiration_date?: number;
  is_recurring?: true;
  is_first_recurring?: true;
  invoice_payload: string;
  currency: string;
}

function fmtTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtDate(unixSec: number): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function modelName(llm: LlmClient, id: string): ModelEntry {
  return llm.models.find((m) => m.id === id) ?? llm.models[0];
}

export interface BillingDeps {
  enabled: boolean;
  billing: BillingService;
  llm: LlmClient;
  cfg: InvoiceConfig;
  packs: TokenPack[];
  webappUrl: string;
}

/** Build the user-facing /plus menu inline keyboard. */
function plusKeyboard(
  deps: BillingDeps,
  acc: ReturnType<BillingService["getAccount"]>,
  includeWebApp: boolean
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const active = deps.billing.hasActiveSub(acc);
  if (!active) {
    kb.text(`Subscribe — ${deps.cfg.subscriptionStars} ⭐`, "bill:sub");
    kb.row();
    kb.text("Choose model", "bill:models");
    kb.row();
  } else {
    kb.text("Buy token packs", "bill:packs");
    kb.row();
    kb.text("Choose model", "bill:models");
    kb.row();
    kb.text("Cancel subscription", "bill:cancel");
    kb.row();
    kb.text("Subscription details", "bill:menu");
    kb.row();
  }
  if (includeWebApp) {
    kb.webApp("Open in Mini App", deps.webappUrl);
  }
  return kb;
}

function statusText(deps: BillingDeps, acc: ReturnType<BillingService["getAccount"]>): string {
  const active = deps.billing.hasActiveSub(acc);
  const model = modelName(deps.llm, acc.modelId);
  const remaining = deps.billing.effectiveRemaining(acc);
  const baseUsed = acc.baseUsedTokens;
  const baseQuota = deps.billing.config.baseQuotaTokens;
  const lines: string[] = ["## Skye Plus", ""];
  if (active) {
    lines.push(`**Subscription:** Active`);
    lines.push(`**Next renewal:** ${fmtDate(acc.subExpiresAt)}`);
    if (acc.subStatus === "cancelled")
      lines.push("_No further charges — your subscription is set to cancel at the next renewal._");
  } else {
    lines.push(`**Subscription:** Not active`);
    lines.push(`Subscribe for **${deps.cfg.subscriptionStars} ⭐** a month to unlock Skye.`);
  }
  lines.push("");
  lines.push(`**Model:** ${model.name} (${model.multiplier}× token cost)`);
  if (active) {
    lines.push("");
    lines.push(`**Tokens remaining:** ${fmtTokens(remaining)}`);
    lines.push(
      `- Base quota this month: ${fmtTokens(Math.max(0, baseQuota - baseUsed))} of ${fmtTokens(baseQuota)} left`
    );
    lines.push(`- Boost packs: ${fmtTokens(acc.packsTokens)}`);
    lines.push(`- Lifetime used: ${fmtTokens(acc.totalUsedTokens)}`);
  }
  return lines.join("\n");
}

function modelsText(deps: BillingDeps, acc: ReturnType<BillingService["getAccount"]>): string {
  const current = modelName(deps.llm, acc.modelId);
  return [
    "## Choose your model",
    "",
    `Current: **${current.name}** (${current.multiplier}× token cost).`,
    "",
    "Models differ in power and token cost. Pick one below.",
  ].join("\n");
}

function modelsKeyboard(
  deps: BillingDeps,
  acc: ReturnType<BillingService["getAccount"]>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of deps.llm.models) {
    kb.text(
      `${m.id === acc.modelId ? "✅ " : ""}${m.name} (${m.multiplier}×)`,
      `bill:model:${m.id}`
    );
    kb.row();
  }
  kb.text("Back", "bill:menu");
  return kb;
}

function packsText(deps: BillingDeps): string {
  const lines = deps.packs.map(
    (p) => `- **${p.name}** — ${p.stars} ⭐ · ${fmtTokens(p.tokens)} tokens`
  );
  return [
    "## Token packs",
    "",
    "Top up your monthly quota. Packs are spent before your base quota and expire when your subscription ends.",
    "",
    ...lines,
  ].join("\n");
}

function packsKeyboard(deps: BillingDeps): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of deps.packs) {
    kb.text(`${p.name} — ${p.stars} ⭐`, `bill:pack:${p.id}`);
    kb.row();
  }
  kb.text("Back", "bill:menu");
  return kb;
}

function buildCommands(deps: BillingDeps): TelegramCommand[] {
  return [
    {
      name: "plus",
      description: "Skye Plus subscription & tokens",
      public: true,
      handler: async (ctx, tenant) => {
        const acc = deps.billing.getAccount(tenant.userId!);
        await sendRichReply(ctx, `${statusText(deps, acc)}\n\n👇`, {
          reply_markup: plusKeyboard(deps, acc, isPrivateChat(ctx)),
        });
      },
    },
    {
      name: "models",
      description: "Choose your AI model tier",
      public: true,
      handler: async (ctx, tenant) => {
        const acc = deps.billing.getAccount(tenant.userId!);
        await sendRichReply(ctx, `${modelsText(deps, acc)}\n\n👇`, {
          reply_markup: modelsKeyboard(deps, acc),
        });
      },
    },
    {
      name: "tokens",
      description: "Show your token balance",
      public: true,
      handler: async (ctx, tenant) => {
        const acc = deps.billing.getAccount(tenant.userId!);
        const active = deps.billing.hasActiveSub(acc);
        const kb = active
          ? (() => {
              const k = new InlineKeyboard().text("Buy token packs", "bill:packs").row();
              if (isPrivateChat(ctx)) k.webApp("Open in Mini App", deps.webappUrl);
              return k;
            })()
          : plusKeyboard(deps, acc, isPrivateChat(ctx));
        await sendRichReply(ctx, `${statusText(deps, acc)}\n\n👇`, { reply_markup: kb });
      },
    },
    {
      name: "cancel",
      description: "Cancel your Skye Plus subscription",
      public: true,
      handler: async (ctx, tenant) => {
        const acc = deps.billing.getAccount(tenant.userId!);
        if (!deps.billing.hasActiveSub(acc) || !acc.lastChargeId) {
          await sendRichReply(ctx, "_You don't have an active subscription to cancel._");
          return;
        }
        await sendRichReply(
          ctx,
          "**Cancel your Skye Plus subscription?**\n\nYour access stays until the renewal date, then ends. No further charges.",
          {
            reply_markup: new InlineKeyboard()
              .text("Yes, cancel", "bill:cancel")
              .row()
              .text("Keep it", "bill:menu"),
          }
        );
      },
    },
  ];
}

function buildHandlers(deps: BillingDeps): TelegramHandler[] {
  const onCallback: TelegramHandler = {
    on: "callback_query:data",
    order: 90,
    handler: async (ctx: GrammyContext, _tenant: TenantContext, next: NextFunction) => {
      const data = ctx.callbackQuery?.data ?? "";
      if (!data.startsWith("bill:")) return next();

      if (!deps.enabled) {
        await ctx.answerCallbackQuery("Subscriptions are disabled on this bot.");
        return;
      }

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.answerCallbackQuery();
        return;
      }

      const action = data.slice("bill:".length);
      const acc = deps.billing.getAccount(userId);

      try {
        if (action === "menu") {
          await sendRichEdit(
            ctx,
            statusText(deps, acc) + "\n\n👇",
            plusKeyboard(deps, acc, isPrivateChat(ctx))
          );
        } else if (action === "models") {
          await sendRichEdit(ctx, modelsText(deps, acc) + "\n\n👇", modelsKeyboard(deps, acc));
        } else if (action === "sub") {
          if (deps.billing.hasActiveSub(acc)) {
            await ctx.answerCallbackQuery("You already have a subscription.");
            return;
          }
          await ctx.answerCallbackQuery("Generating invoice…");
          const invoice = deps.billing.issueInvoice({
            userId,
            kind: "subscription",
            productId: null,
            title: deps.cfg.title,
            currency: deps.cfg.currency,
            amount: deps.cfg.subscriptionStars,
            tokens: null,
            subscriptionPeriod: deps.cfg.subscriptionPeriodSeconds,
          });
          // Stars recurring subscriptions must be created via createInvoiceLink
          // (sendInvoice doesn't accept subscription_period). Send the link as a
          // tappable invoice button.
          const url = await ctx.api.createInvoiceLink(
            deps.cfg.title,
            deps.cfg.description,
            invoicePayload(invoice.id),
            "",
            deps.cfg.currency,
            [{ label: `${deps.cfg.title} (30 days)`, amount: deps.cfg.subscriptionStars }],
            { subscription_period: deps.cfg.subscriptionPeriodSeconds }
          );
          await sendRichReply(
            ctx,
            `**Subscribe to ${deps.cfg.title}** for **${deps.cfg.subscriptionStars} ⭐** / 30 days:`,
            {
              reply_markup: new InlineKeyboard().url(`Pay ${deps.cfg.subscriptionStars} ⭐`, url),
            }
          );
        } else if (action === "packs") {
          if (!deps.billing.hasActiveSub(acc)) {
            await ctx.answerCallbackQuery("Subscribe first to buy token packs.");
            return;
          }
          await sendRichEdit(ctx, packsText(deps) + "\n\n👇", packsKeyboard(deps));
          await ctx.answerCallbackQuery();
        } else if (action.startsWith("pack:")) {
          const packId = action.slice("pack:".length);
          const pack = deps.packs.find((p) => p.id === packId);
          if (!pack) {
            await ctx.answerCallbackQuery("Pack not found.");
            return;
          }
          if (!deps.billing.hasActiveSub(acc)) {
            await ctx.answerCallbackQuery("Subscribe first to buy token packs.");
            return;
          }
          await ctx.answerCallbackQuery("Generating invoice…");
          const invoice = deps.billing.issueInvoice({
            userId,
            kind: "pack",
            productId: pack.id,
            title: pack.name,
            currency: deps.cfg.currency,
            amount: pack.stars,
            tokens: pack.tokens,
            subscriptionPeriod: null,
          });
          await ctx.replyWithInvoice(
            deps.cfg.title,
            `${pack.name} — adds ${fmtTokens(pack.tokens)} tokens.`,
            invoicePayload(invoice.id),
            deps.cfg.currency,
            [{ label: pack.name, amount: pack.stars }],
            { provider_token: "" }
          );
        } else if (action.startsWith("model:")) {
          const modelId = action.slice("model:".length);
          if (!deps.llm.models.some((m) => m.id === modelId)) {
            await ctx.answerCallbackQuery("Unknown model.");
            return;
          }
          deps.billing.selectModel(userId, modelId);
          const refreshed = deps.billing.getAccount(userId);
          await ctx.answerCallbackQuery(`Switched to ${modelName(deps.llm, modelId).name}`);
          await sendRichEdit(
            ctx,
            modelsText(deps, refreshed) + "\n\n👇",
            modelsKeyboard(deps, refreshed)
          );
        } else if (action === "cancel") {
          if (!deps.billing.hasActiveSub(acc) || !acc.lastChargeId) {
            await ctx.answerCallbackQuery("No active subscription to cancel.");
            return;
          }
          try {
            await ctx.api.editUserStarSubscription(userId, acc.lastChargeId, true);
          } catch (e) {
            log.warn({ err: e, userId }, "editUserStarSubscription failed");
            await ctx.answerCallbackQuery("Telegram refused the cancellation request.");
            return;
          }
          deps.billing.markCancelled(userId);
          await ctx.answerCallbackQuery("Subscription cancelled");
          const refreshed = deps.billing.getAccount(userId);
          await sendRichEdit(
            ctx,
            statusText(deps, refreshed) + "\n\n👇",
            plusKeyboard(deps, refreshed, isPrivateChat(ctx))
          );
        }
      } catch (e) {
        log.warn({ err: e, data }, "billing callback handler failed");
        await ctx.answerCallbackQuery().catch(() => {});
      }
    },
  };

  const onPreCheckout: TelegramHandler = {
    on: "pre_checkout_query",
    order: 10,
    handler: async (ctx) => {
      try {
        const query = ctx.preCheckoutQuery;
        if (!query) return;
        if (!deps.enabled) {
          await ctx.answerPreCheckoutQuery(false, {
            error_message: "Subscriptions are disabled on this bot.",
          });
          return;
        }
        const invoiceId = decodeInvoicePayload(query.invoice_payload);
        const valid = invoiceId
          ? deps.billing.validateInvoice(
              query.from.id,
              invoiceId,
              query.currency,
              query.total_amount
            )
          : null;
        await ctx.answerPreCheckoutQuery(
          !!valid,
          valid ? undefined : { error_message: "Invoice is invalid or expired." }
        );
      } catch (e) {
        log.warn({ err: e }, "answerPreCheckoutQuery failed");
      }
    },
  };

  const onPayment: TelegramHandler = {
    on: "message:successful_payment",
    order: 10,
    handler: async (ctx, tenant) => {
      const payment = (ctx.message as { successful_payment?: SuccessfulPaymentLike })
        ?.successful_payment;
      if (!payment) return;
      const invoiceId = decodeInvoicePayload(String(payment.invoice_payload ?? ""));
      if (!invoiceId || tenant.userId == null) {
        log.warn({ payload: payment.invoice_payload }, "Unknown payment payload");
        return;
      }
      const invoice = deps.billing.fulfillInvoice({
        userId: tenant.userId,
        invoiceId,
        currency: payment.currency,
        amount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        subscriptionExpirationDate: payment.subscription_expiration_date,
        isRecurring: payment.is_recurring,
        isFirstRecurring: payment.is_first_recurring,
      });
      if (!invoice) {
        log.warn({ invoiceId, userId: tenant.userId }, "Payment terms mismatch");
        return;
      }
      if (invoice.kind === "subscription") {
        await sendRichReply(
          ctx,
          "🎉 **Skye Plus activated.**\n\nYou've got 2,000,000 tokens to spend this month. Use /models to pick your model, or just start chatting."
        );
      } else {
        await sendRichReply(
          ctx,
          `✅ **${invoice.title} added** — +${fmtTokens(invoice.tokens ?? 0)} tokens.`
        );
      }
    },
  };

  return [onPreCheckout, onPayment, onCallback];
}

export function buildBilling(deps: BillingDeps): {
  commands: TelegramCommand[];
  handlers: TelegramHandler[];
} {
  return { commands: buildCommands(deps), handlers: buildHandlers(deps) };
}
