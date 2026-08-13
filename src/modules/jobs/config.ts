import { z } from "zod";
import { section } from "../../core/config.js";

export const jobsConfigSchema = z.object({
  background_jobs: section({
    enabled: z.boolean().default(true),
    poll_interval_ms: z.number().int().min(100).max(60_000).default(1000),
    lease_sec: z.number().int().min(30).max(3600).default(300),
    retention_days: z.number().int().min(1).max(365).default(7),
  }),
});

export type JobsConfig = z.infer<typeof jobsConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    background_jobs: {
      enabled: boolean;
      poll_interval_ms: number;
      lease_sec: number;
      retention_days: number;
    };
  }
}
