import { z } from "zod";
import { section } from "../../core/config.js";

const emptyToUndefined = z.preprocess((value) => (value ? value : undefined), z.string().optional());

export const browserConfigSchema = z.object({
  browser: section({
    enabled: z.boolean().default(false),
    worker_url: z.string().url().default("http://browser-worker:8765"),
    worker_token: emptyToUndefined,
    request_timeout_ms: z.number().int().positive().max(900_000).default(300_000),
    max_output_chars: z.number().int().positive().max(200_000).default(20_000),
    max_screenshot_bytes: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    max_agent_steps: z.number().int().positive().max(100).default(25),
    viewport_width: z.number().int().min(800).max(2560).default(1440),
    viewport_height: z.number().int().min(600).max(1600).default(900),
    allowed_domains: z.array(z.string().min(1)).default([]),
    prohibited_domains: z
      .array(z.string().min(1))
      .default([
        "localhost",
        "127.0.0.1",
        "::1",
        "169.254.169.254",
        "host.docker.internal",
        "*.localhost",
        "*.local",
        "*.internal",
        "metadata.google.internal",
        "browser-worker",
        "skye-bot",
      ]),
    agent_model: emptyToUndefined,
    agent_api_key: emptyToUndefined,
    agent_base_url: z.preprocess(
      (value) => (value ? value : undefined),
      z.string().url().optional()
    ),
  }),
});

export type BrowserConfig = z.infer<typeof browserConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    browser: BrowserConfig["browser"];
  }
}
