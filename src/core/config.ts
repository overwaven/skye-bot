import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { load as parseYaml } from "js-yaml";
import {
  z,
  type ZodObject,
  type ZodRawShape,
  type ZodPreprocess,
} from "zod";
import type { SkyeModule } from "./module.js";

/**
 * Wrap a nested object schema so that a missing/undefined section is treated
 * as `{}` — letting per-field `.default()` values fill in. Zod v4's
 * `.default({})` doesn't re-parse the substituted value, so this preprocess
 * is the reliable way to get nested defaults.
 */
export function section<T extends ZodRawShape>(
  shape: T
): ZodPreprocess<ZodObject<T>> {
  return z.preprocess((v) => v ?? {}, z.object(shape));
}

/**
 * Root config object. Each module augments this via `declare module` to add
 * its own typed section:
 *
 *   declare module "../../core/config.js" {
 *     interface SkyeConfig {
 *       voice: VoiceConfig;
 *     }
 *   }
 */
export interface SkyeConfig {
  [key: string]: unknown;
}

let cachedConfig: SkyeConfig | null = null;
let runtimeSchema: ZodObject<ZodRawShape> | null = null;

/**
 * Compose the root Zod schema from every module's `configSchema`, plus the
 * core section (db_path, log_level). Returns a single ZodObject that mirrors
 * the YAML structure 1:1.
 */
export function composeSchema(modules: readonly SkyeModule[]): ZodObject<ZodRawShape> {
  let shape: ZodRawShape = {
    db_path: z.string().default("data/skye.db"),
    log_level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  };
  for (const mod of modules) {
    if (!mod.configSchema) continue;
    shape = { ...shape, ...(mod.configSchema as ZodObject<ZodRawShape>).shape };
  }
  return z.object(shape);
}

/** Schema used at boot — available to runtime validation (panel config editor). */
export function getRuntimeConfigSchema(): ZodObject<ZodRawShape> | null {
  return runtimeSchema;
}

/**
 * Load, parse, and validate `config.yaml` against the composed module schemas.
 * Returns a typed, frozen `SkyeConfig`. Throws on missing file or schema errors.
 */
export function loadConfig(modules: readonly SkyeModule[]): SkyeConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = process.env.SKYE_CONFIG ?? join(process.cwd(), "config.yaml");

  if (!existsSync(configPath)) {
    throw new Error(
      `No config.yaml found at ${configPath}. Copy config.example.yaml to config.yaml and fill in your values.`
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(configPath, "utf-8"));
  } catch (e) {
    throw new Error(`Failed to parse YAML at ${configPath}: ${e instanceof Error ? e.message : e}`);
  }

  const schema = composeSchema(modules);
  runtimeSchema = schema;
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config.yaml:\n${issues}`);
  }

  cachedConfig = Object.freeze(result.data) as SkyeConfig;
  console.info(`[skye] Configuration loaded from ${configPath}`);
  return cachedConfig;
}

/** For tests: reset the cache so the next `loadConfig` re-parses. */
export function resetConfigCache(): void {
  cachedConfig = null;
  runtimeSchema = null;
}