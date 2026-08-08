import type { Bot } from "grammy";
import type { ToolDefinition } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import type { AdminService } from "../admin/service.js";
import type { ChannelService } from "./service.js";
import { resolveChannelChatId } from "./config.js";
import { editRichChatMessage, sendRichChatMessage } from "../telegram/helpers.js";

export interface ChannelToolDeps {
  service: ChannelService;
  admin: AdminService;
  /** Lazily resolved bot instance — available after telegram init(). */
  getBot: () => Bot | undefined;
  /** Resolved target chat id (numeric or @username) or undefined if unconfigured. */
  getChatId: () => ReturnType<typeof resolveChannelChatId>;
  adminOnly: boolean;
  enabled: boolean;
}

function assertConfigured(deps: ChannelToolDeps): string | null {
  if (!deps.enabled) return "Channel management is disabled.";
  const chatId = deps.getChatId();
  if (chatId === undefined) return "No channel is configured. Set CHANNEL_CHAT_ID in config.yaml.";
  return null;
}

function assertAuthorized(deps: ChannelToolDeps, tenant: TenantContext): string | null {
  if (!deps.adminOnly) return null;
  if (!deps.admin.isAdmin(tenant.userId)) {
    return "Only bot administrators can manage the channel.";
  }
  return null;
}

function summarizePost(post: ReturnType<ChannelService["get"]>): string {
  if (!post) return "(missing)";
  const parts: string[] = [`#${post.messageId}`];
  if (post.sender) parts.push(`by ${post.sender}`);
  if (post.text) parts.push(`— ${post.text.slice(0, 120)}`);
  else if (post.mediaCaption)
    parts.push(`— [${post.mediaType ?? "media"}] ${post.mediaCaption.slice(0, 120)}`);
  else if (post.mediaType) parts.push(`— [${post.mediaType}]`);
  return parts.join(" ");
}

export function channelTools(deps: ChannelToolDeps): ToolDefinition[] {
  return [
    {
      name: "post_to_channel",
      description:
        "Post a message to the managed channel. Use this when the user asks you to publish, post, or share something to the channel. The text may use Telegram rich Markdown. Returns the new message id on success.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The message body to post. Telegram rich Markdown is supported.",
          },
          disable_notification: {
            type: "boolean",
            description: "Send silently (no notification to subscribers). Default false.",
          },
        },
        required: ["text"],
      },
      execute: async (args, tenant) => {
        const cfgErr = assertConfigured(deps);
        if (cfgErr) return cfgErr;
        const authErr = assertAuthorized(deps, tenant);
        if (authErr) return authErr;

        const text = String(args.text ?? "").trim();
        if (!text) return "Error: text is required.";

        const bot = deps.getBot();
        if (!bot) return "Error: bot is not available yet.";
        const chatId = deps.getChatId()!;

        try {
          const msg = await sendRichChatMessage(bot.api, chatId, text, {
            ...(args.disable_notification === true ? { disable_notification: true } : {}),
          });
          return `Posted to channel. Message id: ${msg.message_id}.`;
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return `Failed to post to channel: ${detail}`;
        }
      },
    },
    {
      name: "edit_channel_post",
      description:
        "Edit an existing channel post by its message id. Use this when the user asks you to update, fix, or change a message already published in the channel. The new text replaces the old one entirely.",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "number",
            description: "The Telegram message id of the channel post to edit.",
          },
          text: {
            type: "string",
            description: "The new full message text. Telegram rich Markdown is supported.",
          },
        },
        required: ["message_id", "text"],
      },
      execute: async (args, tenant) => {
        const cfgErr = assertConfigured(deps);
        if (cfgErr) return cfgErr;
        const authErr = assertAuthorized(deps, tenant);
        if (authErr) return authErr;

        const messageId = Number(args.message_id);
        if (!Number.isFinite(messageId)) return "Error: message_id must be a number.";
        const text = String(args.text ?? "").trim();
        if (!text) return "Error: text is required.";

        const bot = deps.getBot();
        if (!bot) return "Error: bot is not available yet.";
        const chatId = deps.getChatId()!;

        try {
          await editRichChatMessage(bot.api, chatId, messageId, text);
          return `Edited channel post #${messageId}.`;
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return `Failed to edit channel post: ${detail}`;
        }
      },
    },
    {
      name: "delete_channel_post",
      description:
        "Delete a channel post by its message id. Use this when the user asks you to remove a message from the channel.",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "number",
            description: "The Telegram message id of the channel post to delete.",
          },
        },
        required: ["message_id"],
      },
      execute: async (args, tenant) => {
        const cfgErr = assertConfigured(deps);
        if (cfgErr) return cfgErr;
        const authErr = assertAuthorized(deps, tenant);
        if (authErr) return authErr;

        const messageId = Number(args.message_id);
        if (!Number.isFinite(messageId)) return "Error: message_id must be a number.";

        const bot = deps.getBot();
        if (!bot) return "Error: bot is not available yet.";
        const chatId = deps.getChatId()!;

        try {
          await bot.api.deleteMessage(chatId, messageId);
          deps.service.markDeleted(typeof chatId === "number" ? chatId : 0, messageId);
          return `Deleted channel post #${messageId}.`;
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return `Failed to delete channel post: ${detail}`;
        }
      },
    },
    {
      name: "list_channel_posts",
      readOnly: true,
      timeoutMs: 10_000,
      description:
        "List recent posts from the managed channel that have been captured by Skye. Returns their message ids, senders, and a text preview. Use this to look up a message id before editing or deleting.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of recent posts to return (default 20, max 50).",
          },
        },
      },
      execute: async (args, tenant) => {
        const cfgErr = assertConfigured(deps);
        if (cfgErr) return cfgErr;
        const authErr = assertAuthorized(deps, tenant);
        if (authErr) return authErr;

        const chatIdRaw = deps.getChatId()!;
        if (typeof chatIdRaw !== "number") {
          return "Channel is configured with a @username; listing captured posts requires a numeric chat id. Use the Telegram chat id directly if known.";
        }

        const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 50);
        const posts = deps.service.list(chatIdRaw, limit);
        if (posts.length === 0) return "No captured channel posts yet.";

        const lines = posts.map(summarizePost);
        return `Recent channel posts (${posts.length}):\n${lines.join("\n")}`;
      },
    },
  ];
}
