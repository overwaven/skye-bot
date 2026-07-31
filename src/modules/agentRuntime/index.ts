import type { SkyeModule } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import { InlineKeyboard, type Context } from "grammy";
import { ZodError } from "zod";
import { agentRuntimeConfigSchema } from "./config.js";
import { migrations } from "./migrations.js";
import { buildAgentRoutes } from "./routes.js";
import { AgentRuntimeService } from "./service.js";
import {
  isPersonalProfileId,
  personalProfileId,
  UserAgentService,
  type UserAgentInput,
} from "./userAgents.js";

let serviceRef: AgentRuntimeService | null = null;

declare module "../../core/module.js" {
  interface SkyeServices {
    agentRuntime: AgentRuntimeService;
  }
}

function scopeLabel(threadId?: number): string {
  return threadId == null ? "this chat" : "this topic";
}

function parseAgentForm(raw: string): UserAgentInput | undefined {
  const [id, name, description, ...instructionParts] = raw.split("|").map((part) => part.trim());
  const instructions = instructionParts.join(" | ").trim();
  if (!id || !name || !description || !instructions) return undefined;
  return { id, name, description, instructions };
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid agent data";
  if (error instanceof Error) return error.message;
  return String(error);
}

const editAgentHelp = [
  "Use this format:",
  "<id> | <name> | <description> | <instructions>",
  "",
  "Example:",
  "/edit_agent my_copywriter | Copywriter | Writes polished marketing copy | Ask about the audience and produce concise copy.",
].join("\n");

const forceReply = (placeholder: string) => ({
  force_reply: true as const,
  selective: true,
  input_field_placeholder: placeholder,
});

