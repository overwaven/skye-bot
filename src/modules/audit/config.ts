import { z } from "zod";
import { section } from "../../core/config.js";

export const auditConfigSchema = z.object({
  audit: section({
    retention_days: z.number().int().positive().default(90),
    max_rows: z.number().int().positive().default(100_000),
  }),
});

export type AuditConfig = z.infer<typeof auditConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    audit: {
      retention_days: number;
      max_rows: number;
    };
  }
}
