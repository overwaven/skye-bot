import type { LlmClient } from "../llm/client.js";
import type { ConnectorService } from "../connectors/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { ChatConfigService } from "../chatConfig/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { SpeechService } from "../speech/service.js";
import type { AuditService } from "../audit/service.js";
import type { SandboxService } from "../sandbox/service.js";
import type { ProactiveService } from "../proactive/service.js";
import type { RemindersService } from "../reminders/service.js";
import type { BackgroundJobsService } from "../jobs/service.js";
import type { ChannelService } from "../channel/service.js";
import type { StickersService } from "../stickers/service.js";
import type { EventBus } from "../../core/events.js";
import type { BillingService } from "../billing/service.js";
import type { AdminService } from "../admin/service.js";
import type { AgentRuntimeService } from "../agentRuntime/service.js";
import type { AccessDeps } from "./access.js";
import type { TelegramReliabilityService } from "./reliability.js";

export interface TelegramDeps {
  llm: LlmClient;
  connectors: ConnectorService;
  memory: MemoryService;
  chatLog: ChatLogService;
  chatConfig: ChatConfigService;
  userConfig: UserConfigService;
  speech: SpeechService;
  audit: AuditService;
  sandbox?: SandboxService;
  proactive?: ProactiveService;
  reminders?: RemindersService;
  jobs: BackgroundJobsService;
  channel?: ChannelService;
  stickers?: StickersService;
  events?: EventBus;
  billing: BillingService;
  admin: AdminService;
  agentRuntime: AgentRuntimeService;
  botToken: string;
  maxAttachmentBytes: number;
  webappUrl: string;
  defaultModelId: string;
  reliability: TelegramReliabilityService;
  owner?: { name: string; tag: string };
  accessMode: AccessDeps["mode"];
  subscriptionStars: number;
}

/** Content part types used internally (Responses-API style, extended). */
export type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_data: string; filename: string };

export type ImageControl = {
  prompt: string;
  imageUrl?: string;
  ownerUserId: number;
  expiresAt: number;
};

export const IMAGE_CMD_RE = /^\/image(?:@\S+)?\s*([\s\S]*)$/;
export const VOICE_OUTPUT_REQUEST_RE =
  /(голос|озвуч|аудио|вслух|шепни|прошепт|voice note|voice message|spoken|out loud|read aloud|whisper)/i;
export const TEXT_HISTORY_LIMIT = 40;
export const TRACKED_CHATS = new Set<string>();
export const SUPPORTED_TEXT_MIME_RE =
  /^(text\/|application\/(json|xml|csv|javascript|x-javascript|typescript|x-typescript|sql))/i;
export const SUPPORTED_TEXT_EXT_RE =
  /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|css|html|xml|yaml|yml|toml|ini|sql|log)$/i;
export const PDF_MIME = "application/pdf";
export const PDF_EXT_RE = /\.pdf$/i;
export const IMAGE_CONTROL_TTL_MS = 15 * 60 * 1000;
export const MEDIA_GROUP_GRACE_MS = 700;

export type MediaGroupEntry = {
  tenant: import("../../core/tenant.js").TenantContext;
  ctxs: import("grammy").Context[];
  timer: NodeJS.Timeout;
  completion: Promise<void>;
};
