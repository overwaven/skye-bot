import { z } from "zod";
import { section } from "../../core/config.js";

const emptyToUndefined = z.preprocess((v) => (v ? v : undefined), z.string().min(1).optional());
const emptyUrlToUndefined = z.preprocess((v) => (v ? v : undefined), z.string().url().optional());

export const sandboxConfigSchema = z.object({
  sandbox: section({
    enabled: z.boolean().default(true),
    image: z.string().min(1).default("node:24-bookworm"),
    snapshot: emptyToUndefined,
    cpu: z.number().int().positive().max(4).default(1),
    memory_gib: z.number().int().positive().max(8).default(1),
    disk_gib: z.number().int().positive().max(10).default(3),
    auto_stop_minutes: z.number().int().nonnegative().default(15),
    auto_archive_minutes: z.number().int().nonnegative().default(10_080),
    persistent: z.boolean().default(false),
    command_timeout_ms: z.number().int().positive().default(60_000),
    max_output_chars: z.number().int().positive().max(1_000_000).default(64_000),
    max_file_bytes: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024)
      .default(1_000_000),
    daytona_api_key: emptyToUndefined,
    daytona_api_url: emptyUrlToUndefined,
    daytona_target: emptyToUndefined,
  }),
});

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    sandbox: {
      enabled: boolean;
      image: string;
      snapshot?: string;
      cpu: number;
      memory_gib: number;
      disk_gib: number;
      auto_stop_minutes: number;
      auto_archive_minutes: number;
      persistent: boolean;
      command_timeout_ms: number;
      max_output_chars: number;
      max_file_bytes: number;
      daytona_api_key?: string;
      daytona_api_url?: string;
      daytona_target?: string;
    };
  }
}
