export const PROVIDER_KINDS = [
  "openai",
  "openrouter",
  "xai",
  "perplexity",
  "openai-compatible",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const MODEL_CAPABILITIES = [
  "text",
  "vision",
  "image_generation",
  "image_edit",
  "tts",
  "stt",
] as const;

export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type ProviderStatus = "untested" | "ready" | "error" | "disabled";

export interface AiProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  enabled: boolean;
  status: ProviderStatus;
  hasApiKey: boolean;
  lastError: string | null;
  testedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCredentials extends AiProvider {
  apiKey: string;
}

export interface AiModelConfig {
  apiMode?: "responses" | "chat-completions";
  builtinTools?: Array<"web_search" | "fetch_url" | "finance_search" | "people_search" | "sandbox">;
  preset?: string;
  aspectRatio?: string;
  resolution?: "1k" | "2k" | "";
  voice?: string;
  voices?: string[];
  language?: string;
  audioFormat?: "mp3" | "wav" | "pcm" | "oggopus";
  expressive?: boolean;
  pcmSampleRate?: number;
  pcmChannels?: number;
}

export interface AiModel {
  id: string;
  providerId: string;
  name: string;
  upstreamId: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  multiplier: number;
  enabled: boolean;
  config: AiModelConfig;
  createdAt: string;
  updatedAt: string;
}

export type RoutingCapability = "text" | "image_generation" | "image_edit" | "tts" | "stt";

export interface AiRouting {
  textModelId: string | null;
  imageGenerationModelId: string | null;
  imageEditModelId: string | null;
  ttsModelId: string | null;
  sttModelId: string | null;
  ttsVoice: string | null;
}

export interface ResolvedAiModel {
  provider: ProviderCredentials;
  model: AiModel;
}
