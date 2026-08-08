import type { Api } from "grammy";
import type { ToolDefinition } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import type { AdminService } from "../admin/service.js";
import type { ChatAgentService } from "./chatAgents.js";
import { chatProfileId, isChatProfileId } from "./chatAgents.js";
import { canManageChatAgents } from "./permissions.js";
import type { UserAgentService } from "./userAgents.js";
import { personalProfileId, isPersonalProfileId } from "./userAgents.js";

export interface AgentToolsDeps {
  userAgents: UserAgentService;
  chatAgents: ChatAgentService;
  admin: AdminService;
  maxUserAgents: number;
  maxChatAgents: number;
  getTelegramApi: () => Api | undefined;
}

function isPrivate(tenant: TenantContext): boolean {
  return tenant.chatType === "private";
}

async function assertCanManage(deps: AgentToolsDeps, tenant: TenantContext): Promise<string | null> {
  if (!tenant.userId) return "Error: a Telegram user account is required.";
  if (isPrivate(tenant)) return null;
  const api = deps.getTelegramApi();
  if (!api) {
    return deps.admin.isAdmin(tenant.userId)
      ? null
      : "Error: only bot administrators can manage group agents right now.";
  }
  const allowed = await canManageChatAgents({
    api,
    admin: deps.admin,
    chatId: tenant.chatId,
    chatType: tenant.chatType,
    userId: tenant.userId,
  });
  return allowed
    ? null
    : "Error: only Telegram group admins or bot administrators can manage agents in this chat.";
}

function normalizeStoredId(id: string): string {
  if (isPersonalProfileId(id)) return id.slice("my_".length);
  if (isChatProfileId(id)) return id.slice("chat_".length);
  return id;
}

function formatAgentLine(id: string, name: string, description: string, marks: string[]): string {
  const prefix = marks.length > 0 ? `${marks.join(" ")} ` : "";
  return `${prefix}${name} (${id}) — ${description}`;
}

