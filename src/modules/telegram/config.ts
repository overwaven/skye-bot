import { z } from "zod";

export const telegramConfigSchema = z.object({
  bot_token: z.string().min(1, "bot_token is required"),
  allowed_ids: z.string().default(""),
  telegram_polling_lock: z.string().default("1"),
  telegram_drop_pending_updates: z.enum(["0", "1"]).default("0"),
  telegram_job_timeout_ms: z
    .number()
    .int()
    .min(10_000)
    .max(15 * 60_000)
    .default(3 * 60_000),
  telegram_max_concurrent_jobs: z.number().int().min(2).max(500).default(64),
  telegram_max_attachment_bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(25 * 1024 * 1024),
});

export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    bot_token: string;
    allowed_ids: string;
    telegram_polling_lock: string;
    telegram_drop_pending_updates: "0" | "1";
    telegram_job_timeout_ms: number;
    telegram_max_concurrent_jobs: number;
    telegram_max_attachment_bytes: number;
  }
}

export function parseAllowedIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
  );
}
