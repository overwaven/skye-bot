import Database from "better-sqlite3";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, resolve } from "path";
import { dump, load } from "js-yaml";
import { decryptProviderSecret } from "../src/modules/providers/secrets.js";

type ProviderRow = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  apiKeyEnc: string;
  enabled: number;
};

type ModelRow = {
  id: string;
  providerId: string;
  name: string;
  model: string;
  capabilities: string;
  contextWindow: number;
  multiplier: number;
  enabled: number;
  config: string;
};

type RoutingRow = {
  text: string | null;
  imageGeneration: string | null;
  imageEdit: string | null;
  tts: string | null;
  stt: string | null;
  voice: string | null;
};

const configPath = resolve(process.env.SKYE_CONFIG ?? "config.yaml");
const config = load(readFileSync(configPath, "utf8")) as Record<string, unknown>;
if (config.ai) throw new Error("config.yaml already contains an ai section");

const dbPath = resolve(process.cwd(), String(config.db_path ?? "data/skye.db"));
const db = new Database(dbPath, { readonly: true });
const providers = db
  .prepare(
    `SELECT id, name, kind, base_url AS baseUrl, api_key_enc AS apiKeyEnc, enabled
     FROM ai_providers ORDER BY created_at, name`
  )
  .all() as ProviderRow[];
const models = db
  .prepare(
    `SELECT id, provider_id AS providerId, name, upstream_id AS model, capabilities,
            context_window AS contextWindow, multiplier, enabled, config
     FROM ai_models ORDER BY created_at, name`
  )
  .all() as ModelRow[];
const defaults = db
  .prepare(
    `SELECT text_model_id AS text,
            image_generation_model_id AS imageGeneration,
            image_edit_model_id AS imageEdit,
            tts_model_id AS tts,
            stt_model_id AS stt,
            tts_voice AS voice
     FROM ai_routing_defaults WHERE singleton = 1`
  )
  .get() as RoutingRow | undefined;
db.close();

const referencedProviders = new Set(models.map((model) => model.providerId));
const providerIds = new Map<string, string>();
const usedIds = new Set<string>();
for (const provider of providers.filter((candidate) => referencedProviders.has(candidate.id))) {
  const preferred =
    provider.kind === "perplexity"
      ? "perplexity"
      : provider.id === "legacy-xai"
        ? "xai"
        : provider.id === "legacy-image"
          ? "image"
          : provider.id === "legacy-primary"
            ? "primary"
            : provider.id;
  const id = usedIds.has(preferred) ? provider.id : preferred;
  providerIds.set(provider.id, id);
  usedIds.add(id);
}

config.ai = {
  providers: providers
    .filter((provider) => providerIds.has(provider.id))
    .map((provider) => ({
      id: providerIds.get(provider.id),
      name: provider.name,
      kind: provider.kind,
      base_url: provider.baseUrl,
      api_key: decryptProviderSecret(provider.apiKeyEnc, String(config.bot_token ?? "")),
      enabled: provider.enabled === 1,
    })),
  models: models.map((model) => {
    const runtime = JSON.parse(model.config) as Record<string, unknown>;
    return compact({
      id: model.id,
      provider: providerIds.get(model.providerId) ?? model.providerId,
      name: model.name,
      model: model.model,
      capabilities: JSON.parse(model.capabilities),
      context_window: model.contextWindow,
      multiplier: model.multiplier,
      enabled: model.enabled === 1,
      api_mode: runtime.apiMode,
      builtin_tools: runtime.builtinTools,
      preset: runtime.preset,
      aspect_ratio: runtime.aspectRatio,
      resolution: runtime.resolution,
      voice: runtime.voice,
      voices: runtime.voices,
      language: runtime.language,
      audio_format: runtime.audioFormat,
      expressive: runtime.expressive,
      pcm_sample_rate: runtime.pcmSampleRate,
      pcm_channels: runtime.pcmChannels,
    });
  }),
  defaults: {
    text: defaults?.text ?? "",
    image: defaults?.imageGeneration ?? defaults?.imageEdit ?? "",
    tts: defaults?.tts ?? "",
    stt: defaults?.stt ?? "",
    voice: defaults?.voice ?? "",
  },
};

const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const backupDir = resolve(dirname(configPath), "data", "config-backups");
const backupPath = resolve(backupDir, `${basename(configPath)}.pre-ai-${timestamp}.bak`);
const tempPath = resolve(dirname(configPath), `.config-ai-${process.pid}.tmp`);
const mode = statSync(configPath).mode;
mkdirSync(backupDir, { recursive: true });
copyFileSync(configPath, backupPath);
writeFileSync(tempPath, dump(config, { noRefs: true, lineWidth: 100, quotingType: '"' }), "utf8");
chmodSync(tempPath, mode);
renameSync(tempPath, configPath);

console.info(
  `Migrated ${providerIds.size} providers and ${models.length} models; backup: ${backupPath}`
);

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
