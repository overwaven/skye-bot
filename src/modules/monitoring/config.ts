import { z } from "zod";
import { section } from "../../core/config.js";

const emptyToUndefined = z.preprocess((v) => (v ? v : undefined), z.string().min(1).optional());

export const monitoringConfigSchema = z.object({
  monitoring: section({
    out_log: emptyToUndefined,
    error_log: emptyToUndefined,
  }),
});

export type MonitoringConfig = z.infer<typeof monitoringConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    monitoring: {
      out_log?: string;
      error_log?: string;
    };
  }
}
