import { z } from "zod";
import { section } from "../../core/config.js";

export const channelConfigSchema = z.object({
  channel: section({
    enabled: z.boolean().default(false),
    // Accepts either a public @username (string) or a numeric channel id.
    // YAML parses unquoted numbers as numbers, so accept both and coerce.
    chat_id: z.union([z.string(), z.number()]).transform(String).default(""),
    admin_only: z.boolean().default(true),
  }),
});

export type ChannelConfig = z.infer<typeof channelConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    channel: {
      enabled: boolean;
      chat_id: string;
      admin_only: boolean;
    };
  }
}

export function resolveChannelChatId(raw: string): number | string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
