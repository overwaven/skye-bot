import type { SkyeModule, TelegramHandler } from "../../core/module.js";
import { channelConfigSchema, resolveChannelChatId } from "./config.js";
import { migrations } from "./migrations.js";
import { channelService, type ChannelService } from "./service.js";
import { channelTools } from "./tools.js";
import { log } from "../../utils/log.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    channel: ChannelService;
  }
}

export const channelModule: SkyeModule = {
  name: "channel",
  configSchema: channelConfigSchema,
  migrations,
  init(ctx) {
    ctx.services.set("channel", channelService);
    const c = ctx.config.channel;

    if (c.enabled && !c.chat_id.trim()) {
      log.warn("Channel module is enabled but channel.chat_id is empty — set it in config.yaml");
    }

    const channelChatId = resolveChannelChatId(c.chat_id);

    const captureHandlers: TelegramHandler[] = c.enabled
      ? [
          {
            on: ["channel_post", "edited_channel_post"],
            order: 60,
            handler: (_ctx, _tenant, next) => {
              try {
                channelService.capture(_ctx);
              } catch (e) {
                log.warn({ err: e }, "Failed to capture channel post");
              }
              return next();
            },
          },
        ]
      : [];

    const tools = c.enabled
      ? channelTools({
          service: channelService,
          admin: ctx.services.get("admin"),
          getBot: () =>
            ctx.services.has("telegramBot") ? ctx.services.get("telegramBot") : undefined,
          getChatId: () => channelChatId,
          adminOnly: c.admin_only,
          enabled: c.enabled,
        })
      : [];

    return {
      service: channelService,
      tools,
      telegramHandlers: captureHandlers,
    };
  },
};
