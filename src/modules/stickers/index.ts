import type { SkyeModule } from "../../core/module.js";
import { sendRichReply } from "../telegram/helpers.js";
import { migrations } from "./migrations.js";
import { SEED_STICKERS } from "./seed.js";
import { stickersService, type StickersService } from "./service.js";
import { formatStickerCatalog, stickerCatalogTools } from "./tools.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    stickers: StickersService;
  }
}

export const stickersModule: SkyeModule = {
  name: "stickers",
  migrations,
  init(ctx) {
    ctx.services.set("stickers", stickersService);
    return {
      service: stickersService,
      tools: stickerCatalogTools(stickersService),
      commands: [
        {
          name: "stickers",
          description: "List stickers saved for this chat",
          handler: async (ctx, tenant) => {
            const stickers = stickersService.list(tenant.chatId);
            if (stickers.length === 0) {
              await sendRichReply(
                ctx,
                [
                  "_No stickers saved for this chat yet._",
                  "",
                  "Use `/stickers_teach` — send a sticker, then its description. Or `/stickers_seed` to learn the default pack one by one.",
                ].join("\n")
              );
              return;
            }
            const rows = stickers.map((s) => {
              const desc = s.description.replace(/\|/g, "\\|").slice(0, 60);
              const emoji = s.emoji ?? "";
              return `| \`${s.id.slice(0, 8)}…\` | ${emoji} | ${desc} |`;
            });
            await sendRichReply(
              ctx,
              [
                `## Stickers (${stickers.length})`,
                "",
                "| ID | Emoji | Description |",
                "|---|---|---|",
                ...rows,
                "",
                "_Teach more with /stickers_teach · seed pack /stickers_seed · clear /stickers_clear_",
              ].join("\n")
            );
          },
        },
        {
          name: "stickers_teach",
          description: "Toggle sticker teach mode for this chat",
          handler: async (ctx, tenant) => {
            const state = stickersService.getTeachState(tenant.chatId);
            if (state.enabled) {
              stickersService.disableTeach(tenant.chatId);
              await sendRichReply(ctx, "🎓 **Teach mode off.**");
              return;
            }
            stickersService.startTeach(tenant.chatId);
            await sendRichReply(
              ctx,
              [
                "🎓 **Teach mode on.**",
                "",
                "1. Send me a sticker (in groups: mention me or reply).",
                "2. Then reply with a short description of when I should use it.",
                "",
                "Send `/stickers_teach` again to stop.",
              ].join("\n")
            );
          },
        },
        {
          name: "stickers_seed",
          description: "Teach the default sticker pack one by one",
          handler: async (ctx, tenant) => {
            const { next } = stickersService.startSeedTeach(tenant.chatId);
            if (!next) {
              await sendRichReply(
                ctx,
                `All ${SEED_STICKERS.length} seed stickers are already saved in this chat. Use /stickers to list them.`
              );
              return;
            }
            const remaining =
              SEED_STICKERS.length - stickersService.list(tenant.chatId).filter((s) =>
                SEED_STICKERS.some((seed) => seed.id === s.id)
              ).length;
            await sendRichReply(
              ctx,
              [
                "🌱 **Seed teach mode.**",
                "",
                `Send sticker **1 / ${remaining}** for:`,
                "",
                `_${next.description}_`,
                "",
                `\`id: ${next.id}\``,
                "",
                "I’ll bind that Telegram sticker to this description. Continue until the pack is complete, or `/stickers_teach` to cancel.",
              ].join("\n")
            );
          },
        },
        {
          name: "stickers_clear",
          description: "Clear all stickers saved for this chat",
          handler: async (ctx, tenant) => {
            const n = stickersService.clear(tenant.chatId);
            stickersService.disableTeach(tenant.chatId);
            await sendRichReply(
              ctx,
              n > 0 ? `🧹 Removed **${n}** sticker(s) from this chat.` : "_Nothing to clear._"
            );
          },
        },
      ],
    };
  },
};

export { stickersService, formatStickerCatalog };
export type { StickersService, ChatSticker } from "./service.js";
export { createSendStickerTool, type PreparedStickerMessage } from "./tools.js";
export {
  resolveVisualMedia,
  visualSourceFromMessage,
  downloadVisionDataUrl,
} from "./media.js";
export { SEED_STICKERS } from "./seed.js";
