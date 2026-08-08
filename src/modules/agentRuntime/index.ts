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
import { ChatAgentService, chatProfileId, isChatProfileId } from "./chatAgents.js";
import { canManageChatAgents } from "./permissions.js";
import { PERSONALITY_TEMPLATES } from "../llm/prompt.js";

let serviceRef: AgentRuntimeService | null = null;

declare module "../../core/module.js" {
  interface SkyeServices {
    agentRuntime: AgentRuntimeService;
  }
}

function isPrivate(tenant: TenantContext): boolean {
  return tenant.chatType === "private";
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
  "/edit_agent copywriter | Copywriter | Writes polished marketing copy | Ask about the audience and produce concise copy.",
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
    const maxUser = ctx.config.agent_runtime.max_user_agents;
    const maxChat = ctx.config.agent_runtime.max_chat_agents;
    const userAgents = new UserAgentService(ctx.db, maxUser);
    const chatAgents = new ChatAgentService(ctx.db, maxChat);
    const llm = ctx.services.get("llm");
    const agentModels = llm.models.filter((model) => model.provider !== "perplexity");
    const admin = ctx.services.get("admin");
    const agentsPanelUrl = new URL(ctx.config.panel.webapp_url);
    agentsPanelUrl.searchParams.set("agents", "open");
    const agentStudioUrl = new URL(agentsPanelUrl);
    agentStudioUrl.searchParams.set("agents", "create");

    const requireGroupManage = async (telegram: Context, tenant: TenantContext) => {
      const allowed = await canManageChatAgents({
        api: telegram.api,
        admin,
        chatId: tenant.chatId,
        chatType: tenant.chatType,
        userId: tenant.userId,
      });
      if (!allowed) {
        await telegram.reply(
          "Only Telegram group admins or bot administrators can manage agents in this chat.",
          { reply_to_message_id: telegram.message?.message_id }
        );
      }
      return allowed;
    };

    const startAgentWizard = async (telegram: Context, tenant: TenantContext) => {
      if (!tenant.userId) return;
      userAgents.startDraft(tenant.userId, tenant.chatId, tenant.threadId);
      const kind = isPrivate(tenant) ? "personal" : "shared chat";
      await telegram.reply(
        [
          `Let's create a ${kind} agent.`,
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
        chatAgents,
      },
      ctx.config.agent_runtime
    );
    serviceRef = service;

    return {
      service,
      panelRoutes: buildAgentRoutes(ctx, userAgents),
      commands: [
        {
          name: "agents",
          description: "List agents for this chat",
          handler: async (telegram, tenant) => {
            const library = service.libraryFor(tenant);
            const selected = service.activeProfileFor(tenant);
            const primary =
              isPrivate(tenant) && tenant.userId
                ? userAgents.getPrimary(tenant.userId)
                : undefined;
            const templates = service.templates();
            const lines = library.map((profile) => {
              const marks = [
                profile.id === selected?.id ? "●" : "○",
                primary && profile.id === primary ? "★" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `${marks} ${profile.name} (${profile.id}) — ${profile.description}`;
            });
            const templateLines = templates.map(
              (profile) => `◇ ${profile.name} (${profile.id}) — template`
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
                `Active: ${selected?.name ?? "Default Skye"}`,
                ...(primary
                  ? [`Primary: ${userAgents.get(tenant.userId!, primary)?.name ?? primary}`]
                  : isPrivate(tenant)
                    ? ["Primary: Default Skye"]
                    : []),
                "",
                ...(lines.length > 0 ? lines : ["No agents in this library yet."]),
                ...(templateLines.length > 0
                  ? ["", "Templates (install with /agent <id>):", ...templateLines]
                  : []),
                "",
                isPrivate(tenant)
                  ? "Switch with /agent <id>. Set primary with /agent primary <id>. Reset override with /agent default."
                  : "Admins: switch with /agent <id>, or /agent default for built-in Skye.",
              ].join("\n"),
              options
            );
          },
        },
        {
          name: "agent",
          description: "Switch or set the active agent",
          handler: async (telegram, tenant) => {
            const requested = telegram.match?.toString().trim() ?? "";
            if (!requested) {
              const selected = service.activeProfileFor(tenant);
              await telegram.reply(
                `Active agent: ${selected?.name ?? "Default Skye"}. Use /agents to see profiles.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
              return;
            }

            const parts = requested.split(/\s+/);
            const head = parts[0]!.toLowerCase();

            if (head === "primary") {
              if (!isPrivate(tenant) || !tenant.userId) {
                await telegram.reply("Primary agents are only available in private chats.", {
                  reply_to_message_id: telegram.message?.message_id,
                });
                return;
              }
              const target = parts.slice(1).join(" ").trim();
              if (!target || ["default", "skye", "reset", "clear"].includes(target.toLowerCase())) {
                userAgents.setPrimary(tenant.userId, null);
                await telegram.reply("Cleared your primary agent. Default Skye is the fallback.", {
                  reply_to_message_id: telegram.message?.message_id,
                });
                return;
              }
              const profile = service.profile(target, tenant);
              if (!profile || !isPersonalProfileId(profile.id)) {
                await telegram.reply(
                  `Unknown personal agent "${target}". Create one first, or use /agents.`,
                  { reply_to_message_id: telegram.message?.message_id }
                );
                return;
              }
              userAgents.setPrimary(tenant.userId, profile.id);
              await telegram.reply(`Primary agent set to ${profile.name}.`, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }

            if (["default", "skye", "reset"].includes(head)) {
              if (isPrivate(tenant)) {
                if (tenant.userId) {
                  userAgents.resetSelection(tenant.userId, tenant.chatId, tenant.threadId);
                }
                const primary = tenant.userId ? userAgents.getPrimary(tenant.userId) : undefined;
                await telegram.reply(
                  primary
                    ? `Cleared this chat override. Falling back to your primary agent.`
                    : `Switched to Default Skye.`,
                  { reply_to_message_id: telegram.message?.message_id }
                );
                return;
              }
              if (!(await requireGroupManage(telegram, tenant))) return;
              chatAgents.resetSelection(tenant.chatId);
              await telegram.reply("Switched this group to Default Skye.", {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }

            if (!isPrivate(tenant) && !(await requireGroupManage(telegram, tenant))) return;

            let profile = service.profile(requested, tenant);
            const template = service.templates().find((item) => item.id === requested);
            const personality = PERSONALITY_TEMPLATES.find(
              (item) => item.id === requested || item.id === requested.replace(/\./g, "_")
            );

            if (!profile && (template || personality)) {
              const source = template ?? {
                id: personality!.id,
                name: personality!.name,
                description: personality!.description,
                instructions: personality!.instructions,
                enabled: true,
              };
              if (isPrivate(tenant)) {
                if (!tenant.userId) return;
                const agent = userAgents.installFromTemplate(tenant.userId, source, {
                  setSelection: { chatId: tenant.chatId, threadId: tenant.threadId },
                });
                profile = {
                  id: personalProfileId(agent.id),
                  name: agent.name,
                  description: agent.description,
                  instructions: agent.instructions,
                  enabled: true,
                  ...(agent.modelId ? { model_id: agent.modelId } : {}),
                };
              } else {
                const agent = chatAgents.installFromTemplate(tenant.chatId, source);
                profile = {
                  id: chatProfileId(agent.id),
                  name: agent.name,
                  description: agent.description,
                  instructions: agent.instructions,
                  enabled: true,
                  ...(agent.modelId ? { model_id: agent.modelId } : {}),
                };
              }
            }

            if (!profile) {
              await telegram.reply(`Unknown agent "${requested}". Use /agents to see profiles.`, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }

            if (isPrivate(tenant)) {
              if (!isPersonalProfileId(profile.id) || !tenant.userId) {
                await telegram.reply("Personal agents only in private chats.", {
                  reply_to_message_id: telegram.message?.message_id,
                });
                return;
              }
              userAgents.setSelection(tenant.userId, tenant.chatId, tenant.threadId, profile.id);
            } else {
              if (!isChatProfileId(profile.id)) {
                await telegram.reply("Only shared chat agents can be activated in groups.", {
                  reply_to_message_id: telegram.message?.message_id,
                });
                return;
              }
              chatAgents.setSelection(tenant.chatId, profile.id);
            }
            await telegram.reply(`Switched to ${profile.name}.`, {
              reply_to_message_id: telegram.message?.message_id,
            });
          },
        },
        {
          name: "my_agents",
          description: "List your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            if (!isPrivate(tenant)) {
              await telegram.reply(
                "Personal agents are for private chats. In groups, use shared /agents.",
                { reply_to_message_id: telegram.message?.message_id }
              );
              return;
            }
            const agents = userAgents.list(tenant.userId);
            const active = service.activeProfileFor(tenant)?.id;
            const primary = userAgents.getPrimary(tenant.userId);
            const lines = agents.map((agent) => {
              const id = personalProfileId(agent.id);
              const marks = [id === active ? "●" : "○", primary === id ? "★" : ""]
                .filter(Boolean)
                .join(" ");
              return `${marks} ${agent.name} (${id}) — ${agent.description}`;
            });
            await telegram.reply(
              [
                ...(lines.length > 0 ? lines : ["You have no personal agents yet."]),
                "",
                `Limit: ${agents.length}/${maxUser}`,
                "● active · ★ primary · Create with /create_agent.",
              ].join("\n"),
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
        {
          name: "create_agent",
          description: "Create an agent for this chat",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            if (isPrivate(tenant)) {
              const count = userAgents.list(tenant.userId).length;
              if (count >= maxUser) {
                await telegram.reply(
                  `You already have the maximum of ${maxUser} personal agents. Delete one with /delete_agent first.`,
                  { reply_to_message_id: telegram.message?.message_id }
                );
                return;
              }
              await telegram.reply("Create and manage personal agents in the Mini App.", {
                reply_to_message_id: telegram.message?.message_id,
                reply_markup: new InlineKeyboard()
                  .webApp("Open agent studio", agentStudioUrl.toString())
                  .row()
                  .text("Create here in chat", "agent:create:chat"),
              });
              return;
            }
            if (!(await requireGroupManage(telegram, tenant))) return;
            if (chatAgents.list(tenant.chatId).length >= maxChat) {
              await telegram.reply(
                `This chat already has the maximum of ${maxChat} agents. Delete one with /delete_agent first.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
              return;
            }
            await startAgentWizard(telegram, tenant);
          },
        },
        {
          name: "cancel_agent",
          description: "Cancel agent creation",
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
          description: "Edit an agent in this chat",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            if (!isPrivate(tenant) && !(await requireGroupManage(telegram, tenant))) return;
            const form = parseAgentForm(telegram.match?.toString().trim() ?? "");
            if (!form) {
              await telegram.reply(editAgentHelp, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            try {
              if (isPrivate(tenant)) {
                const existing = userAgents.get(tenant.userId, form.id);
                const agent = userAgents.update(tenant.userId, form.id, {
                  name: form.name,
                  description: form.description,
                  instructions: form.instructions,
                  ...(existing?.modelId ? { modelId: existing.modelId } : {}),
                });
                await telegram.reply(
                  `Updated personal agent ${agent.name} (${personalProfileId(agent.id)}).`,
                  { reply_to_message_id: telegram.message?.message_id }
                );
              } else {
                const existing = chatAgents.get(tenant.chatId, form.id);
                const agent = chatAgents.update(tenant.chatId, form.id, {
                  name: form.name,
                  description: form.description,
                  instructions: form.instructions,
                  ...(existing?.modelId ? { modelId: existing.modelId } : {}),
                });
                await telegram.reply(
                  `Updated chat agent ${agent.name} (${chatProfileId(agent.id)}).`,
                  { reply_to_message_id: telegram.message?.message_id }
                );
              }
            } catch (error) {
              await telegram.reply(`Could not update agent: ${errorMessage(error)}`, {
                reply_to_message_id: telegram.message?.message_id,
              });
            }
          },
        },
        {
          name: "delete_agent",
          description: "Delete an agent in this chat",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            if (!isPrivate(tenant) && !(await requireGroupManage(telegram, tenant))) return;
            const id = telegram.match?.toString().trim() ?? "";
            if (!id) {
              await telegram.reply("Add the agent id, for example: /delete_agent copywriter", {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            if (isPrivate(tenant)) {
              const deleted = userAgents.delete(tenant.userId, id);
              await telegram.reply(
                deleted
                  ? `Deleted personal agent ${personalProfileId(id)}.`
                  : `Personal agent ${personalProfileId(id)} does not exist.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
            } else {
              const deleted = chatAgents.delete(tenant.chatId, id);
              await telegram.reply(
                deleted
                  ? `Deleted chat agent ${chatProfileId(id)}.`
                  : `Chat agent ${chatProfileId(id)} does not exist.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
            }
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
                  "Write one short description.",
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
                  "Describe its role, tone, rules, and what a good answer should look like.",
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
                  "Use the current chat model, or pin this agent to a specific model.",
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
              if (!isPrivate(tenant) && !(await requireGroupManage(telegram, tenant))) {
                await telegram.answerCallbackQuery({ text: "Not allowed.", show_alert: true });
                return;
              }
              const atLimit = isPrivate(tenant)
                ? userAgents.list(tenant.userId).length >= maxUser
                : chatAgents.list(tenant.chatId).length >= maxChat;
              if (atLimit) {
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
                  isPrivate(tenant)
                    ? "Ready to create this personal agent:"
                    : "Ready to create this shared chat agent:",
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
            if (!isPrivate(tenant) && !(await requireGroupManage(telegram, tenant))) {
              await telegram.answerCallbackQuery({ text: "Not allowed.", show_alert: true });
              return;
            }
            try {
              if (isPrivate(tenant)) {
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
                  `Created and selected ${agent.name} (${personalProfileId(agent.id)}).`
                );
              } else {
                const agent = chatAgents.create(tenant.chatId, {
                  id: chatAgents.nextId(tenant.chatId, draft.name!),
                  name: draft.name!,
                  description: draft.description!,
                  instructions: draft.instructions!,
                  ...(draft.modelId ? { modelId: draft.modelId } : {}),
                });
                chatAgents.setSelection(tenant.chatId, agent.id);
                userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
                await telegram.answerCallbackQuery({ text: "Agent created" });
                await telegram.reply(
                  `Created and activated ${agent.name} (${chatProfileId(agent.id)}) for this group.`
                );
              }
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
export { ChatAgentService } from "./chatAgents.js";
