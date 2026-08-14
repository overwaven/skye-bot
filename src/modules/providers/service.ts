import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { SkyeConfig } from "../../core/config.js";
import type { ModelEntry } from "../llm/config.js";
import type { AiProviderConfig } from "./config.js";
import { decryptProviderSecret, encryptProviderSecret } from "./secrets.js";
import { fetchPerplexityModels, probePerplexityProvider } from "./perplexity.js";
import {
  MODEL_CAPABILITIES,
  PROVIDER_KINDS,
  type AiModel,
  type AiModelConfig,
  type AiProvider,
  type AiRouting,
  type ModelCapability,
  type ProviderCredentials,
  type ProviderKind,
  type ResolvedAiModel,
  type RoutingCapability,
} from "./types.js";

type ProviderRow = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  apiKeyEnc: string;
  enabled: number;
  status: string;
  lastError: string | null;
  testedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ModelRow = {
  id: string;
  providerId: string;
  name: string;
  upstreamId: string;
  capabilities: string;
  contextWindow: number;
  multiplier: number;
  enabled: number;
  config: string;
  createdAt: string;
  updatedAt: string;
};

type RoutingRow = {
  textModelId: string | null;
  imageGenerationModelId: string | null;
  imageEditModelId: string | null;
  ttsModelId: string | null;
  sttModelId: string | null;
  ttsVoice: string | null;
};

