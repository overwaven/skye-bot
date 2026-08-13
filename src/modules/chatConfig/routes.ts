import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { getDb } from "../../core/db.js";
import { isVoiceReplyMode, type VoiceReplyMode } from "./service.js";

export function serializeChatConfig(mode: VoiceReplyMode): {
  voiceReplyMode: VoiceReplyMode;
  voiceMode: boolean;
} {
  return {
    voiceReplyMode: mode,
    voiceMode: mode === "always",
  };
}

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const chatConfig = ctx.services.get("chatConfig");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);
  const chatFor = (req: PanelRequest, requested: unknown): number | null => {
    const userId = req.initData.user.id;
    const chatId = Number(requested ?? userId);
    if (!Number.isSafeInteger(chatId)) return null;
    if (chatId === userId || ctx.services.get("admin").isAdmin(userId)) return chatId;
    const seen = getDb()
      .prepare<
        [number, number],
        { found: number }
      >("SELECT 1 AS found FROM request_logs WHERE user_id = ? AND chat_id = ? LIMIT 1")
      .get(userId, chatId);
    return seen ? chatId : null;
  };

  return [
    {
      method: "get",
      path: "/chat-config",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        const chatId = chatFor(panelReq, req.query.chatId);
        if (chatId === null) {
          res.status(403).json({ error: "This chat is not available to you" });
          return;
        }
        const cfg = chatConfig.get(chatId);
        res.json(serializeChatConfig(cfg.voiceReplyMode));
      },
    },
    {
      method: "put",
      path: "/chat-config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const body = req.body as {
          voiceReplyMode?: unknown;
          voiceMode?: boolean;
          chatId?: unknown;
        };
        const requestedMode: VoiceReplyMode | undefined = isVoiceReplyMode(body.voiceReplyMode)
          ? body.voiceReplyMode
          : typeof body.voiceMode === "boolean"
            ? body.voiceMode
              ? "always"
              : "text"
            : undefined;

        if (body.voiceReplyMode !== undefined && !isVoiceReplyMode(body.voiceReplyMode)) {
          res.status(400).json({ error: "voiceReplyMode must be text, auto, or always" });
          return;
        }

        const chatId = chatFor(req as PanelRequest, body.chatId);

        if (chatId !== null) {
          if (requestedMode !== undefined) {
            chatConfig.setVoiceReplyMode(chatId, requestedMode);
          }
          const cfg = chatConfig.get(chatId);
          if (requestedMode !== undefined) {
            audit()?.event({
              action: "voice_mode_changed",
              userId,
              chatId,
              details: { mode: cfg.voiceReplyMode },
            });
          }
          res.json(serializeChatConfig(cfg.voiceReplyMode));
        } else {
          res.status(403).json({ error: "This chat is not available to you" });
        }
      },
    },
  ];
}
