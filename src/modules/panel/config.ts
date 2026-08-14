import { z } from "zod";
import { section } from "../../core/config.js";

const panelUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  }, "panel.webapp_url must use HTTPS unless it points to localhost");

export const panelConfigSchema = z.object({
  panel: section({
    webapp_url: panelUrl.default("http://localhost:3001"),
    webapp_port: z.number().int().positive().default(3001),
    auth_max_age_seconds: z.number().int().min(60).max(86_400).default(86_400),
    rate_limit_window_ms: z.number().int().min(1_000).max(3_600_000).default(60_000),
    rate_limit_max: z.number().int().min(10).max(10_000).default(120),
    json_body_limit_kb: z.number().int().min(64).max(10_240).default(3_072),
  }),
});

export type PanelConfig = z.infer<typeof panelConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    panel: {
      webapp_url: string;
      webapp_port: number;
      auth_max_age_seconds: number;
      rate_limit_window_ms: number;
      rate_limit_max: number;
      json_body_limit_kb: number;
    };
  }
}
