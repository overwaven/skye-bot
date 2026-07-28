import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { resolveChatNames } from "../panel/chatNames.js";
import { getDb } from "../../core/db.js";
import { MEMORY_CATEGORIES, memoryService, type MemoryCategory } from "./service.js";

function authorizedChat(userId: number, chatId: number): boolean {
  return Boolean(
    getDb()
      .prepare("SELECT 1 FROM request_logs WHERE user_id = ? AND chat_id = ? LIMIT 1")
      .get(userId, chatId)
  );
}

function validCategory(value: unknown): value is MemoryCategory {
  return MEMORY_CATEGORIES.includes(value as MemoryCategory);
}

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  return [
    {
      method: "get",
      path: "/memories",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const rows = getDb()
          .prepare<
            [number],
            { chatId: number }
          >("SELECT DISTINCT chat_id AS chatId FROM request_logs WHERE user_id = ?")
          .all(userId);
        const memories = rows.flatMap(({ chatId }) => memoryService.export(chatId));
        memories.sort((a, b) =>
          (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
        );
        const visible = memories.slice(0, 100);
        const chatNames = await resolveChatNames(
          ctx,
          visible.flatMap((memory) => (memory.chatId == null ? [] : [memory.chatId]))
        );
        res.json(
          visible.map((memory) => ({
            ...memory,
            chatName:
              memory.chatId == null
                ? "Unknown chat"
                : (chatNames.get(memory.chatId) ?? `Chat ${memory.chatId}`),
          }))
        );
      },
    },
    {
      method: "get",
      path: "/memories/export",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const rawChatId = req.query.chatId;
        const chatIds =
          rawChatId === undefined
            ? getDb()
                .prepare<[number], { chatId: number }>(
                  "SELECT DISTINCT chat_id AS chatId FROM request_logs WHERE user_id = ?"
                )
                .all(userId)
                .map((row) => row.chatId)
            : [Number(rawChatId)];
        if (
          chatIds.some((chatId) => !Number.isSafeInteger(chatId) || !authorizedChat(userId, chatId))
        ) {
          res.status(404).json({ error: "Memories not found" });
          return;
        }
        const memories = chatIds.flatMap((chatId) => memoryService.export(chatId));
        res.setHeader("Content-Disposition", `attachment; filename="skye-memory-export.json"`);
        res.json({ version: 1, exportedAt: new Date().toISOString(), memories });
      },
    },
    {
      method: "post",
      path: "/memories/import",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const body = req.body as { chatId?: unknown; memories?: unknown };
        const chatId = Number(body.chatId);
        if (!Number.isSafeInteger(chatId) || !authorizedChat(userId, chatId)) {
          res.status(404).json({ error: "Memories not found" });
          return;
        }
        if (
          !Array.isArray(body.memories) ||
          body.memories.length === 0 ||
          body.memories.length > 1_000
        ) {
          res.status(400).json({ error: "Import must contain between 1 and 1000 memories" });
          return;
        }
        try {
          const records = body.memories.map((raw) => {
            const record = raw as { content?: unknown; category?: unknown; expiresAt?: unknown };
            if (
              typeof record.content !== "string" ||
              (record.category !== undefined && !validCategory(record.category))
            ) {
              throw new Error("Each memory needs valid content and category");
            }
            return {
              content: record.content,
              category: record.category as MemoryCategory | undefined,
              expiresAt:
                record.expiresAt === null || typeof record.expiresAt === "string"
                  ? record.expiresAt
                  : undefined,
            };
          });
          const result = await memoryService.import(chatId, records);
          res.json({ ok: true, ...result });
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Invalid memory import" });
        }
      },
    },
    {
      method: "delete",
      path: "/memories/:chatId/:id",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const chatId = Number(req.params.chatId);
        if (!Number.isSafeInteger(chatId) || !authorizedChat(userId, chatId)) {
          res.status(404).json({ error: "Memory not found" });
          return;
        }
        const deleted = await memoryService.delete(chatId, String(req.params.id));
        if (!deleted) {
          res.status(404).json({ error: "Memory not found" });
          return;
        }
        res.json({ ok: true });
      },
    },
    {
      method: "delete",
      path: "/memories/:chatId",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const chatId = Number(req.params.chatId);
        if (!Number.isSafeInteger(chatId) || !authorizedChat(userId, chatId)) {
          res.status(404).json({ error: "Memories not found" });
          return;
        }
        await memoryService.clear(chatId);
        res.json({ ok: true });
      },
    },
  ];
}
