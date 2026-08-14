import type { AgentProfile, AgentRuntimeConfig } from "./config.js";
import type { AgentRunRequest, AgentRuntime, AgentRuntimeDeps } from "./types.js";
import { OpenAIAgentsRuntime } from "./openai.js";
import { runChatLoop } from "../telegram/chat.js";
import { log } from "../../utils/log.js";
import { isChatProfileId } from "./chatAgents.js";
import { isPersonalProfileId } from "./userAgents.js";
import type { TenantContext } from "../../core/tenant.js";

export class AgentRuntimeService implements AgentRuntime {
  readonly engine: AgentRuntime["engine"];
  private readonly openaiAgents: OpenAIAgentsRuntime;

  constructor(
    private readonly deps: AgentRuntimeDeps,
    private readonly config: AgentRuntimeConfig
  ) {
    this.engine = config.engine;
    this.openaiAgents = new OpenAIAgentsRuntime(deps, config);
  }

  run(request: AgentRunRequest): Promise<string> {
    const model = this.deps.llm.resolveModel(request.modelId);
    if (this.engine === "openai_agents" && model.provider !== "perplexity") {
      return this.openaiAgents.run(request);
    }
    if (this.engine === "openai_agents" && model.provider === "perplexity") {
      log.info(
        { modelId: model.id, chatId: request.tenant.chatId },
        "Using the dedicated Perplexity Agent API adapter"
      );
    }
    return runChatLoop(
      {
        ...this.deps,
        builtinTools: request.builtinTools,
        allowConnectorTools: request.allowConnectorTools,
        hasReferenceImages: request.hasReferenceImages,
        modelId: request.modelId,
        beforeRound: request.beforeRound,
        onUsage: request.onUsage,
        owner: request.owner,
        acceptEmptyFinal: request.acceptEmptyFinal,
        resolveActiveAgent: (tenant) => this.activeProfileFor(tenant),
      },
      request.tenant,
      request.input,
      request.onChunk,
      request.onToolCalls,
      request.signal
    );
  }

  /** YAML templates only (not activatable directly). */
  templates(): AgentProfile[] {
    return this.config.agents.filter((profile) => profile.enabled);
  }

  /** Editable profiles available in this tenant context. */
  libraryFor(tenant: Pick<TenantContext, "chatId" | "chatType" | "userId">): AgentProfile[] {
    if (tenant.chatType === "private") {
      return tenant.userId ? this.deps.userAgents.profiles(tenant.userId) : [];
    }
    return this.deps.chatAgents.profiles(tenant.chatId);
  }

  profiles(): AgentProfile[] {
    return this.templates();
  }

  profilesFor(userId?: number): AgentProfile[] {
    return [...this.templates(), ...(userId ? this.deps.userAgents.profiles(userId) : [])];
  }

  profile(
    id: string | undefined,
    tenant?: Pick<TenantContext, "chatId" | "chatType" | "userId">
  ): AgentProfile | undefined {
    if (!id) return undefined;
    if (tenant) {
      const fromLibrary = this.libraryFor(tenant).find((profile) => profile.id === id);
      if (fromLibrary) return fromLibrary;
    }
    if (isPersonalProfileId(id) && tenant?.userId) {
      return this.deps.userAgents.profiles(tenant.userId).find((profile) => profile.id === id);
    }
    if (isChatProfileId(id) && tenant) {
      return this.deps.chatAgents.profiles(tenant.chatId).find((profile) => profile.id === id);
    }
    return this.templates().find((profile) => profile.id === id);
  }

  activeProfileFor(tenant: TenantContext): AgentProfile | undefined {
    if (tenant.chatType === "private") {
      const override =
        tenant.userId != null
          ? this.deps.userAgents.getSelection(tenant.userId, tenant.chatId, tenant.threadId)
          : undefined;
      if (override) return this.profile(override, tenant);
      const primary =
        tenant.userId != null ? this.deps.userAgents.getPrimary(tenant.userId) : undefined;
      return this.profile(primary, tenant);
    }
    return this.profile(this.deps.chatAgents.getSelection(tenant.chatId), tenant);
  }

  /** @deprecated Prefer activeProfileFor(tenant). */
  activeProfile(chatId: number, threadId?: number, userId?: number): AgentProfile | undefined {
    const isPrivate = userId != null && chatId === userId;
    return this.activeProfileFor({
      chatId,
      chatType: isPrivate ? "private" : "supergroup",
      threadId,
      userId,
    });
  }

  async close(): Promise<void> {
    await this.openaiAgents.close();
  }
}
