import type { SkyeModule } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import { InlineKeyboard, type Context } from "grammy";
import { ZodError } from "zod";
import { agentRuntimeConfigSchema } from "./config.js";
import { migrations } from "./migrations.js";
import { buildAgentRoutes } from "./routes.js";
import { AgentRuntimeService } from "./service.js";
import { isPersonalProfileId, personalProfileId, UserAgentService } from "./userAgents.js";
import { ChatAgentService, chatProfileId, isChatProfileId } from "./chatAgents.js";
import { canManageChatAgents } from "./permissions.js";
import { PERSONALITY_TEMPLATES } from "../llm/prompt.js";
import { AgentEditSessionService, type AgentEditField } from "./editSessions.js";
import {
  applyFieldValue,
  editFieldKeyboard,
  editPickKeyboard,
  fieldPrompt,
  formatAgentsList,
  formatEditEditor,
  mdCode,
} from "./editor.js";
import { agentTools } from "./tools.js";
import { sendRichEdit, sendRichReply } from "../telegram/helpers.js";

let serviceRef: AgentRuntimeService | null = null;

declare module "../../core/module.js" {
  interface SkyeServices {
    agentRuntime: AgentRuntimeService;
  }
}

function isPrivate(tenant: TenantContext): boolean {
  return tenant.chatType === "private";
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid agent data";
  if (error instanceof Error) return error.message;
  return String(error);
}

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
    const editSessions = new AgentEditSessionService(ctx.db);
    const llm = ctx.services.get("llm");
    const agentModels = llm.models.filter((model) => model.provider !== "perplexity");
    const admin = ctx.services.get("admin");
    const agentsPanelUrl = new URL(ctx.config.panel.webapp_url);
    agentsPanelUrl.searchParams.set("agents", "open");
    const agentStudioUrl = new URL(agentsPanelUrl);
    agentStudioUrl.searchParams.set("agents", "create");

    const displayIdFor = (tenant: TenantContext, storedId: string, pendingId?: string) => {
      const id = pendingId && pendingId !== storedId ? pendingId : storedId;
      return isPrivate(tenant) ? personalProfileId(id) : chatProfileId(id);
    };

    const openEditor = async (
      telegram: Context,
      tenant: TenantContext,
      session: ReturnType<AgentEditSessionService["start"]>,
      mode: "reply" | "edit" = "reply"
    ) => {
      const markdown = formatEditEditor(
        session,
        displayIdFor(tenant, session.agentId, session.pendingId)
      );
      const keyboard = editFieldKeyboard();
      if (mode === "edit" && telegram.callbackQuery?.message) {
        await sendRichEdit(telegram, markdown, keyboard);
        return;
      }
      await sendRichReply(telegram, markdown, { reply_markup: keyboard });
    };

    const beginEdit = async (
      telegram: Context,
      tenant: TenantContext,
      storedId: string,
      mode: "reply" | "edit" = "reply"
    ) => {
      if (!tenant.userId) return;
      userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
      if (isPrivate(tenant)) {
        const agent = userAgents.get(tenant.userId, storedId);
        if (!agent) {
          await sendRichReply(
            telegram,
            `Personal agent ${mdCode(personalProfileId(storedId))} does not exist.`
          );
          return;
        }
        const session = editSessions.start(tenant.userId, tenant.chatId, tenant.threadId, {
          scope: "personal",
          agentId: agent.id,
          name: agent.name,
          description: agent.description,
          instructions: agent.instructions,
          ...(agent.modelId ? { modelId: agent.modelId } : {}),
        });
        await openEditor(telegram, tenant, session, mode);
        return;
      }
      const agent = chatAgents.get(tenant.chatId, storedId);
      if (!agent) {
        await sendRichReply(
          telegram,
          `Chat agent ${mdCode(chatProfileId(storedId))} does not exist.`
        );
        return;
      }
      const session = editSessions.start(tenant.userId, tenant.chatId, tenant.threadId, {
        scope: "chat",
        agentId: agent.id,
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        ...(agent.modelId ? { modelId: agent.modelId } : {}),
      });
      await openEditor(telegram, tenant, session, mode);
    };

    const requireGroupManage = async (telegram: Context, tenant: TenantContext) => {
      const allowed = await canManageChatAgents({
        api: telegram.api,
        admin,
        chatId: tenant.chatId,
        chatType: tenant.chatType,
        userId: tenant.userId,
      });
      if (!allowed) {
        await sendRichReply(
          telegram,
          "Only Telegram group admins or bot administrators can manage agents in this chat."
        );
      }
      return allowed;
    };

    const startAgentWizard = async (telegram: Context, tenant: TenantContext) => {
      if (!tenant.userId) return;
      editSessions.clear(tenant.userId, tenant.chatId, tenant.threadId);
      userAgents.startDraft(tenant.userId, tenant.chatId, tenant.threadId);
      const kind = isPrivate(tenant) ? "personal" : "shared chat";
      await sendRichReply(
        telegram,
        [
          `## Create ${kind} agent`,
          "",
          "**Step 1 of 4** — What should I call it?",
          "",
          "For example: Research Assistant or Copywriter",
          "",
          "_Stop anytime with_ `/cancel_agent`.",
        ].join("\n"),
        { reply_markup: forceReply("Agent name") }
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
      tools: agentTools({
        userAgents,
        chatAgents,
        admin,
        maxUserAgents: maxUser,
        maxChatAgents: maxChat,
        getTelegramApi: () =>
          ctx.services.has("telegramBot") ? ctx.services.get("telegramBot").api : undefined,
      }),
      panelRoutes: buildAgentRoutes(ctx, userAgents),
      commands: [
        {
          name: "agents",
          description: "List agents for this chat",
          handler: async (telegram, tenant) => {
            const library = service.libraryFor(tenant);
            const selected = service.activeProfileFor(tenant);
            const primary =
              isPrivate(tenant) && tenant.userId ? userAgents.getPrimary(tenant.userId) : undefined;
            const templates = service.templates();
            const lines = library.map((profile) => {
              const marks = [
                profile.id === selected?.id ? "●" : "○",
                primary && profile.id === primary ? "★" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `- ${marks} **${profile.name}** (${mdCode(profile.id)}) — ${profile.description}`;
            });
            const templateLines = templates.map(
              (profile) => `- ◇ **${profile.name}** (${mdCode(profile.id)}) — _template_`
            );
            const markdown = formatAgentsList({
              activeName: selected?.name ?? "Default Skye",
              primaryName: primary
                ? (userAgents.get(tenant.userId!, primary)?.name ?? primary)
                : undefined,
              lines,
              templateLines,
              privateChat: isPrivate(tenant),
            });
            await sendRichReply(
              telegram,
              markdown,
              telegram.chat?.type === "private"
                ? {
                    reply_markup: new InlineKeyboard().webApp(
                      "Manage in Mini App",
                      agentsPanelUrl.toString()
                    ),
                  }
                : undefined
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
              await sendRichReply(
                telegram,
                `Active agent: **${selected?.name ?? "Default Skye"}**. Use /agents to see profiles.`
              );
              return;
            }

            const parts = requested.split(/\s+/);
            const head = parts[0]!.toLowerCase();

            if (head === "primary") {
              if (!isPrivate(tenant) || !tenant.userId) {
                await sendRichReply(
                  telegram,
                  "Primary agents are only available in **private chats**."
                );
                return;
              }
              const target = parts.slice(1).join(" ").trim();
              if (!target || ["default", "skye", "reset", "clear"].includes(target.toLowerCase())) {
                userAgents.setPrimary(tenant.userId, null);
                await sendRichReply(
                  telegram,
                  "Cleared your primary agent. **Default Skye** is the fallback."
                );
                return;
              }
              const profile = service.profile(target, tenant);
              if (!profile || !isPersonalProfileId(profile.id)) {
                await sendRichReply(
                  telegram,
                  `Unknown personal agent ${mdCode(target)}. Create one first, or use /agents.`
                );
                return;
              }
              userAgents.setPrimary(tenant.userId, profile.id);
              await sendRichReply(telegram, `Primary agent set to **${profile.name}**.`);
              return;
            }

            if (["default", "skye", "reset"].includes(head)) {
              if (isPrivate(tenant)) {
                if (tenant.userId) {
                  userAgents.resetSelection(tenant.userId, tenant.chatId, tenant.threadId);
                }
                const primary = tenant.userId ? userAgents.getPrimary(tenant.userId) : undefined;
                await sendRichReply(
                  telegram,
                  primary
                    ? "Cleared this chat override. Falling back to your **primary** agent."
                    : "Switched to **Default Skye**."
                );
                return;
              }
              if (!(await requireGroupManage(telegram, tenant))) return;
              chatAgents.resetSelection(tenant.chatId);
              await sendRichReply(telegram, "Switched this group to **Default Skye**.");
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
              await sendRichReply(
                telegram,
                `Unknown agent ${mdCode(requested)}. Use /agents to see profiles.`
              );
              return;
            }

            if (isPrivate(tenant)) {
              if (!isPersonalProfileId(profile.id) || !tenant.userId) {
                await sendRichReply(telegram, "Personal agents only in **private chats**.");
                return;
              }
              userAgents.setSelection(tenant.userId, tenant.chatId, tenant.threadId, profile.id);
            } else {
              if (!isChatProfileId(profile.id)) {
                await sendRichReply(
                  telegram,
                  "Only shared chat agents can be activated in **groups**."
                );
                return;
              }
              chatAgents.setSelection(tenant.chatId, profile.id);
            }
            await sendRichReply(telegram, `Switched to **${profile.name}**.`);
          },
        },
        {
          name: "my_agents",
          description: "List your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            if (!isPrivate(tenant)) {
              await sendRichReply(
                telegram,
                "Personal agents are for **private chats**. In groups, use shared /agents."
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
              return `- ${marks} **${agent.name}** (${mdCode(id)}) — ${agent.description}`;
            });
            await sendRichReply(
              telegram,
              [
                "## Your personal agents",
                "",
                ...(lines.length > 0 ? lines : ["_You have no personal agents yet._"]),
                "",
                `Limit: **${agents.length}/${maxUser}**`,
                "",
                "● active · ★ primary · Create with /create_agent.",
              ].join("\n")
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
                await sendRichReply(
                  telegram,
                  `You already have the maximum of **${maxUser}** personal agents. Delete one with /delete_agent first.`
                );
                return;
              }
              await sendRichReply(
                telegram,
                [
                  "## Create a personal agent",
                  "",
                  "Open the Mini App for the full editor, or continue here in chat.",
                ].join("\n"),
                {
                  reply_markup: new InlineKeyboard()
                    .webApp("Open agent studio", agentStudioUrl.toString())
                    .row()
                    .text("Create here in chat", "agent:create:chat"),
                }
              );
              return;
            }
            if (!(await requireGroupManage(telegram, tenant))) return;
            if (chatAgents.list(tenant.chatId).length >= maxChat) {
              await sendRichReply(
                telegram,
                `This chat already has the maximum of **${maxChat}** agents. Delete one with /delete_agent first.`
              );
              return;
            }
            await startAgentWizard(telegram, tenant);
          },
        },
        {
          name: "cancel_agent",
          description: "Cancel agent creation or editing",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const cancelledDraft = userAgents.cancelDraft(
              tenant.userId,
              tenant.chatId,
              tenant.threadId
            );
            const cancelledEdit = editSessions.clear(tenant.userId, tenant.chatId, tenant.threadId);
            await sendRichReply(
              telegram,
              cancelledDraft || cancelledEdit
                ? "_Cancelled._"
                : "_There is no agent creation or editing in progress._"
            );
          },
        },
        {
          name: "edit_agent",
          description: "Edit an agent with interactive buttons",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            if (!isPrivate(tenant) && !(await requireGroupManage(telegram, tenant))) return;
            const requested = telegram.match?.toString().trim() ?? "";
            const agents = isPrivate(tenant)
              ? userAgents.list(tenant.userId)
              : chatAgents.list(tenant.chatId);
            if (agents.length === 0) {
              await sendRichReply(
                telegram,
                "_No agents to edit yet._ Create one with /create_agent."
              );
              return;
            }
            if (requested) {
              const storedId = requested.replace(/^(my_|chat_)/, "");
              await beginEdit(telegram, tenant, storedId);
              return;
            }
            await sendRichReply(telegram, "## Edit agent\n\nChoose an agent to edit:", {
              reply_markup: editPickKeyboard(
                agents.map((agent) => ({ id: agent.id, name: agent.name }))
              ),
            });
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
              await sendRichReply(
                telegram,
                "Add the agent id, for example: `/delete_agent copywriter`"
              );
              return;
            }
            if (isPrivate(tenant)) {
              const deleted = userAgents.delete(tenant.userId, id);
              await sendRichReply(
                telegram,
                deleted
                  ? `Deleted personal agent ${mdCode(personalProfileId(id))}.`
                  : `Personal agent ${mdCode(personalProfileId(id))} does not exist.`
              );
            } else {
              const deleted = chatAgents.delete(tenant.chatId, id);
              await sendRichReply(
                telegram,
                deleted
                  ? `Deleted chat agent ${mdCode(chatProfileId(id))}.`
                  : `Chat agent ${mdCode(chatProfileId(id))} does not exist.`
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
            const text = telegram.message?.text?.trim() ?? "";
            if (text.startsWith("/")) return next();

            const editSession = editSessions.get(tenant.userId, tenant.chatId, tenant.threadId);
            if (editSession?.awaitingField) {
              const applied = applyFieldValue(editSession, editSession.awaitingField, text);
              if (!applied.ok) {
                const prompt = fieldPrompt(editSession.awaitingField);
                await sendRichReply(telegram, applied.error, {
                  reply_markup: forceReply(prompt.placeholder),
                });
                return;
              }
              const saved = editSessions.save(
                tenant.userId,
                tenant.chatId,
                tenant.threadId,
                applied.session
              );
              await openEditor(telegram, tenant, saved);
              return;
            }

            const draft = userAgents.getDraft(tenant.userId, tenant.chatId, tenant.threadId);
            if (!draft) return next();

            if (draft.step === "name") {
              if (!text || text.length > 80) {
                await sendRichReply(telegram, "Send a name between **1 and 80** characters.", {
                  reply_markup: forceReply("Agent name"),
                });
                return;
              }
              userAgents.saveDraft(tenant.userId, tenant.chatId, tenant.threadId, {
                ...draft,
                step: "description",
                name: text,
              });
              await sendRichReply(
                telegram,
                [
                  `Great — **${text}**.`,
                  "",
                  "**Step 2 of 4** — What is this agent good at?",
                  "",
                  "Write one short description.",
                ].join("\n"),
                { reply_markup: forceReply("What does this agent specialize in?") }
              );
              return;
            }

            if (draft.step === "description") {
              if (!text || text.length > 500) {
                await sendRichReply(
                  telegram,
                  "Send a description between **1 and 500** characters.",
                  { reply_markup: forceReply("Short agent description") }
                );
                return;
              }
              userAgents.saveDraft(tenant.userId, tenant.chatId, tenant.threadId, {
                ...draft,
                step: "instructions",
                description: text,
              });
              await sendRichReply(
                telegram,
                [
                  "**Step 3 of 4** — How should it work?",
                  "",
                  "Describe its role, tone, rules, and what a good answer should look like.",
                ].join("\n"),
                { reply_markup: forceReply("Detailed instructions") }
              );
              return;
            }

            if (draft.step === "instructions") {
              if (!text || text.length > 16_000) {
                await sendRichReply(
                  telegram,
                  "Send instructions between **1 and 16,000** characters.",
                  { reply_markup: forceReply("Detailed instructions") }
                );
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
              await sendRichReply(
                telegram,
                [
                  "**Step 4 of 4** — Choose a model",
                  "",
                  "Use the current chat model, or pin this agent to a specific model.",
                ].join("\n"),
                { reply_markup: keyboard }
              );
              return;
            }

            await sendRichReply(
              telegram,
              "Use the buttons above to create the agent, or /cancel_agent."
            );
          },
        },
        {
          on: "callback_query:data",
          order: 10,
          handler: async (telegram, tenant, next) => {
            const action = telegram.callbackQuery?.data;
            if (!action?.startsWith("agent:")) return next();
            if (!tenant.userId) return;

            if (action.startsWith("agent:edit:")) {
              if (!isPrivate(tenant) && !(await requireGroupManage(telegram, tenant))) {
                await telegram.answerCallbackQuery({ text: "Not allowed.", show_alert: true });
                return;
              }
              if (action === "agent:edit:cancel") {
                editSessions.clear(tenant.userId, tenant.chatId, tenant.threadId);
                await telegram.answerCallbackQuery({ text: "Cancelled" });
                if (telegram.callbackQuery?.message) {
                  await sendRichEdit(telegram, "_Editing cancelled._");
                } else {
                  await sendRichReply(telegram, "_Editing cancelled._");
                }
                return;
              }
              if (action.startsWith("agent:edit:pick:")) {
                const id = action.slice("agent:edit:pick:".length);
                await telegram.answerCallbackQuery();
                await beginEdit(telegram, tenant, id, "edit");
                return;
              }
              const session = editSessions.get(tenant.userId, tenant.chatId, tenant.threadId);
              if (!session) {
                await telegram.answerCallbackQuery({ text: "This editor has expired." });
                return;
              }
              if (action.startsWith("agent:edit:field:")) {
                const field = action.slice("agent:edit:field:".length) as AgentEditField;
                if (!["name", "description", "instructions", "id"].includes(field)) {
                  await telegram.answerCallbackQuery({ text: "Unknown field." });
                  return;
                }
                const prompt = fieldPrompt(field);
                editSessions.save(tenant.userId, tenant.chatId, tenant.threadId, {
                  ...session,
                  awaitingField: field,
                });
                await telegram.answerCallbackQuery();
                await sendRichReply(telegram, prompt.text, {
                  reply_markup: forceReply(prompt.placeholder),
                });
                return;
              }
              if (action === "agent:edit:save") {
                try {
                  let currentId = session.agentId;
                  if (session.pendingId && session.pendingId !== session.agentId) {
                    if (session.scope === "personal") {
                      userAgents.rename(tenant.userId, session.agentId, session.pendingId);
                    } else {
                      chatAgents.rename(tenant.chatId, session.agentId, session.pendingId);
                    }
                    currentId = session.pendingId;
                  }
                  if (session.scope === "personal") {
                    const agent = userAgents.update(tenant.userId, currentId, {
                      name: session.name,
                      description: session.description,
                      instructions: session.instructions,
                      ...(session.modelId ? { modelId: session.modelId } : {}),
                    });
                    editSessions.clear(tenant.userId, tenant.chatId, tenant.threadId);
                    await telegram.answerCallbackQuery({ text: "Saved" });
                    const md = `Saved **${agent.name}** (${mdCode(personalProfileId(agent.id))}).`;
                    if (telegram.callbackQuery?.message) {
                      await sendRichEdit(telegram, md);
                    } else {
                      await sendRichReply(telegram, md);
                    }
                  } else {
                    const agent = chatAgents.update(tenant.chatId, currentId, {
                      name: session.name,
                      description: session.description,
                      instructions: session.instructions,
                      ...(session.modelId ? { modelId: session.modelId } : {}),
                    });
                    editSessions.clear(tenant.userId, tenant.chatId, tenant.threadId);
                    await telegram.answerCallbackQuery({ text: "Saved" });
                    const md = `Saved **${agent.name}** (${mdCode(chatProfileId(agent.id))}).`;
                    if (telegram.callbackQuery?.message) {
                      await sendRichEdit(telegram, md);
                    } else {
                      await sendRichReply(telegram, md);
                    }
                  }
                } catch (error) {
                  await telegram.answerCallbackQuery({
                    text: errorMessage(error).slice(0, 180),
                    show_alert: true,
                  });
                }
                return;
              }
              return next();
            }

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
              await sendRichReply(telegram, "_Agent creation cancelled._");
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
              await sendRichReply(
                telegram,
                [
                  isPrivate(tenant)
                    ? "## Ready to create this personal agent"
                    : "## Ready to create this shared chat agent",
                  "",
                  `| | |`,
                  `|---|---|`,
                  `| **Name** | ${completed.name} |`,
                  `| **Specialty** | ${completed.description} |`,
                  `| **Model** | ${model?.name ?? "Current chat model"} |`,
                  "",
                  "### Instructions",
                  "",
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
                await sendRichReply(
                  telegram,
                  `Created and selected **${agent.name}** (${mdCode(personalProfileId(agent.id))}).`
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
                await sendRichReply(
                  telegram,
                  `Created and activated **${agent.name}** (${mdCode(chatProfileId(agent.id))}) for this group.`
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
