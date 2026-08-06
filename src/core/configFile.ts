import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { basename, dirname, join } from "path";
import { load as parseYaml } from "js-yaml";
import type { ZodObject, ZodRawShape } from "zod";
import type { SkyeModule } from "./module.js";
import { composeSchema, getRuntimeConfigSchema } from "./config.js";

/** Maximum accepted config body size (512 KiB). */
export const MAX_CONFIG_BYTES = 512 * 1024;

export interface ConfigSourceMeta {
  /** Absolute path on disk. */
  path: string;
  /** Basename for display (e.g. config.yaml). */
  name: string;
  size: number;
  mtimeMs: number;
  /** SHA-256 of the UTF-8 content; used for optimistic concurrency. */
  etag: string;
  byteLength: number;
}

export interface ConfigSource extends ConfigSourceMeta {
  content: string;
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export type ConfigValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; issues: ConfigIssue[]; warnings: string[] };

/** Resolve the active config path (same rules as loadConfig). */
export function getConfigPath(): string {
  return process.env.SKYE_CONFIG ?? join(process.cwd(), "config.yaml");
}

export function contentEtag(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function ensureSchema(modules?: readonly SkyeModule[]): ZodObject<ZodRawShape> {
  const remembered = getRuntimeConfigSchema();
  if (remembered) return remembered;
  if (modules) return composeSchema(modules);
  throw new Error("Config schema is not ready");
}

export function readConfigSource(): ConfigSource {
  const path = getConfigPath();
  if (!existsSync(path)) {
    throw Object.assign(new Error(`Config file not found at ${path}`), { status: 404 });
  }
  const content = readFileSync(path, "utf8");
  const stats = statSync(path);
  return {
    path,
    name: basename(path),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    etag: contentEtag(content),
    byteLength: Buffer.byteLength(content, "utf8"),
    content,
  };
}

/**
 * Validate YAML text against the composed module schemas plus a few
 * cross-field checks that mirror scripts/validate-config.ts.
 */
export function validateConfigYaml(
  yamlText: string,
  modules?: readonly SkyeModule[]
): ConfigValidation {
  const byteLength = Buffer.byteLength(yamlText, "utf8");
  if (byteLength === 0) {
    return {
      ok: false,
      issues: [{ path: "(root)", message: "Config cannot be empty" }],
      warnings: [],
    };
  }
  if (byteLength > MAX_CONFIG_BYTES) {
    return {
      ok: false,
      issues: [
        {
          path: "(root)",
          message: `Config exceeds the ${MAX_CONFIG_BYTES} byte limit`,
        },
      ],
      warnings: [],
    };
  }

  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    return {
      ok: false,
      issues: [
        {
          path: "(yaml)",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
      warnings: [],
    };
  }

  if (raw === null || raw === undefined) {
    return {
      ok: false,
      issues: [{ path: "(root)", message: "Config cannot be empty" }],
      warnings: [],
    };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [{ path: "(root)", message: "Config root must be a YAML mapping" }],
      warnings: [],
    };
  }

  const schema = ensureSchema(modules);
  const result = schema.safeParse(raw);
  const warnings: string[] = [];
  const issues: ConfigIssue[] = [];

  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      });
    }
  }

  const cfg = (result.success ? result.data : raw) as {
    models?: Array<{ provider?: string }>;
    perplexity_api_key?: string;
    xai_api_key?: string;
    image?: { provider?: string; api_key?: string };
    voice?: {
      provider: string;
      yc_api_key: string;
      xai?: { api_key?: string };
    };
    access?: { mode: string };
    billing?: { enabled: boolean };
    owner?: { user_id: number };
  };

  const perplexityUsed = cfg.models?.some((m) => m.provider === "perplexity") ?? false;
  if (perplexityUsed && !cfg.perplexity_api_key) {
    issues.push({
      path: "perplexity_api_key",
      message: 'A model uses provider: "perplexity" but perplexity_api_key is unset',
    });
  }

  const xaiChatUsed = cfg.models?.some((m) => m.provider === "xai") ?? false;
  if (xaiChatUsed && !cfg.xai_api_key) {
    issues.push({
      path: "xai_api_key",
      message: 'A model uses provider: "xai" but xai_api_key is unset',
    });
  }

  if (cfg.image?.provider === "xai" && !cfg.image.api_key && !cfg.xai_api_key) {
    issues.push({
      path: "image.api_key",
      message: 'image.provider is "xai" but neither image.api_key nor xai_api_key is set',
    });
  }

  if (cfg.access?.mode === "subscription" && !cfg.billing?.enabled) {
    issues.push({
      path: "access.mode",
      message: "access.mode=subscription requires billing.enabled=true",
    });
  }

  if (cfg.voice?.provider === "yandex" && !cfg.voice.yc_api_key) {
    warnings.push("voice.provider=yandex but voice.yc_api_key is unset");
  }

  if (
    cfg.voice?.provider === "xai" &&
    !cfg.voice.xai?.api_key &&
    !cfg.xai_api_key
  ) {
    warnings.push("voice.provider=xai but voice.xai.api_key and xai_api_key are unset");
  }

  if (!cfg.owner?.user_id) {
    warnings.push(
      "owner.user_id is unset; first run will require the one-time /claim_owner token from logs"
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues, warnings };
  }
  return { ok: true, warnings };
}

export interface WriteConfigOptions {
  content: string;
  /** Expected etag of the file currently on disk; rejects concurrent edits. */
  etag: string;
  modules?: readonly SkyeModule[];
}

export interface WriteConfigResult {
  source: ConfigSource;
  warnings: string[];
  backupPath: string | null;
}

/**
 * Validate, back up the previous file, and atomically replace config.yaml.
 * Does not mutate the in-memory frozen config — a process restart is required.
 */
export function writeConfigSource(options: WriteConfigOptions): WriteConfigResult {
  const validation = validateConfigYaml(options.content, options.modules);
  if (!validation.ok) {
    const detail = validation.issues
      .map((i) => `${i.path}: ${i.message}`)
      .join("; ");
    throw Object.assign(new Error(`Invalid configuration: ${detail}`), {
      status: 400,
      issues: validation.issues,
      warnings: validation.warnings,
    });
  }

  const path = getConfigPath();
  if (!existsSync(path)) {
    throw Object.assign(new Error(`Config file not found at ${path}`), { status: 404 });
  }

  const current = readConfigSource();
  if (current.etag !== options.etag) {
    throw Object.assign(
      new Error(
        "Config changed on disk since you loaded it. Reload and re-apply your edits."
      ),
      { status: 409 }
    );
  }

  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const backupPath = `${path}.bak`;
  try {
    copyFileSync(path, backupPath);
  } catch {
    // Backup is best-effort; still proceed with atomic write.
  }

  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmpPath, options.content, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, path);
  } catch (e) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw e;
  }

  return {
    source: readConfigSource(),
    warnings: validation.warnings,
    backupPath: existsSync(backupPath) ? backupPath : null,
  };
}

/** List top-level YAML keys for editor navigation (best-effort, line-based). */
export function listTopLevelKeys(yamlText: string): Array<{ key: string; line: number }> {
  const keys: Array<{ key: string; line: number }> = [];
  const lines = yamlText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match unindented keys: `name:` or `"name":` — skip list items and comments.
    const match = /^(?:([A-Za-z_][\w.-]*)|"([^"]+)"|'([^']+)')\s*:/.exec(line);
    if (!match) continue;
    const key = match[1] ?? match[2] ?? match[3];
    if (key) keys.push({ key, line: i + 1 });
  }
  return keys;
}
