import { InlineKeyboard, type Context as GrammyContext, type NextFunction } from "grammy";
import type { TelegramCommand, TelegramHandler } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import type { LegalService } from "./service.js";
import type { LegalConfig } from "./config.js";
import { sendRichEdit, sendRichReply } from "../telegram/helpers.js";
import { appCommit, appVersion } from "../../core/appInfo.js";
import type { ConnectorService } from "../connectors/service.js";
import { log } from "../../utils/log.js";

export interface LegalDeps {
  legal: LegalService;
  cfg: LegalConfig["legal"];
  connectors: ConnectorService;
}

export function buildLegalCommands(deps: LegalDeps): TelegramCommand[] {
  const { cfg } = deps;

  return [
    {
      name: "source",
      description: "View Skye's source code and license",
      public: true,
      handler: async (ctx) => {
        const commit = appCommit();
        const sourceUrl = commit ? `${cfg.source_url}/tree/${commit}` : cfg.source_url;
        const md = [
          "## Skye is free software",
          "",
          "Skye is licensed under **GNU AGPLv3-only**. You can inspect, run, modify, and share the source under that license.",
          "",
          `**Version:** ${appVersion()}`,
          ...(commit ? [`**Commit:** \`${commit.slice(0, 12)}\``] : []),
          "",
          "The source link below points to the code for this deployment when a commit was supplied by the operator.",
        ].join("\n");
        await sendRichReply(ctx, `${md}\n\n_Open source, by design._`, {
          reply_markup: new InlineKeyboard()
            .url("View source", sourceUrl)
            .row()
            .url("Security policy", cfg.security_url),
        });
      },
    },
    {
      name: "terms",
      description: "Terms of Service",
      public: true,
      handler: async (ctx) => {
        await sendRichReply(
          ctx,
          "## Terms of Service\n\nOpen the full document with the button below.",
          {
            reply_markup: new InlineKeyboard().url("Open Terms", cfg.terms_url),
          }
        );
      },
    },
    {
      name: "privacy",
      description: "Privacy Policy",
      public: true,
      handler: async (ctx) => {
        await sendRichReply(
          ctx,
          "## Privacy Policy\n\nOpen the full document with the button below.",
          {
            reply_markup: new InlineKeyboard().url("Open Privacy Policy", cfg.privacy_url),
          }
        );
      },
    },
    {
      name: "paysupport",
      description: "Payment support contact",
      public: true,
      handler: async (ctx) => {
        const md = [
          "## Payment support",
          "",
          `Problems with a Stars payment, refund, or subscription? Reach out:`,
          "",
          `- Telegram: ${cfg.support_username}`,
          `- Email: ${cfg.developer_email}`,
          "",
          "Include your Telegram user id so we can find your account faster.",
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "developer_info",
      description: "Developer information",
      public: true,
      handler: async (ctx) => {
        const md = [
          "## Developer",
          "",
          `**${cfg.developer_name}**`,
          ...(cfg.developer_alias ? [`_Also known as ${cfg.developer_alias}._`, ""] : []),
          "",
          `- Telegram: ${cfg.support_username}`,
          `- Email: ${cfg.developer_email}`,
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "delete_my_data",
      description: "Delete all your data from Skye",
      public: true,
      handler: async (ctx) => {
        if (ctx.chat?.type !== "private") {
          await sendRichReply(
            ctx,
            "For your safety, /delete_my_data only works in a private chat with Skye. Open me in DMs to proceed."
          );
          return;
        }
        const md = [
          "## Delete your data",
          "",
          "This will **permanently** erase everything Skye stores about you:",
          "",
          "- Your settings, system prompt, and model choice",
          "- Your connected accounts and custom HTTPS connectors",
          "- Your subscription, token balance, and billing history",
          "- Your long-term memories",
          "- Your private conversation history and summaries",
          "- Your reminders",
          "- Your audit log entries",
          "",
          "_Shared group data is kept — it belongs to the group, not to you alone._",
          "",
          "This cannot be undone. Continue?",
        ].join("\n");
        await sendRichReply(ctx, md, {
          reply_markup: new InlineKeyboard()
            .text("Yes, delete everything", "legal:delete:confirm")
            .row()
            .text("Cancel", "legal:delete:cancel"),
        });
      },
    },
  ];
}

export function buildLegalHandlers(deps: LegalDeps): TelegramHandler[] {
  const onCallback: TelegramHandler = {
    on: "callback_query:data",
    order: 85,
    handler: async (ctx: GrammyContext, _tenant: TenantContext, next: NextFunction) => {
      const data = ctx.callbackQuery?.data ?? "";
      if (!data.startsWith("legal:")) return next();

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.answerCallbackQuery();
        return;
      }

      const action = data.slice("legal:".length);
      try {
        if (action === "delete:cancel") {
          await ctx.answerCallbackQuery("Cancelled.");
          await sendRichEdit(ctx, "_Data deletion cancelled._ Nothing was erased.");
          return;
        }

        if (action === "delete:confirm") {
          await ctx.answerCallbackQuery("Erasing your data…");
          let externalDeletionFailed = false;
          try {
            await deps.connectors.deleteExternalUserData(userId);
          } catch (error) {
            externalDeletionFailed = true;
            log.error({ err: error, userId }, "Could not delete externally managed connector data");
          }
          const summary = deps.legal.deleteUserData(userId);
          const total =
            summary.userConfigs +
            summary.customConnectors +
            summary.customConnectorInputs +
            summary.connectorSessions +
            summary.billingAccounts +
            summary.billingEvents +
            summary.memories +
            summary.chatSummaries +
            summary.conversationItems +
            summary.groupMessages +
            summary.chatConfigs +
            summary.reminders +
            summary.requestLogs +
            summary.adminPrincipals;

          const md = [
            externalDeletionFailed
              ? "⚠️ **Your local Skye data has been deleted.**"
              : "✅ **Your data has been deleted.**",
            "",
            `Erased ${total} record(s) across Skye's database.`,
            ...(externalDeletionFailed
              ? [
                  "",
                  "Skye could not confirm deletion of externally managed connector credentials. Please contact support via /paysupport so the operator can finish that removal.",
                ]
              : []),
            "",
            "_This message is the only confirmation we keep. A fresh start — say hi anytime._",
          ].join("\n");
          await sendRichEdit(ctx, md);
          return;
        }
      } catch {
        await ctx.answerCallbackQuery("Something went wrong.");
        await sendRichEdit(
          ctx,
          "**Couldn't complete data deletion.** Please contact support via /paysupport."
        );
        return;
      }

      return next();
    },
  };

  return [onCallback];
}
