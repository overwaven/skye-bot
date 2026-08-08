import type { SkyeModule } from "../../core/module.js";
import { migrations } from "./migrations.js";
import { buildRoutes } from "./routes.js";
import { sendRichReply } from "../telegram/helpers.js";
import {
  chatConfigService,
  getChatConfig,
  getChatThreadPrompt,
  resetChatThreadPrompt,
  setChatThreadPrompt,
  setChatVoiceReplyMode,
  type ChatConfigService,
  type VoiceReplyMode,
} from "./service.js";

export const MAX_CHAT_PROMPT_CHARS = 16_000;

function scopeLabel(threadId?: number): string {
  return threadId == null ? "this chat" : "this topic";
}

const VOICE_MODES: VoiceReplyMode[] = ["text", "auto", "always"];

const VOICE_MODE_MESSAGES: Record<VoiceReplyMode, string> = {
  text: "📝 **Voice replies: TEXT**\n\n_Skye replies in text unless you explicitly ask for audio._",
  auto: "✨ **Voice replies: AUTO**\n\n_Skye may use a voice note when vocal delivery adds something useful._",
  always: "🎙 **Voice replies: ALWAYS**\n\n_Regular responses will be sent as voice notes._",
};

declare module "../../core/module.js" {
  interface SkyeServices {
    chatConfig: ChatConfigService;
  }
}

export const chatConfigModule: SkyeModule = {
  name: "chatConfig",
  migrations,
  init(ctx) {
    ctx.services.set("chatConfig", chatConfigService);
    return {
      service: chatConfigService,
      panelRoutes: buildRoutes(ctx),
      commands: [
        {
          name: "voice",
          description: "Change voice reply mode",
          public: true,
          handler: async (ctx, tenant) => {
            const cfg = getChatConfig(tenant.chatId);
            const requested = ctx.match?.toString().trim().toLowerCase();
            const requestedMode = VOICE_MODES.find((mode) => mode === requested);
            if (requested && !requestedMode) {
              await sendRichReply(
                ctx,
                `Unknown voice mode \`${requested}\`. Use /voice text, /voice auto, or /voice always.\n\n_Current mode: **${cfg.voiceReplyMode.toUpperCase()}**._`
              );
              return;
            }
            const currentIndex = VOICE_MODES.indexOf(cfg.voiceReplyMode);
            const nextMode = requestedMode ?? VOICE_MODES[(currentIndex + 1) % VOICE_MODES.length];
            setChatVoiceReplyMode(tenant.chatId, nextMode);
            await sendRichReply(
              ctx,
              `${VOICE_MODE_MESSAGES[nextMode]}\n\n_Use /voice text, /voice auto, or /voice always to choose directly._`
            );
          },
        },
        {
          name: "set_prompt",
          description: "Set a custom prompt for this chat or topic",
          handler: async (ctx, tenant) => {
            const prompt = ctx.match?.toString().trim() ?? "";
            if (!prompt) {
              await sendRichReply(
                ctx,
                `Add the custom prompt after the command, for example:\n\n\`/set_prompt You are a concise coding mentor.\``
              );
              return;
            }
            if (prompt.length > MAX_CHAT_PROMPT_CHARS) {
              await sendRichReply(
                ctx,
                `The custom prompt must be at most ${MAX_CHAT_PROMPT_CHARS.toLocaleString("en-US")} characters.`
              );
              return;
            }
            setChatThreadPrompt(tenant.chatId, tenant.threadId, prompt);
            await sendRichReply(
              ctx,
              `Additional instructions set for ${scopeLabel(tenant.threadId)}. They apply on top of the active agent.`
            );
          },
        },
        {
          name: "get_prompt",
          description: "Show the custom prompt for this chat or topic",
          handler: async (ctx, tenant) => {
            const prompt = getChatThreadPrompt(tenant.chatId, tenant.threadId);
            if (!prompt) {
              await sendRichReply(
                ctx,
                `No additional instructions are set for ${scopeLabel(tenant.threadId)}. The active agent (or Default Skye) is used as-is.`
              );
              return;
            }
            await ctx.reply(prompt, {
              message_thread_id: tenant.threadId,
              reply_to_message_id: ctx.message?.message_id,
            });
          },
        },
        {
          name: "reset_prompt",
          description: "Reset the custom prompt for this chat or topic",
          handler: async (ctx, tenant) => {
            const removed = resetChatThreadPrompt(tenant.chatId, tenant.threadId);
            await sendRichReply(
              ctx,
              removed
                ? `Additional instructions cleared for ${scopeLabel(tenant.threadId)}.`
                : `No additional instructions were set for ${scopeLabel(tenant.threadId)}.`
            );
          },
        },
      ],
    };
  },
};
