import { z } from "zod";
import { section } from "../../core/config.js";

export const proactiveConfigSchema = z.object({
  proactive: section({
    enabled: z.boolean().default(true),
    probability: z.number().min(0).max(1).default(0.06),
    warmup: z.number().int().min(0).default(8),
    min_interval_sec: z.number().int().min(0).default(180),
    context_size: z.number().int().min(2).max(60).default(20),
  }),
});

export type ProactiveConfig = z.infer<typeof proactiveConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    proactive: {
      enabled: boolean;
      probability: number;
      warmup: number;
      min_interval_sec: number;
      context_size: number;
    };
  }
}
