import type { ToolDefinition } from "../../core/module.js";
import type { StickersService, ChatSticker } from "./service.js";

export interface PreparedStickerMessage {
  sticker: ChatSticker;
}

interface SendStickerToolOptions {
  stickers: StickersService;
  onPrepared: (message: PreparedStickerMessage) => Promise<void> | void;
  maxPerResponse?: number;
}

export function formatStickerCatalog(stickers: ChatSticker[]): string {
  if (stickers.length === 0) return "No stickers saved for this chat yet.";
  return stickers
    .map((s) => {
      const meta = [s.emoji, s.setName ? `set:${s.setName}` : null].filter(Boolean).join(", ");
      return `- [${s.id}] ${s.description}${meta ? ` (${meta})` : ""}`;
    })
    .join("\n");
}

export function createSendStickerTool(options: SendStickerToolOptions): ToolDefinition {
  const maxPerResponse = options.maxPerResponse ?? 3;
  let prepared = 0;

  return {
    name: "send_sticker",
    timeoutMs: 5_000,
    terminal: true,
    description:
      "Send one sticker from this chat's saved sticker catalog. Use it to react with mood, humor, or vibe when a sticker fits better than (or alongside) text. Pick by sticker_id from the catalog in your instructions or from list_stickers. After a successful call, do not describe the sticker in text unless extra context is genuinely useful. You may send up to a few stickers per response when they form a clear sequence.",
    parameters: {
      type: "object",
      properties: {
        sticker_id: {
          type: "string",
          description:
            "ID of a sticker from this chat's catalog (see list_stickers / system prompt).",
        },
      },
      required: ["sticker_id"],
      additionalProperties: false,
    },
    execute: async (args, tenant) => {
      if (prepared >= maxPerResponse) {
        return `Already prepared ${maxPerResponse} stickers for this response.`;
      }
      const id = String(args.sticker_id ?? "").trim();
      if (!id) return "Error: sticker_id is required.";
      const sticker = options.stickers.get(tenant.chatId, id);
      if (!sticker) {
        const catalog = formatStickerCatalog(options.stickers.list(tenant.chatId));
        return `Sticker "${id}" not found in this chat.\nAvailable stickers:\n${catalog}`;
      }
      prepared += 1;
      await options.onPrepared({ sticker });
      return `Sticker prepared: [${sticker.id}] ${sticker.description}. Do not narrate sending it.`;
    },
  };
}

export function stickerCatalogTools(service: StickersService): ToolDefinition[] {
  return [
    {
      name: "list_stickers",
      readOnly: true,
      timeoutMs: 5_000,
      description:
        "List stickers saved for this chat (id + description). Use before send_sticker when you need a refresher on available reactions.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (_args, tenant) => formatStickerCatalog(service.list(tenant.chatId)),
    },
    {
      name: "forget_sticker",
      description:
        "Remove a sticker from this chat's catalog by id. Use when the user asks to delete or forget a saved sticker.",
      parameters: {
        type: "object",
        properties: {
          sticker_id: {
            type: "string",
            description: "ID of the sticker to remove.",
          },
        },
        required: ["sticker_id"],
        additionalProperties: false,
      },
      execute: async (args, tenant) => {
        const id = String(args.sticker_id ?? "").trim();
        if (!id) return "Error: sticker_id is required.";
        const ok = service.delete(tenant.chatId, id);
        return ok ? `Sticker ${id} removed from this chat.` : `Sticker ${id} not found.`;
      },
    },
  ];
}
