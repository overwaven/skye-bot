import { z } from "zod";
import { section } from "../../core/config.js";

export const remindersConfigSchema = z.object({
  reminders: section({
    enabled: z.boolean().default(true),
    check_interval_sec: z.number().int().min(1).max(3600).default(30),
    grace_sec: z.number().int().min(0).max(86400).default(300),
  }),
});

export type RemindersConfig = z.infer<typeof remindersConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    reminders: {
      enabled: boolean;
      check_interval_sec: number;
      grace_sec: number;
    };
  }
}