export interface ProviderInput {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface ModelInput {
  name: string;
  upstreamId: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
  multiplier?: number;
  enabled?: boolean;
  config?: AiModelConfig;
}

export interface DiscoveredModel {
  upstreamId: string;
  name: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
}

const PROVIDER_SELECT = `
  SELECT id, name, kind, base_url AS baseUrl, api_key_enc AS apiKeyEnc,
         enabled, status, last_error AS lastError, tested_at AS testedAt,
         created_at AS createdAt, updated_at AS updatedAt
  FROM ai_providers`;

const MODEL_SELECT = `
  SELECT id, provider_id AS providerId, name, upstream_id AS upstreamId,
         capabilities, context_window AS contextWindow, multiplier, enabled,
         config, created_at AS createdAt, updated_at AS updatedAt
  FROM ai_models`;

const ROUTING_SELECT = `
  SELECT text_model_id AS textModelId,
         image_generation_model_id AS imageGenerationModelId,
         image_edit_model_id AS imageEditModelId,
         tts_model_id AS ttsModelId,
         stt_model_id AS sttModelId,
         tts_voice AS ttsVoice`;

function trimUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function providerFromRow(row: ProviderRow): AiProvider {
  return {
    id: row.id,
    name: row.name,
    kind: PROVIDER_KINDS.includes(row.kind as ProviderKind)
      ? (row.kind as ProviderKind)
      : "openai-compatible",
    baseUrl: row.baseUrl,
    enabled: row.enabled === 1,
    status:
      row.status === "ready" || row.status === "error" || row.status === "disabled"
        ? row.status
        : "untested",
    hasApiKey: Boolean(row.apiKeyEnc),
    lastError: row.lastError,
    testedAt: row.testedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function modelFromRow(row: ModelRow): AiModel {
  const parsedCapabilities = JSON.parse(row.capabilities) as unknown;
  const parsedConfig = JSON.parse(row.config) as unknown;
  return {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    upstreamId: row.upstreamId,
    capabilities: Array.isArray(parsedCapabilities)
      ? parsedCapabilities.filter((value): value is ModelCapability =>
          MODEL_CAPABILITIES.includes(value as ModelCapability)
        )
      : [],
    contextWindow: row.contextWindow,
    multiplier: row.multiplier,
    enabled: row.enabled === 1,
    config: parsedConfig && typeof parsedConfig === "object" ? (parsedConfig as AiModelConfig) : {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeCapabilities(values: ModelCapability[]): ModelCapability[] {
  return [...new Set(values)].filter((value) => MODEL_CAPABILITIES.includes(value));
}

function routingColumn(capability: RoutingCapability): string {
  return {
    text: "text_model_id",
    image_generation: "image_generation_model_id",
    image_edit: "image_edit_model_id",
    tts: "tts_model_id",
    stt: "stt_model_id",
  }[capability];
}

export class ProviderService {
  constructor(
    private readonly db: Database.Database,
    private readonly secretFallback: string
  ) {}

  hasProviders(): boolean {
    return (
      (this.db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM ai_providers").get()
        ?.count ?? 0) > 0
    );
  }

  listProviders(): AiProvider[] {
    const rows = this.db
      .prepare<[], ProviderRow>(`${PROVIDER_SELECT} ORDER BY created_at, name`)
      .all();
    return rows.map(providerFromRow);
  }

  getProvider(id: string): AiProvider | null {
    const row = this.db.prepare<[string], ProviderRow>(`${PROVIDER_SELECT} WHERE id = ?`).get(id);
    return row ? providerFromRow(row) : null;
  }

  getProviderCredentials(id: string): ProviderCredentials | null {
    const row = this.db.prepare<[string], ProviderRow>(`${PROVIDER_SELECT} WHERE id = ?`).get(id);
    if (!row) return null;
    let apiKey = "";
    try {
      apiKey = decryptProviderSecret(row.apiKeyEnc, this.secretFallback);
    } catch {
      apiKey = "";
    }
    return { ...providerFromRow(row), apiKey };
  }

  createProvider(input: ProviderInput, requestedId?: string): AiProvider {
    const id = requestedId || randomUUID();
    const now = new Date().toISOString();
    const enabled = input.enabled !== false;
    this.db
      .prepare(
        `INSERT INTO ai_providers
          (id, name, kind, base_url, api_key_enc, enabled, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name.trim(),
        input.kind,
        trimUrl(input.baseUrl),
        encryptProviderSecret(input.apiKey?.trim() ?? "", this.secretFallback),
        enabled ? 1 : 0,
        enabled ? "untested" : "disabled",
        now,
        now
      );
    return this.getProvider(id)!;
  }

  updateProvider(id: string, input: ProviderInput): AiProvider | null {
    const existing = this.db
      .prepare<[string], ProviderRow>(`${PROVIDER_SELECT} WHERE id = ?`)
      .get(id);
    if (!existing) return null;
    const enabled = input.enabled !== false;
    const apiKeyEnc =
      input.apiKey === undefined
        ? existing.apiKeyEnc
        : encryptProviderSecret(input.apiKey.trim(), this.secretFallback);
    this.db
      .prepare(
        `UPDATE ai_providers SET
           name = ?, kind = ?, base_url = ?, api_key_enc = ?, enabled = ?,
           status = CASE WHEN ? = 0 THEN 'disabled' ELSE 'untested' END,
           last_error = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name.trim(),
        input.kind,
        trimUrl(input.baseUrl),
        apiKeyEnc,
        enabled ? 1 : 0,
        enabled ? 1 : 0,
        new Date().toISOString(),
        id
      );
    return this.getProvider(id);
  }

  deleteProvider(id: string): boolean {
    return this.db.prepare("DELETE FROM ai_providers WHERE id = ?").run(id).changes > 0;
  }

  listModels(providerId?: string, enabledOnly = false): AiModel[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (providerId) {
      clauses.push("provider_id = ?");
      values.push(providerId);
    }
    if (enabledOnly) clauses.push("enabled = 1");
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`${MODEL_SELECT}${where} ORDER BY created_at, name`)
      .all(...values) as ModelRow[];
    return rows.map(modelFromRow);
  }

  getModel(id: string): AiModel | null {
    const row = this.db.prepare<[string], ModelRow>(`${MODEL_SELECT} WHERE id = ?`).get(id);
    return row ? modelFromRow(row) : null;
  }

  createModel(providerId: string, input: ModelInput, requestedId?: string): AiModel {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error("Provider not found");
    const capabilities = normalizeCapabilities(input.capabilities);
    if (capabilities.length === 0) throw new Error("Choose at least one capability");
    const id = requestedId || randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ai_models
          (id, provider_id, name, upstream_id, capabilities, context_window,
           multiplier, enabled, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        providerId,
        input.name.trim(),
        input.upstreamId.trim(),
        JSON.stringify(capabilities),
        input.contextWindow ?? 128_000,
        input.multiplier ?? 1,
        input.enabled === false ? 0 : 1,
        JSON.stringify({
          ...(provider.kind === "openai-compatible"
            ? { apiMode: "chat-completions" as const }
            : { apiMode: "responses" as const }),
          ...(provider.kind === "perplexity"
            ? { builtinTools: ["web_search", "fetch_url"] as const }
            : {}),
          ...(input.config ?? {}),
        }),
        now,
        now
      );
    if (input.enabled !== false) this.fillMissingDefaults(id, capabilities);
    return this.getModel(id)!;
  }

  updateModel(id: string, input: ModelInput): AiModel | null {
    const existing = this.getModel(id);
    if (!existing) return null;
    const provider = this.getProvider(existing.providerId);
    const capabilities = normalizeCapabilities(input.capabilities);
    if (capabilities.length === 0) throw new Error("Choose at least one capability");
    this.db
      .prepare(
        `UPDATE ai_models SET name = ?, upstream_id = ?, capabilities = ?,
           context_window = ?, multiplier = ?, enabled = ?, config = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name.trim(),
        input.upstreamId.trim(),
        JSON.stringify(capabilities),
        input.contextWindow ?? existing.contextWindow,
        input.multiplier ?? existing.multiplier,
        input.enabled === false ? 0 : 1,
        JSON.stringify({
          ...(provider?.kind === "perplexity"
            ? { builtinTools: ["web_search", "fetch_url"] as const }
            : {}),
          ...(input.config ?? existing.config),
        }),
        new Date().toISOString(),
        id
      );
    this.clearInvalidRoutes(id, input.enabled === false ? [] : capabilities);
    if (input.enabled !== false) this.fillMissingDefaults(id, capabilities);
    return this.getModel(id);
  }

  deleteModel(id: string): boolean {
    return this.db.prepare("DELETE FROM ai_models WHERE id = ?").run(id).changes > 0;
  }

  listModelsForCapability(capability: ModelCapability): AiModel[] {
    return this.listModels(undefined, true).filter((model) =>
      model.capabilities.includes(capability)
    );
  }

  listAvailableModels(): AiModel[] {
    const enabledProviders = new Set(
      this.listProviders()
        .filter((provider) => provider.enabled)
        .map((provider) => provider.id)
    );
    return this.listModels(undefined, true).filter((model) =>
      enabledProviders.has(model.providerId)
    );
  }

  textCatalog(): ModelEntry[] {
    const providers = new Map(this.listProviders().map((provider) => [provider.id, provider.kind]));
    return this.listAvailableModels()
      .filter((model) => model.capabilities.includes("text"))
      .map((model) => {
        const kind = providers.get(model.providerId);
        return {
          id: model.id,
          name: model.name,
          model: model.upstreamId,
          providerId: model.providerId,
          ...(kind === "openrouter" || kind === "perplexity" || kind === "xai"
            ? { provider: kind }
            : {}),
          multiplier: model.multiplier,
          contextWindow: model.contextWindow,
          builtinTools: model.config.builtinTools,
          preset: model.config.preset,
          apiMode: model.config.apiMode,
        };
      });
  }

  getRouting(chatId?: number): AiRouting {
    const defaults =
      this.db
        .prepare<[], RoutingRow>(`${ROUTING_SELECT} FROM ai_routing_defaults WHERE singleton = 1`)
        .get() ?? emptyRouting();
    if (chatId === undefined) return defaults;
    const chat = this.db
      .prepare<[number], RoutingRow>(`${ROUTING_SELECT} FROM chat_ai_routing WHERE chat_id = ?`)
      .get(chatId);
    if (!chat) return defaults;
    return {
      textModelId: chat.textModelId ?? defaults.textModelId,
      imageGenerationModelId: chat.imageGenerationModelId ?? defaults.imageGenerationModelId,
      imageEditModelId: chat.imageEditModelId ?? defaults.imageEditModelId,
      ttsModelId: chat.ttsModelId ?? defaults.ttsModelId,
      sttModelId: chat.sttModelId ?? defaults.sttModelId,
      ttsVoice: chat.ttsVoice ?? defaults.ttsVoice,
    };
  }

  getChatRoutingOverrides(chatId: number): AiRouting {
    return (
      this.db
        .prepare<[number], RoutingRow>(`${ROUTING_SELECT} FROM chat_ai_routing WHERE chat_id = ?`)
        .get(chatId) ?? emptyRouting()
    );
  }

  setDefaultRouting(patch: Partial<AiRouting>): AiRouting {
    this.writeRouting("ai_routing_defaults", "singleton", 1, patch);
    return this.getRouting();
  }

  setChatRouting(chatId: number, patch: Partial<AiRouting>): AiRouting {
    this.writeRouting("chat_ai_routing", "chat_id", chatId, patch);
    return this.getRouting(chatId);
  }

  resolve(capability: RoutingCapability, chatId?: number): ResolvedAiModel | null {
    const routing = this.getRouting(chatId);
    const key = {
      text: routing.textModelId,
      image_generation: routing.imageGenerationModelId,
      image_edit: routing.imageEditModelId,
      tts: routing.ttsModelId,
      stt: routing.sttModelId,
    }[capability];
    const selected = key ? this.getModel(key) : null;
    const candidates = [
      ...(selected?.enabled && selected.capabilities.includes(capability) ? [selected] : []),
      ...this.listModelsForCapability(capability).filter((model) => model.id !== selected?.id),
    ];
    for (const model of candidates) {
      const provider = this.getProviderCredentials(model.providerId);
      if (provider?.enabled && provider.apiKey) return { provider, model };
    }
    return null;
  }

  resolveModel(modelId: string): ResolvedAiModel | null {
    const model = this.getModel(modelId);
    if (!model?.enabled) return null;
    const provider = this.getProviderCredentials(model.providerId);
    if (!provider?.enabled || !provider.apiKey) return null;
    return { provider, model };
  }

  async testProvider(id: string): Promise<{ ok: boolean; error?: string }> {
    const provider = this.getProviderCredentials(id);
    if (!provider) return { ok: false, error: "Provider not found" };
    const result = await probeProvider(provider);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE ai_providers SET status = ?, last_error = ?, tested_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(result.ok ? "ready" : "error", result.error ?? null, now, now, id);
    return result;
  }

  async discoverModels(id: string): Promise<DiscoveredModel[]> {
    const provider = this.getProviderCredentials(id);
    if (!provider) throw new Error("Provider not found");
    if (provider.kind === "perplexity") {
      return (await fetchPerplexityModels(provider))
        .filter((entry) => typeof entry.id === "string")
        .map((entry) => discoverModel(entry));
    }
    const response = await fetch(`${provider.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `The models endpoint returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`
      );
    }
    const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
    return (body.data ?? [])
      .filter((entry) => typeof entry.id === "string")
      .map((entry) => discoverModel(entry));
  }

  syncConfig(config: AiProviderConfig): void {
    const providerIds = new Set(config.providers.map((provider) => provider.id));
    const modelIds = new Set(config.models.map((model) => model.id));
    const now = new Date().toISOString();

    this.db.transaction(() => {
      for (const provider of config.providers) {
        const existing = this.db
          .prepare<[string], ProviderRow>(`${PROVIDER_SELECT} WHERE id = ?`)
          .get(provider.id);
        const apiKeyEnc =
          existing &&
          decryptSecretSafely(existing.apiKeyEnc, this.secretFallback) === provider.api_key
            ? existing.apiKeyEnc
            : encryptProviderSecret(provider.api_key.trim(), this.secretFallback);
        this.db
          .prepare(
            `INSERT INTO ai_providers
              (id, name, kind, base_url, api_key_enc, enabled, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               kind = excluded.kind,
               base_url = excluded.base_url,
               api_key_enc = excluded.api_key_enc,
               enabled = excluded.enabled,
               status = CASE WHEN excluded.enabled = 0 THEN 'disabled'
                             WHEN ai_providers.enabled = 0 THEN 'untested'
                             ELSE ai_providers.status END,
               last_error = CASE WHEN ai_providers.api_key_enc = excluded.api_key_enc
                                 THEN ai_providers.last_error ELSE NULL END,
               updated_at = excluded.updated_at`
          )
          .run(
            provider.id,
            provider.name.trim(),
            provider.kind,
            trimUrl(provider.base_url),
            apiKeyEnc,
            provider.enabled ? 1 : 0,
            provider.enabled ? "untested" : "disabled",
            existing?.createdAt ?? now,
            now
          );
      }

      deleteRowsNotIn(this.db, "ai_models", modelIds);

      for (const model of config.models) {
        const runtimeConfig: AiModelConfig = {
          ...(model.api_mode ? { apiMode: model.api_mode } : {}),
          ...(model.builtin_tools ? { builtinTools: model.builtin_tools } : {}),
          ...(model.preset ? { preset: model.preset } : {}),
          ...(model.aspect_ratio ? { aspectRatio: model.aspect_ratio } : {}),
          ...(model.resolution !== undefined ? { resolution: model.resolution } : {}),
          ...(model.voice ? { voice: model.voice } : {}),
          ...(model.voices ? { voices: model.voices } : {}),
          ...(model.language ? { language: model.language } : {}),
          ...(model.audio_format ? { audioFormat: model.audio_format } : {}),
          ...(model.expressive !== undefined ? { expressive: model.expressive } : {}),
          ...(model.pcm_sample_rate ? { pcmSampleRate: model.pcm_sample_rate } : {}),
          ...(model.pcm_channels ? { pcmChannels: model.pcm_channels } : {}),
        };
        const existing = this.getModel(model.id);
        this.db
          .prepare(
            `INSERT INTO ai_models
              (id, provider_id, name, upstream_id, capabilities, context_window,
               multiplier, enabled, config, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               provider_id = excluded.provider_id,
               name = excluded.name,
               upstream_id = excluded.upstream_id,
               capabilities = excluded.capabilities,
               context_window = excluded.context_window,
               multiplier = excluded.multiplier,
               enabled = excluded.enabled,
               config = excluded.config,
               updated_at = excluded.updated_at`
          )
          .run(
            model.id,
            model.provider,
            model.name.trim(),
            model.model.trim(),
            JSON.stringify(normalizeCapabilities(model.capabilities)),
            model.context_window,
            model.multiplier,
            model.enabled ? 1 : 0,
            JSON.stringify(runtimeConfig),
            existing?.createdAt ?? now,
            now
          );
      }

      deleteRowsNotIn(this.db, "ai_providers", providerIds);
      this.setDefaultRouting({
        textModelId: config.defaults.text || null,
        imageGenerationModelId: config.defaults.image || null,
        imageEditModelId: config.defaults.image || null,
        ttsModelId: config.defaults.tts || null,
        sttModelId: config.defaults.stt || null,
        ttsVoice: config.defaults.voice || null,
      });
      this.db.exec(
        `UPDATE chat_ai_routing
         SET image_generation_model_id = COALESCE(image_generation_model_id, image_edit_model_id),
             image_edit_model_id = COALESCE(image_generation_model_id, image_edit_model_id)`
      );
    })();
  }

  seedLegacy(config: SkyeConfig): void {
    const count =
      this.db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM ai_providers").get()
        ?.count ?? 0;
    if (count > 0) return;

    const primaryKey = String(config.openai_key ?? "");
    const primaryUrl = String(config.base_url ?? "https://openrouter.ai/api/v1");
    const xaiKey = String(config.xai_api_key ?? "");
    const perplexityKey = String(config.perplexity_api_key ?? "");
    const primaryKind: ProviderKind = primaryUrl.includes("openrouter.ai")
      ? "openrouter"
      : primaryUrl.includes("api.openai.com")
        ? "openai"
        : "openai-compatible";

    if (primaryKey) {
      this.createProvider(
        {
          name: providerLabel(primaryKind),
          kind: primaryKind,
          baseUrl: primaryUrl,
          apiKey: primaryKey,
        },
        "legacy-primary"
      );
    }
    if (xaiKey) {
      this.createProvider(
        {
          name: "xAI",
          kind: "xai",
          baseUrl: String(config.xai_base_url ?? "https://api.x.ai/v1"),
          apiKey: xaiKey,
        },
        "legacy-xai"
      );
    }
    if (perplexityKey) {
      this.createProvider(
        {
          name: "Perplexity",
          kind: "perplexity",
          baseUrl: String(config.perplexity_base_url ?? "https://api.perplexity.ai/v1"),
          apiKey: perplexityKey,
        },
        "legacy-perplexity"
      );
    }

    const models = Array.isArray(config.models) ? (config.models as ModelEntry[]) : [];
    for (const entry of models) {
      const providerId =
        entry.provider === "xai"
          ? "legacy-xai"
          : entry.provider === "perplexity"
            ? "legacy-perplexity"
            : "legacy-primary";
      if (!this.getProvider(providerId)) continue;
      this.createModel(
        providerId,
        {
          name: entry.name,
          upstreamId: entry.model,
          capabilities: ["text", "vision"],
          contextWindow: entry.contextWindow,
          multiplier: entry.multiplier,
          config: {
            apiMode: entry.provider
              ? "responses"
              : config.use_chat_completions
                ? "chat-completions"
                : "responses",
            builtinTools: entry.builtinTools,
            preset: entry.preset,
          },
        },
        entry.id
      );
    }

    this.seedLegacyImage(config);
    this.seedLegacySpeech(config);
    const configuredDefault = String(config.default_model_id ?? "");
    if (configuredDefault && this.getModel(configuredDefault)) {
      this.setDefaultRouting({ textModelId: configuredDefault });
    }
  }

  private seedLegacyImage(config: SkyeConfig): void {
    const image = config.image as
      | {
          provider?: string;
          base_url?: string;
          api_key?: string;
          model?: string;
          aspect_ratio?: string;
          resolution?: "1k" | "2k" | "";
        }
      | undefined;
    const imageConfig = image ?? {};
    const upstreamId = imageConfig.model?.trim();
    if (!upstreamId) return;
    let providerId = imageConfig.provider === "xai" ? "legacy-xai" : "legacy-primary";
    if (imageConfig.api_key) {
      providerId = "legacy-image";
      const kind: ProviderKind = imageConfig.provider === "xai" ? "xai" : "openai-compatible";
      this.createProvider(
        {
          name: "Legacy image provider",
          kind,
          baseUrl:
            imageConfig.base_url ||
            (kind === "xai" ? "https://api.x.ai/v1" : String(config.base_url)),
          apiKey: imageConfig.api_key,
        },
        providerId
      );
    }
    if (!this.getProvider(providerId)) return;
    const id = "legacy-image-model";
    this.createModel(
      providerId,
      {
        name: upstreamId,
        upstreamId,
        capabilities: ["image_generation", "image_edit"],
        config: { aspectRatio: imageConfig.aspect_ratio, resolution: imageConfig.resolution },
      },
      id
    );
    this.setDefaultRouting({ imageGenerationModelId: id, imageEditModelId: id });
  }

  private seedLegacySpeech(config: SkyeConfig): void {
    const voice = config.voice;
    if (!voice || voice.provider === "yandex" || voice.provider === "tinfoil") return;
    if (voice.provider === "openrouter") {
      const settings = voice.openrouter;
      const apiKey = settings.api_key || String(config.openai_key ?? "");
      if (!apiKey) return;
      const baseUrl = settings.base_url || "https://openrouter.ai/api/v1";
      const primary = this.getProviderCredentials("legacy-primary");
      const providerId =
        primary?.kind === "openrouter" && primary.baseUrl === trimUrl(baseUrl)
          ? primary.id
          : "legacy-speech";
      if (!this.getProvider(providerId)) {
        this.createProvider(
          { name: "OpenRouter speech", kind: "openrouter", baseUrl, apiKey },
          providerId
        );
      }
      const ttsId = "legacy-tts-model";
      const sttId = "legacy-stt-model";
      this.createModel(
        providerId,
        {
          name: settings.tts_model,
          upstreamId: settings.tts_model,
          capabilities: ["tts"],
          config: {
            voice: settings.tts_voice,
            audioFormat: settings.tts_format,
            pcmSampleRate: settings.pcm_sample_rate,
            pcmChannels: settings.pcm_channels,
          },
        },
        ttsId
      );
      this.createModel(
        providerId,
        {
          name: settings.stt_model,
          upstreamId: settings.stt_model,
          capabilities: ["stt"],
          config: {
            audioFormat: settings.stt_format,
            language: settings.stt_language,
          },
        },
        sttId
      );
      this.setDefaultRouting({
        ttsModelId: ttsId,
        sttModelId: sttId,
        ttsVoice: settings.tts_voice,
      });
      return;
    }

    const settings = voice.xai;
    const apiKey = settings.api_key || String(config.xai_api_key ?? "");
    if (!apiKey) return;
    const providerId = this.getProvider("legacy-xai") ? "legacy-xai" : "legacy-speech";
    if (!this.getProvider(providerId)) {
      this.createProvider(
        { name: "xAI", kind: "xai", baseUrl: settings.base_url || "https://api.x.ai/v1", apiKey },
        providerId
      );
    }
    const ttsId = "legacy-tts-model";
    const sttId = "legacy-stt-model";
    this.createModel(
      providerId,
      {
        name: "xAI text to speech",
        upstreamId: "xai-tts",
        capabilities: ["tts"],
        config: {
          voice: settings.tts_voice,
          language: settings.tts_language,
          audioFormat: settings.tts_format,
        },
      },
      ttsId
    );
    this.createModel(
      providerId,
      {
        name: "xAI speech to text",
        upstreamId: "xai-stt",
        capabilities: ["stt"],
        config: { language: settings.stt_language, audioFormat: settings.stt_format },
      },
      sttId
    );
    this.setDefaultRouting({ ttsModelId: ttsId, sttModelId: sttId, ttsVoice: settings.tts_voice });
  }

  private fillMissingDefaults(id: string, capabilities: ModelCapability[]): void {
    const defaults = this.getRouting();
    const patch: Partial<AiRouting> = {};
    if (capabilities.includes("text") && !defaults.textModelId) patch.textModelId = id;
    if (capabilities.includes("image_generation") && !defaults.imageGenerationModelId)
      patch.imageGenerationModelId = id;
    if (capabilities.includes("image_edit") && !defaults.imageEditModelId)
      patch.imageEditModelId = id;
    if (capabilities.includes("tts") && !defaults.ttsModelId) patch.ttsModelId = id;
    if (capabilities.includes("stt") && !defaults.sttModelId) patch.sttModelId = id;
    if (Object.keys(patch).length) this.setDefaultRouting(patch);
  }

  private clearInvalidRoutes(id: string, capabilities: ModelCapability[]): void {
    for (const capability of ["text", "image_generation", "image_edit", "tts", "stt"] as const) {
      if (capabilities.includes(capability)) continue;
      const column = routingColumn(capability);
      this.db
        .prepare(`UPDATE ai_routing_defaults SET ${column} = NULL WHERE ${column} = ?`)
        .run(id);
      this.db.prepare(`UPDATE chat_ai_routing SET ${column} = NULL WHERE ${column} = ?`).run(id);
    }
  }

  private writeRouting(
    table: "ai_routing_defaults" | "chat_ai_routing",
    keyColumn: "singleton" | "chat_id",
    key: number,
    patch: Partial<AiRouting>
  ): void {
    const mapping: Array<[keyof AiRouting, string, RoutingCapability | null]> = [
      ["textModelId", "text_model_id", "text"],
      ["imageGenerationModelId", "image_generation_model_id", "image_generation"],
      ["imageEditModelId", "image_edit_model_id", "image_edit"],
      ["ttsModelId", "tts_model_id", "tts"],
      ["sttModelId", "stt_model_id", "stt"],
      ["ttsVoice", "tts_voice", null],
    ];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const [keyName, column, capability] of mapping) {
      if (!(keyName in patch)) continue;
      const value = patch[keyName];
      if (capability && value !== null) {
        const model = this.getModel(String(value));
        if (!model?.enabled || !model.capabilities.includes(capability)) {
          throw new Error(`Choose an enabled ${capability.replaceAll("_", " ")} model`);
        }
      }
      updates.push(`${column} = ?`);
      values.push(value ?? null);
    }
    if (!updates.length) return;
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT OR IGNORE INTO ${table} (${keyColumn}, updated_at) VALUES (?, ?)`)
      .run(key, now);
    this.db
      .prepare(`UPDATE ${table} SET ${updates.join(", ")}, updated_at = ? WHERE ${keyColumn} = ?`)
      .run(...values, now, key);
  }
}

async function probeProvider(
  provider: ProviderCredentials
): Promise<{ ok: boolean; error?: string }> {
  if (!provider.apiKey) return { ok: false, error: "Add an API key and try again." };
  if (provider.kind === "perplexity") return probePerplexityProvider(provider);
  try {
    const response = await fetch(`${provider.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true };
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      error: `The provider returned ${response.status}. ${detail.slice(0, 240) || "Check the API key and base URL."}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to reach the provider.",
    };
  }
}

function discoverModel(entry: Record<string, unknown>): DiscoveredModel {
  const upstreamId = String(entry.id);
  const lower = upstreamId.toLowerCase();
  const architecture = entry.architecture as
    | { modality?: unknown; input_modalities?: unknown; output_modalities?: unknown }
    | undefined;
  const input = JSON.stringify(
    architecture?.input_modalities ?? architecture?.modality ?? ""
  ).toLowerCase();
  const output = JSON.stringify(
    architecture?.output_modalities ?? architecture?.modality ?? ""
  ).toLowerCase();
  const capabilities: ModelCapability[] = [];
  if (/tts|text-to-speech|speech/.test(lower) || output.includes("audio")) capabilities.push("tts");
  if (/whisper|stt|speech-to-text|transcri/.test(lower)) capabilities.push("stt");
  if (/image|imagine|dall-e|flux/.test(lower) || output.includes("image")) {
    capabilities.push("image_generation", "image_edit");
  }
  if (
    !capabilities.some(
      (capability) =>
        capability === "tts" || capability === "stt" || capability.startsWith("image_")
    )
  ) {
    capabilities.push("text");
  }
  if (input.includes("image") || /vision|gpt-4o|gemini|grok/.test(lower))
    capabilities.push("vision");
  const context = Number(entry.context_length ?? entry.context_window);
  return {
    upstreamId,
    name: String(entry.name ?? upstreamId),
    capabilities: normalizeCapabilities(capabilities),
    ...(Number.isSafeInteger(context) && context > 0 ? { contextWindow: context } : {}),
  };
}

function emptyRouting(): AiRouting {
  return {
    textModelId: null,
    imageGenerationModelId: null,
    imageEditModelId: null,
    ttsModelId: null,
    sttModelId: null,
    ttsVoice: null,
  };
}

function providerLabel(kind: ProviderKind): string {
  return {
    openai: "OpenAI",
    openrouter: "OpenRouter",
    xai: "xAI",
    perplexity: "Perplexity",
    tinfoil: "Tinfoil",
    "openai-compatible": "OpenAI-compatible provider",
  }[kind];
}

function decryptSecretSafely(value: string, fallback: string): string {
  try {
    return decryptProviderSecret(value, fallback);
  } catch {
    return "";
  }
}

function deleteRowsNotIn(
  db: Database.Database,
  table: "ai_models" | "ai_providers",
  ids: Set<string>
): void {
  if (ids.size === 0) {
    db.prepare(`DELETE FROM ${table}`).run();
    return;
  }
  const placeholders = [...ids].map(() => "?").join(", ");
  db.prepare(`DELETE FROM ${table} WHERE id NOT IN (${placeholders})`).run(...ids);
}
