import type { Bot, Context as GrammyContext } from "grammy";

const MENTION_RE = /(^|[^\p{L}\p{N}_])(skye|скай)(?=[^\p{L}\p{N}_]|$)/iu;

export function createMentionHelpers(bot: Bot) {
  const botUserId = () => bot.botInfo.id;
  const botUsername = () => bot.botInfo.username?.toLowerCase() ?? "";

  function isMentioned(ctx: GrammyContext): boolean {
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";
    if (!text) return false;
    if (MENTION_RE.test(text)) return true;
    const uname = botUsername();
    if (uname && text.toLowerCase().includes(`@${uname}`)) return true;
    return false;
  }

  function isReplyToBot(ctx: GrammyContext): boolean {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    return reply?.from?.id === botUserId();
  }

  function isDirectedAtBot(ctx: GrammyContext): boolean {
    const isPM = ctx.chat?.type === "private";
    if (isPM) return true;
    return isMentioned(ctx) || isReplyToBot(ctx);
  }

  return { isMentioned, isReplyToBot, isDirectedAtBot };
}

export type MentionHelpers = ReturnType<typeof createMentionHelpers>;
