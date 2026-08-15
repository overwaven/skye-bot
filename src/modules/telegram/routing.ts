import { Bot, type Context as GrammyContext, type NextFunction } from "grammy";
import type { Contributions } from "../../core/module.js";
import { tenantFromGrammy } from "../../core/tenant.js";
import { checkAccess, type AccessDeps } from "./access.js";
import { sendRichReply, serializeError } from "./helpers.js";
import { log } from "../../utils/log.js";
import type { ImageControl, MediaGroupEntry, TelegramDeps } from "./deps.js";
import { createMentionHelpers } from "./mention.js";
import { createConversationHelpers, registerGroupLogging } from "./conversation.js";
import { createMediaHelpers } from "./media.js";
import {
  createGenerateImageTool,
  createRunImageEditCommand,
  registerImageControlCallbacks,
} from "./imageTool.js";
import { buildTelegramCommands } from "./commands.js";
import { createRunLlmReply } from "./llmReply.js";
import { registerMessageHandlers } from "./messageHandlers.js";
import { registerReminderDelivery } from "./remindersDelivery.js";
import { uniqByCommand } from "./uiHelpers.js";
import { createBrowserScreenshotTool } from "./browserTool.js";

export type { TelegramDeps } from "./deps.js";

export function installTelegram(bot: Bot, deps: TelegramDeps, contributions: Contributions): void {
  const access: AccessDeps = {
    billing: deps.billing,
    admin: deps.admin,
    mode: deps.accessMode,
    subscriptionStars: deps.subscriptionStars,
  };

  const imageControls = new Map<string, ImageControl>();
  const threadReferenceImages = new Map<string, string[]>();
  const mediaGroups = new Map<string, MediaGroupEntry>();

  // Runs before access checks and handlers: completed updates are durable, so
  // a restart or duplicate delivery cannot execute commands twice.
  bot.use((ctx, next) => deps.reliability.processUpdate(ctx.update.update_id, ctx.chat?.id, next));

  const mention = createMentionHelpers(bot);
  const conversation = createConversationHelpers(bot, deps);
  const media = createMediaHelpers({
    deps,
    downloadTelegramFile: conversation.downloadTelegramFile,
  });

  const generateImageTool = createGenerateImageTool({
    bot,
    deps,
    threadReferenceImages,
    imageControls,
    storeConversation: conversation.storeConversation,
  });

  const browserScreenshotTool = createBrowserScreenshotTool({
    bot,
    deps,
    access,
    storeConversation: conversation.storeConversation,
  });

  const runImageEditCommand = createRunImageEditCommand({
    deps,
    imageControls,
    storeConversation: conversation.storeConversation,
  });

  bot.catch((err) => log.error(serializeError(err), "Unhandled bot error"));

  const baseBuiltinTools = [
    ...contributions.tools,
    generateImageTool,
    ...(browserScreenshotTool ? [browserScreenshotTool] : []),
  ];

  const allCommands = buildTelegramCommands({
    deps,
    contributions,
    imageControls,
    storeConversation: conversation.storeConversation,
    getBuiltinTools: () => baseBuiltinTools,
  });

  // Advertise commands once.
  void bot.api.setMyCommands(
    allCommands
      .filter((c) => c.advertise !== false)
      .map((c) => ({ command: c.name, description: c.description }))
      .filter(uniqByCommand)
  );

  // --- Access gate ---
  const PUBLIC_COMMANDS = new Set(allCommands.filter((c) => c.public).map((c) => c.name));
  const OUR_COMMANDS = new Set(allCommands.map((c) => c.name));
  const isDirectedAtBot = mention.isDirectedAtBot;

  bot.use(async (ctx: GrammyContext, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();

    // Payment & callback flows bypass the access gate — Telegram deliveries we
    // must always honor (pre-checkout ack, successful-payment crediting) or
    // handle ourselves (inline keyboard callbacks).
    if (ctx.preCheckoutQuery) return next();
    if (ctx.callbackQuery) return next();
    if (ctx.message && "successful_payment" in ctx.message && ctx.message.successful_payment) {
      return next();
    }
    // Channel posts have no human author and are only captured (no reply),
    // so the access gate doesn't apply. Contributed handlers store them.
    if (ctx.channelPost || ctx.editedChannelPost) return next();

    const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    const meUsername = ctx.me?.username ?? "";
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";

    const cmdMatch = text.match(/^\/(\w+)(?:@(\S+))?/);
    const isOurCommand = cmdMatch
      ? OUR_COMMANDS.has(cmdMatch[1]) && (!cmdMatch[2] || cmdMatch[2] === meUsername)
      : false;

    // In groups, ignore commands addressed to other bots entirely.
    if (isGroup && cmdMatch && !isOurCommand) return;

    if (isOurCommand && PUBLIC_COMMANDS.has(cmdMatch![1])) return next();

    const decision = checkAccess(access, chatId, ctx.from?.id);
    if (!decision.ok) {
      const directed = isDirectedAtBot(ctx);
      if (directed) await sendRichReply(ctx, decision.message);
      return;
    }
    return next();
  });

  registerGroupLogging(bot, deps, mention, conversation);

  // --- Register commands collected via contributions + telegram-owned ---
  for (const cmd of allCommands) {
    bot.command(cmd.name, async (ctx) => {
      const tenant = tenantFromGrammy(ctx);
      await cmd.handler(ctx, tenant);
    });
  }

  // --- Register generic contributions (callback_query handlers etc.) ---
  for (const h of [...contributions.telegramHandlers].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100)
  )) {
    const selectors = Array.isArray(h.on) ? h.on : [h.on];
    for (const sel of selectors) {
      bot.on(sel as never, async (ctx, next) => {
        const tenant = tenantFromGrammy(ctx);
        await h.handler(ctx, tenant, next);
      });
    }
  }

  const runLlmReply = createRunLlmReply({
    deps,
    access,
    baseBuiltinTools,
    threadReferenceImages,
    collectReplyMedia: media.collectReplyMedia,
    storeConversation: conversation.storeConversation,
    contextFor: conversation.contextFor,
    withBillingLock: conversation.withBillingLock,
  });

  registerMessageHandlers({
    bot,
    deps,
    mediaGroups,
    threadReferenceImages,
    mention,
    conversation,
    media,
    runLlmReply,
    runImageEditCommand,
  });

  registerImageControlCallbacks({
    bot,
    deps,
    access,
    imageControls,
    enqueue: conversation.enqueue,
    storeConversation: conversation.storeConversation,
  });

  registerReminderDelivery({
    bot,
    deps,
    access,
    conversation,
  });
}