export const agentRuntimeModule: SkyeModule = {
  name: "agentRuntime",
  configSchema: agentRuntimeConfigSchema,
  migrations,
  init(ctx) {
    const userAgents = new UserAgentService(ctx.db, ctx.config.agent_runtime.max_user_agents);
    const llm = ctx.services.get("llm");
    const agentModels = llm.models.filter((model) => model.provider !== "perplexity");
    const agentsPanelUrl = new URL(ctx.config.panel.webapp_url);
    agentsPanelUrl.searchParams.set("agents", "open");
    const agentStudioUrl = new URL(agentsPanelUrl);
    agentStudioUrl.searchParams.set("agents", "create");
    const startAgentWizard = async (telegram: Context, tenant: TenantContext) => {
      userAgents.startDraft(tenant.userId!, tenant.chatId, tenant.threadId);
      await telegram.reply(
        [
          "Let's create your personal agent.",
          "",
          "Step 1 of 4 — What should I call it?",
          "For example: Research Assistant or Copywriter",
          "",
          "You can stop at any time with /cancel_agent.",
        ].join("\n"),
        {
          reply_to_message_id: telegram.message?.message_id,
          reply_markup: forceReply("Agent name"),
        }
      );
    };
    const service = new AgentRuntimeService(
      {
        llm,
        connectors: ctx.services.get("connectors"),
        memory: ctx.services.get("memory"),
        chatLog: ctx.services.get("chatLog"),
        userConfig: ctx.services.get("userConfig"),
        chatConfig: ctx.services.get("chatConfig"),
        sandbox: ctx.services.has("sandbox") ? ctx.services.get("sandbox") : undefined,
        reminders: ctx.services.has("reminders") ? ctx.services.get("reminders") : undefined,
        channel: ctx.services.has("channel") ? ctx.services.get("channel") : undefined,
        stickers: ctx.services.has("stickers") ? ctx.services.get("stickers") : undefined,
        userAgents,
      },
      ctx.config.agent_runtime
    );
    serviceRef = service;
    const chatConfig = ctx.services.get("chatConfig");
    return {
      service,
      panelRoutes: buildAgentRoutes(ctx, userAgents),
      commands: [
        {
          name: "agents",
          description: "List available agent profiles",
          handler: async (telegram, tenant) => {
            const profiles = service.profilesFor(tenant.userId);
            const selected = service.activeProfile(tenant.chatId, tenant.threadId, tenant.userId);
            const lines = profiles.map(
              (profile) =>
                `${profile.id === selected?.id ? "●" : "○"} ${profile.name} (${profile.id}) — ${profile.description}`
            );
            const options =
              telegram.chat?.type === "private"
                ? {
                    reply_to_message_id: telegram.message?.message_id,
                    reply_markup: new InlineKeyboard().webApp(
                      "Manage in Mini App",
                      agentsPanelUrl.toString()
                    ),
                  }
                : { reply_to_message_id: telegram.message?.message_id };
            await telegram.reply(
              [
                `Active for ${scopeLabel(tenant.threadId)}: ${selected?.name ?? "default Skye"}`,
                "",
                ...(lines.length > 0 ? lines : ["No custom agent profiles are configured."]),
                "",
                "Switch with /agent <id>, or use /agent default.",
              ].join("\n"),
              options
            );
          },
        },
        {
          name: "agent",
          description: "Switch agent for this chat or topic",
          handler: async (telegram, tenant) => {
            const requested = telegram.match?.toString().trim() ?? "";
            if (!requested) {
              const selected = service.activeProfile(tenant.chatId, tenant.threadId, tenant.userId);
              await telegram.reply(
                `Active agent for ${scopeLabel(tenant.threadId)}: ${selected?.name ?? "default Skye"}. Use /agents to see profiles.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
              return;
            }
            if (["default", "skye", "reset"].includes(requested.toLowerCase())) {
              if (tenant.userId) {
                userAgents.resetSelection(tenant.userId, tenant.chatId, tenant.threadId);
              }
              chatConfig.resetAgent(tenant.chatId, tenant.threadId);
              await telegram.reply(`Switched ${scopeLabel(tenant.threadId)} to default Skye.`, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            const profile = service.profile(requested, tenant.userId);
            if (!profile) {
              await telegram.reply(`Unknown agent "${requested}". Use /agents to see profiles.`, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            if (isPersonalProfileId(profile.id)) {
              if (!tenant.userId) {
                await telegram.reply("Personal agents require a Telegram user account.", {
                  reply_to_message_id: telegram.message?.message_id,
                });
                return;
              }
              userAgents.setSelection(tenant.userId, tenant.chatId, tenant.threadId, profile.id);
            } else {
              if (tenant.userId) {
                userAgents.resetSelection(tenant.userId, tenant.chatId, tenant.threadId);
              }
              chatConfig.setAgent(tenant.chatId, tenant.threadId, profile.id);
            }
            await telegram.reply(`Switched ${scopeLabel(tenant.threadId)} to ${profile.name}.`, {
              reply_to_message_id: telegram.message?.message_id,
            });
          },
        },
        {
          name: "my_agents",
          description: "List your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const agents = userAgents.list(tenant.userId);
            const active = userAgents.getSelection(tenant.userId, tenant.chatId, tenant.threadId);
            const lines = agents.map((agent) => {
              const id = personalProfileId(agent.id);
              return `${id === active ? "●" : "○"} ${agent.name} (${id}) — ${agent.description}`;
            });
            await telegram.reply(
              [
                ...(lines.length > 0 ? lines : ["You have no personal agents yet."]),
                "",
                `Limit: ${agents.length}/${ctx.config.agent_runtime.max_user_agents}`,
                "Create one with /create_agent.",
              ].join("\n"),
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
        {
          name: "create_agent",
          description: "Create a private personal agent",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const count = userAgents.list(tenant.userId).length;
            if (count >= ctx.config.agent_runtime.max_user_agents) {
              await telegram.reply(
                `You already have the maximum of ${ctx.config.agent_runtime.max_user_agents} personal agents. Delete one with /delete_agent first.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
              return;
            }
            if (telegram.chat?.type === "private") {
              await telegram.reply("Create and manage personal agents in the Mini App.", {
                reply_to_message_id: telegram.message?.message_id,
                reply_markup: new InlineKeyboard()
                  .webApp("Open agent studio", agentStudioUrl.toString())
                  .row()
                  .text("Create here in chat", "agent:create:chat"),
              });
              return;
            }
            await startAgentWizard(telegram, tenant);
          },
        },
        {
          name: "cancel_agent",
          description: "Cancel personal agent creation",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const cancelled = userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
            await telegram.reply(
              cancelled ? "Agent creation cancelled." : "There is no agent creation in progress.",
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
        {
          name: "edit_agent",
          description: "Edit one of your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const form = parseAgentForm(telegram.match?.toString().trim() ?? "");
            if (!form) {
              await telegram.reply(editAgentHelp, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            try {
              const existing = userAgents.get(tenant.userId, form.id);
              const agent = userAgents.update(tenant.userId, form.id, {
                name: form.name,
                description: form.description,
                instructions: form.instructions,
                ...(existing?.modelId ? { modelId: existing.modelId } : {}),
              });
              await telegram.reply(
                `Updated private agent ${agent.name} (${personalProfileId(agent.id)}).`,
                { reply_to_message_id: telegram.message?.message_id }
              );
            } catch (error) {
              await telegram.reply(`Could not update agent: ${errorMessage(error)}`, {
                reply_to_message_id: telegram.message?.message_id,
              });
            }
          },
        },
        {
          name: "delete_agent",
          description: "Delete one of your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const id = telegram.match?.toString().trim() ?? "";
            if (!id) {
              await telegram.reply("Add the agent id, for example: /delete_agent my_copywriter", {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            const deleted = userAgents.delete(tenant.userId, id);
            await telegram.reply(
              deleted
                ? `Deleted private agent ${personalProfileId(id)}.`
                : `Personal agent ${personalProfileId(id)} does not exist.`,
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
      ],
      telegramHandlers: [
        {
          on: "message:text",
          order: 10,
          handler: async (telegram, tenant, next) => {
            if (!tenant.userId) return next();
            const draft = userAgents.getDraft(tenant.userId, tenant.chatId, tenant.threadId);
            const text = telegram.message?.text?.trim() ?? "";
            if (!draft || text.startsWith("/")) return next();

            if (draft.step === "name") {
              if (!text || text.length > 80) {
                await telegram.reply("Send a name between 1 and 80 characters.", {
                  reply_markup: forceReply("Agent name"),
                });
                return;
              }
              userAgents.saveDraft(tenant.userId, tenant.chatId, tenant.threadId, {
                ...draft,
                step: "description",
                name: text,
              });
              await telegram.reply(
                [
                  `Great — ${text}.`,
                  "",
                  "Step 2 of 4 — What is this agent good at?",
                  "Write one short description. This helps Skye decide when to delegate work to it.",
                ].join("\n"),
                { reply_markup: forceReply("What does this agent specialize in?") }
              );
              return;
            }

            if (draft.step === "description") {
              if (!text || text.length > 500) {
                await telegram.reply("Send a description between 1 and 500 characters.", {
                  reply_markup: forceReply("Short agent description"),
                });
                return;
              }
              userAgents.saveDraft(tenant.userId, tenant.chatId, tenant.threadId, {
                ...draft,
                step: "instructions",
                description: text,
              });
              await telegram.reply(
                [
                  "Step 3 of 4 — How should it work?",
                  "",
                  "Describe its role, tone, rules, and what a good answer should look like. You can write several paragraphs.",
                ].join("\n"),
                { reply_markup: forceReply("Detailed instructions") }
              );
              return;
            }

            if (draft.step === "instructions") {
              if (!text || text.length > 16_000) {
                await telegram.reply("Send instructions between 1 and 16,000 characters.", {
                  reply_markup: forceReply("Detailed instructions"),
                });
                return;
              }
              userAgents.saveDraft(tenant.userId, tenant.chatId, tenant.threadId, {
                ...draft,
                step: "model",
                instructions: text,
              });
              const keyboard = new InlineKeyboard()
                .text("Use current chat model", "agent:model:default")
                .row();
              agentModels.forEach((model, index) => {
                keyboard.text(`${model.name} · ${model.multiplier}×`, `agent:model:${index}`).row();
              });
              keyboard.text("Cancel", "agent:create:cancel");
              await telegram.reply(
                [
                  "Step 4 of 4 — Choose a model",
                  "",
                  "Use the current chat model, or pin this agent to a specific model. Token usage is charged at that model's multiplier.",
                ].join("\n"),
                { reply_markup: keyboard }
              );
              return;
            }

            await telegram.reply("Use the buttons above to create the agent, or /cancel_agent.");
          },
        },
        {
          on: "callback_query:data",
          order: 10,
          handler: async (telegram, tenant, next) => {
            const action = telegram.callbackQuery?.data;
            if (!action?.startsWith("agent:")) return next();
            if (!tenant.userId) return;
            if (action === "agent:create:chat") {
              const count = userAgents.list(tenant.userId).length;
              if (count >= ctx.config.agent_runtime.max_user_agents) {
                await telegram.answerCallbackQuery({
                  text: "Agent limit reached.",
                  show_alert: true,
                });
                return;
              }
              await telegram.answerCallbackQuery();
              await startAgentWizard(telegram, tenant);
              return;
            }
            const draft = userAgents.getDraft(tenant.userId, tenant.chatId, tenant.threadId);
            if (!draft) {
              await telegram.answerCallbackQuery({ text: "This setup has expired." });
              return;
            }
            if (action === "agent:create:cancel") {
              userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
              await telegram.answerCallbackQuery({ text: "Cancelled" });
              await telegram.reply("Agent creation cancelled.");
              return;
            }
            if (action.startsWith("agent:model:")) {
              if (draft.step !== "model") {
                await telegram.answerCallbackQuery({ text: "This step has expired." });
                return;
              }
              const selected = action.slice("agent:model:".length);
              const model = selected === "default" ? undefined : agentModels[Number(selected)];
              if (selected !== "default" && !model) {
                await telegram.answerCallbackQuery({ text: "Unknown model." });
                return;
              }
              const completed = userAgents.saveDraft(
                tenant.userId,
                tenant.chatId,
                tenant.threadId,
                {
                  ...draft,
                  step: "confirm",
                  ...(model ? { modelId: model.id } : {}),
                }
              );
              const instructions = completed.instructions ?? "";
              const preview =
                instructions.length > 1_000 ? `${instructions.slice(0, 1_000)}…` : instructions;
              await telegram.answerCallbackQuery({ text: "Model selected" });
              await telegram.reply(
                [
                  "Ready to create this private agent:",
                  "",
                  `Name: ${completed.name}`,
                  `Specialty: ${completed.description}`,
                  `Model: ${model?.name ?? "Current chat model"}`,
                  "Instructions:",
                  preview,
                ].join("\n"),
                {
                  reply_markup: new InlineKeyboard()
                    .text("Create and select", "agent:create:confirm")
                    .text("Cancel", "agent:create:cancel"),
                }
              );
              return;
            }
            if (action !== "agent:create:confirm") return next();
            if (draft.step !== "confirm") {
              await telegram.answerCallbackQuery({ text: "Complete the previous step first." });
              return;
            }
            try {
              const agent = userAgents.create(tenant.userId, {
                id: userAgents.nextId(tenant.userId, draft.name!),
                name: draft.name!,
                description: draft.description!,
                instructions: draft.instructions!,
                ...(draft.modelId ? { modelId: draft.modelId } : {}),
              });
              userAgents.setSelection(tenant.userId, tenant.chatId, tenant.threadId, agent.id);
              userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
              await telegram.answerCallbackQuery({ text: "Agent created" });
              await telegram.reply(
                `Created and selected ${agent.name} (${personalProfileId(agent.id)}) for ${scopeLabel(tenant.threadId)}.`
              );
            } catch (error) {
              await telegram.answerCallbackQuery({
                text: errorMessage(error).slice(0, 180),
                show_alert: true,
              });
            }
          },
        },
      ],
    };
  },
  async shutdown() {
    await serviceRef?.close();
    serviceRef = null;
  },
};

export type { AgentRuntime, AgentRunRequest, AgentRuntimeDeps } from "./types.js";
export { OpenAIAgentsRuntime } from "./openai.js";
export { AgentRuntimeService } from "./service.js";
export { UserAgentService } from "./userAgents.js";
