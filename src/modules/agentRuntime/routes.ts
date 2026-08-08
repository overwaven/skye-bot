import { ZodError } from "zod";
import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import type { UserAgentInput, UserAgentRecord, UserAgentService } from "./userAgents.js";
import { personalProfileId } from "./userAgents.js";
import { PERSONALITY_TEMPLATES } from "../llm/prompt.js";

function serialize(agent: UserAgentRecord) {
  return {
    id: personalProfileId(agent.id),
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    modelId: agent.modelId ?? null,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function errorText(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid agent data";
  if (error instanceof Error) return error.message;
  return String(error);
}

export function buildAgentRoutes(ctx: ModuleContext, userAgents: UserAgentService): PanelRoute[] {
  const llm = ctx.services.get("llm");
  const models = llm.models.filter((model) => model.provider !== "perplexity");
  const modelIds = new Set(models.map((model) => model.id));
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);

  const parseInput = (body: unknown): Omit<UserAgentInput, "id"> => {
    const value = (body ?? {}) as Record<string, unknown>;
    const modelId = typeof value.modelId === "string" && value.modelId ? value.modelId : undefined;
    if (modelId && !modelIds.has(modelId)) throw new Error("Unknown or unsupported agent model");
    return {
      name: typeof value.name === "string" ? value.name.trim() : "",
      description: typeof value.description === "string" ? value.description.trim() : "",
      instructions: typeof value.instructions === "string" ? value.instructions.trim() : "",
      ...(modelId ? { modelId } : {}),
    };
  };

  return [
    {
      method: "get",
      path: "/agents",
      handler: (req, res) => {
        const tenant = (req as PanelRequest).tenant;
        const userId = tenant.userId!;
        const activeAgentId =
          userAgents.getSelection(userId, tenant.chatId, tenant.threadId) ??
          userAgents.getPrimary(userId) ??
          null;
        res.json({
          agents: userAgents.list(userId).map(serialize),
          activeAgentId,
          primaryAgentId: userAgents.getPrimary(userId) ?? null,
          maxAgents: ctx.config.agent_runtime.max_user_agents,
          models: models.map((model) => ({
            id: model.id,
            name: model.name,
            multiplier: model.multiplier,
          })),
          templates: [
            ...PERSONALITY_TEMPLATES.map((template) => ({
              id: template.id,
              name: template.name,
              description: template.description,
              instructions: template.instructions,
            })),
            ...ctx.config.agent_runtime.agents
              .filter((agent) => agent.enabled)
              .map((agent) => ({
                id: agent.id,
                name: agent.name,
                description: agent.description,
                instructions: agent.instructions,
              })),
          ],
        });
      },
    },
    {
      method: "post",
      path: "/agents",
      handler: (req, res) => {
        const tenant = (req as PanelRequest).tenant;
        const userId = tenant.userId!;
        try {
          const input = parseInput(req.body);
          const agent = userAgents.create(userId, {
            id: userAgents.nextId(userId, input.name),
            ...input,
          });
          audit()?.event({
            action: "personal_agent_created",
            userId,
            details: { agentId: agent.id, modelId: agent.modelId ?? null },
          });
          res.status(201).json(serialize(agent));
        } catch (error) {
          res.status(400).json({ error: errorText(error) });
        }
      },
    },
    {
      method: "put",
      path: "/agents/selection",
      handler: (req, res) => {
        const tenant = (req as PanelRequest).tenant;
        const userId = tenant.userId!;
        const agentId = (req.body as { agentId?: unknown } | undefined)?.agentId;
        try {
          if (agentId === null || agentId === "") {
            userAgents.resetSelection(userId, tenant.chatId, tenant.threadId);
          } else if (typeof agentId === "string") {
            userAgents.setSelection(userId, tenant.chatId, tenant.threadId, agentId);
          } else {
            throw new Error("agentId must be a string or null");
          }
          audit()?.event({
            action: "personal_agent_selected",
            userId,
            details: { agentId: agentId || null, source: "panel" },
          });
          const activeAgentId =
            userAgents.getSelection(userId, tenant.chatId, tenant.threadId) ??
            userAgents.getPrimary(userId) ??
            null;
          res.json({ ok: true, activeAgentId });
        } catch (error) {
          res.status(400).json({ error: errorText(error) });
        }
      },
    },
    {
      method: "put",
      path: "/agents/primary",
      handler: (req, res) => {
        const tenant = (req as PanelRequest).tenant;
        const userId = tenant.userId!;
        const agentId = (req.body as { agentId?: unknown } | undefined)?.agentId;
        try {
          if (agentId === null || agentId === "") {
            userAgents.setPrimary(userId, null);
          } else if (typeof agentId === "string") {
            userAgents.setPrimary(userId, agentId);
          } else {
            throw new Error("agentId must be a string or null");
          }
          audit()?.event({
            action: "personal_agent_primary_set",
            userId,
            details: { agentId: agentId || null, source: "panel" },
          });
          res.json({ ok: true, primaryAgentId: userAgents.getPrimary(userId) ?? null });
        } catch (error) {
          res.status(400).json({ error: errorText(error) });
        }
      },
    },
    {
      method: "put",
      path: "/agents/:id",
      handler: (req, res) => {
        const tenant = (req as PanelRequest).tenant;
        const userId = tenant.userId!;
        try {
          const agent = userAgents.update(userId, String(req.params.id), parseInput(req.body));
          audit()?.event({
            action: "personal_agent_updated",
            userId,
            details: { agentId: agent.id, modelId: agent.modelId ?? null },
          });
          res.json(serialize(agent));
        } catch (error) {
          res.status(400).json({ error: errorText(error) });
        }
      },
    },
    {
      method: "delete",
      path: "/agents/:id",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const id = String(req.params.id);
        if (!userAgents.delete(userId, id)) {
          res.status(404).json({ error: "Personal agent not found" });
          return;
        }
        audit()?.event({ action: "personal_agent_deleted", userId, details: { agentId: id } });
        res.json({ ok: true });
      },
    },
  ];
}