export function agentTools(deps: AgentToolsDeps): ToolDefinition[] {
  return [
    {
      name: "list_agents",
      readOnly: true,
      timeoutMs: 5_000,
      description:
        "List agents available in the current chat. In private chats this is the user's personal library (with primary/active marks). In groups this is the shared chat agent library. Use before creating or updating an agent.",
      parameters: { type: "object", properties: {} },
      execute: async (_args, tenant) => {
        if (isPrivate(tenant)) {
          if (!tenant.userId) return "Error: a Telegram user account is required.";
          const agents = deps.userAgents.list(tenant.userId);
          const primary = deps.userAgents.getPrimary(tenant.userId);
          const active = deps.userAgents.getSelection(
            tenant.userId,
            tenant.chatId,
            tenant.threadId
          );
          if (agents.length === 0) {
            return "No personal agents yet. Use create_agent to add one.";
          }
          const lines = agents.map((agent) => {
            const id = personalProfileId(agent.id);
            const marks = [
              active === id || (!active && primary === id) ? "active" : "",
              primary === id ? "primary" : "",
            ].filter(Boolean);
            return formatAgentLine(id, agent.name, agent.description, marks);
          });
          return `Personal agents (${agents.length}/${deps.maxUserAgents}):\n${lines.join("\n")}`;
        }
        const agents = deps.chatAgents.list(tenant.chatId);
        const active = deps.chatAgents.getSelection(tenant.chatId);
        if (agents.length === 0) {
          return "No shared chat agents yet. Use create_agent to add one (admins only).";
        }
        const lines = agents.map((agent) => {
          const id = chatProfileId(agent.id);
          return formatAgentLine(id, agent.name, agent.description, active === id ? ["active"] : []);
        });
        return `Shared chat agents (${agents.length}/${deps.maxChatAgents}):\n${lines.join("\n")}`;
      },
    },
    {
      name: "create_agent",
      description:
        "Create an agent in the current chat library. In private chats creates a personal agent for the user. In groups creates a shared chat agent (admins only). Optionally activate it and, in DMs, set it as the user's primary agent.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Display name (1–80 characters).",
          },
          description: {
            type: "string",
            description: "Short specialty summary (1–500 characters).",
          },
          instructions: {
            type: "string",
            description: "Full operating instructions / character prompt (1–16000 characters).",
          },
          id: {
            type: "string",
            description:
              "Optional lowercase id (letters, numbers, _ or -). Auto-generated from the name when omitted.",
          },
          activate: {
            type: "boolean",
            description: "If true, make this the active agent for the current chat. Default false.",
          },
          set_primary: {
            type: "boolean",
            description:
              "Private chats only. If true, set this agent as the user's primary agent. Default false.",
          },
        },
        required: ["name", "description", "instructions"],
      },
      execute: async (args, tenant) => {
        const denied = await assertCanManage(deps, tenant);
        if (denied) return denied;
        const name = String(args.name ?? "").trim();
        const description = String(args.description ?? "").trim();
        const instructions = String(args.instructions ?? "").trim();
        const requestedId = typeof args.id === "string" ? normalizeStoredId(args.id.trim()) : "";
        const activate = args.activate === true;
        const setPrimary = args.set_primary === true;
        if (!name || !description || !instructions) {
          return "Error: name, description, and instructions are required.";
        }
        try {
          if (isPrivate(tenant)) {
            const userId = tenant.userId!;
            const id = requestedId || deps.userAgents.nextId(userId, name);
            const agent = deps.userAgents.create(userId, {
              id,
              name,
              description,
              instructions,
            });
            if (activate) {
              deps.userAgents.setSelection(userId, tenant.chatId, tenant.threadId, agent.id);
            }
            if (setPrimary) deps.userAgents.setPrimary(userId, agent.id);
            const flags = [
              activate ? "activated for this chat" : "",
              setPrimary ? "set as primary" : "",
            ]
              .filter(Boolean)
              .join("; ");
            return `Created personal agent ${agent.name} (${personalProfileId(agent.id)})${flags ? ` — ${flags}` : ""}.`;
          }
          const id = requestedId || deps.chatAgents.nextId(tenant.chatId, name);
          const agent = deps.chatAgents.create(tenant.chatId, {
            id,
            name,
            description,
            instructions,
          });
          if (activate) deps.chatAgents.setSelection(tenant.chatId, agent.id);
          return `Created shared chat agent ${agent.name} (${chatProfileId(agent.id)})${activate ? " and activated it for this group" : ""}.`;
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: "update_agent",
      description:
        "Update an existing agent in the current chat library. Pass only the fields that should change. In groups this requires admin rights.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Agent id to update (with or without my_/chat_ prefix).",
          },
          name: { type: "string", description: "New display name." },
          description: { type: "string", description: "New short description." },
          instructions: { type: "string", description: "New full instructions." },
          new_id: {
            type: "string",
            description: "Optional new id (renames the agent).",
          },
        },
        required: ["agent_id"],
      },
      execute: async (args, tenant) => {
        const denied = await assertCanManage(deps, tenant);
        if (denied) return denied;
        const agentId = normalizeStoredId(String(args.agent_id ?? "").trim());
        if (!agentId) return "Error: agent_id is required.";
        const patch = {
          ...(typeof args.name === "string" ? { name: args.name.trim() } : {}),
          ...(typeof args.description === "string"
            ? { description: args.description.trim() }
            : {}),
          ...(typeof args.instructions === "string"
            ? { instructions: args.instructions.trim() }
            : {}),
        };
        const newId =
          typeof args.new_id === "string" && args.new_id.trim()
            ? normalizeStoredId(args.new_id.trim())
            : undefined;
        if (!patch.name && !patch.description && !patch.instructions && !newId) {
          return "Error: provide at least one of name, description, instructions, or new_id.";
        }
        try {
          if (isPrivate(tenant)) {
            const userId = tenant.userId!;
            const existing = deps.userAgents.get(userId, agentId);
            if (!existing) {
              return `Error: personal agent ${personalProfileId(agentId)} not found.`;
            }
            let currentId = existing.id;
            if (newId && newId !== currentId) {
              deps.userAgents.rename(userId, currentId, newId);
              currentId = newId;
            }
            const agent = deps.userAgents.update(userId, currentId, {
              name: patch.name ?? existing.name,
              description: patch.description ?? existing.description,
              instructions: patch.instructions ?? existing.instructions,
              ...(existing.modelId ? { modelId: existing.modelId } : {}),
            });
            return `Updated personal agent ${agent.name} (${personalProfileId(agent.id)}).`;
          }
          const existing = deps.chatAgents.get(tenant.chatId, agentId);
          if (!existing) {
            return `Error: chat agent ${chatProfileId(agentId)} not found.`;
          }
          let currentId = existing.id;
          if (newId && newId !== currentId) {
            deps.chatAgents.rename(tenant.chatId, currentId, newId);
            currentId = newId;
          }
          const agent = deps.chatAgents.update(tenant.chatId, currentId, {
            name: patch.name ?? existing.name,
            description: patch.description ?? existing.description,
            instructions: patch.instructions ?? existing.instructions,
            ...(existing.modelId ? { modelId: existing.modelId } : {}),
          });
          return `Updated shared chat agent ${agent.name} (${chatProfileId(agent.id)}).`;
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: "delete_agent",
      description:
        "Delete an agent from the current chat library. In groups this requires admin rights.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Agent id to delete (with or without my_/chat_ prefix).",
          },
        },
        required: ["agent_id"],
      },
      execute: async (args, tenant) => {
        const denied = await assertCanManage(deps, tenant);
        if (denied) return denied;
        const agentId = normalizeStoredId(String(args.agent_id ?? "").trim());
        if (!agentId) return "Error: agent_id is required.";
        if (isPrivate(tenant)) {
          const deleted = deps.userAgents.delete(tenant.userId!, agentId);
          return deleted
            ? `Deleted personal agent ${personalProfileId(agentId)}.`
            : `Error: personal agent ${personalProfileId(agentId)} not found.`;
        }
        const deleted = deps.chatAgents.delete(tenant.chatId, agentId);
        return deleted
          ? `Deleted shared chat agent ${chatProfileId(agentId)}.`
          : `Error: chat agent ${chatProfileId(agentId)} not found.`;
      },
    },
  ];
}
