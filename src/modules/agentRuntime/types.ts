import type { ResponseInputItem } from "../llm/client.js";
import type { ConnectorService } from "../connectors/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { ChatConfigService } from "../chatConfig/service.js";
import type { SandboxService } from "../sandbox/service.js";
import type { RemindersService } from "../reminders/service.js";
import type { ChannelService } from "../channel/service.js";
import type { StickersService } from "../stickers/service.js";
import type { LlmClient } from "../llm/client.js";
import type { TenantContext } from "../../core/tenant.js";
import type { ToolDefinition } from "../../core/module.js";
import type { ToolCallRecord } from "../telegram/helpers.js";
import type { UserAgentService } from "./userAgents.js";
import type { ChatAgentService } from "./chatAgents.js";

export interface AgentRuntimeDeps {
  llm: LlmClient;
  connectors: ConnectorService;
  memory: MemoryService;
  chatLog: ChatLogService;
  userConfig: UserConfigService;
  chatConfig: ChatConfigService;
  sandbox?: SandboxService;
  reminders?: RemindersService;
  channel?: ChannelService;
  stickers?: StickersService;
  userAgents: UserAgentService;
  chatAgents: ChatAgentService;
}

export interface AgentRunRequest {
  tenant: TenantContext;
  input: ResponseInputItem[];
  builtinTools: ToolDefinition[];
  allowConnectorTools?: boolean;
  hasReferenceImages?: boolean;
  modelId?: string;
  beforeRound?: (modelId: string) => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number }, modelId: string) => void;
  owner?: { name: string; tag: string };
  onChunk?: (snapshot: string) => void;
  onToolCalls?: (calls: ToolCallRecord[]) => void;
  acceptEmptyFinal?: () => boolean;
  signal?: AbortSignal;
}

export interface AgentRuntime {
  readonly engine: "legacy" | "openai_agents";
  run(request: AgentRunRequest): Promise<string>;
}
