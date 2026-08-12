import { InlineKeyboard, InputFile } from "grammy";
import type { Contributions, TelegramCommand, ToolDefinition } from "../../core/module.js";
import { threadKey } from "../../core/tenant.js";
import { createSendVoiceTool } from "../speech/tool.js";
import type { ConnectorDetailedTool } from "../connectors/service.js";
import { applyReminderControl, parseReminderDuration } from "../reminders/controls.js";
import { formatReminderTime, reminderListMarkdown } from "../reminders/presentation.js";
import {
  ctxAudit,
  fmtError,
  sendRichReply,
  sendRichReplyChunked,
  serializeError,
} from "./helpers.js";
import { log } from "../../utils/log.js";
import type { ImageControl, TelegramDeps } from "./deps.js";
import { IMAGE_CONTROL_TTL_MS } from "./deps.js";
import type { ConversationHelpers } from "./conversation.js";
import { formatToolBlock, imageControlKey, imageKeyboard } from "./uiHelpers.js";

export function buildTelegramCommands(opts: {
  deps: TelegramDeps;
  contributions: Contributions;
  imageControls: Map<string, ImageControl>;
  storeConversation: ConversationHelpers["storeConversation"];
  getBuiltinTools: () => ToolDefinition[];
}): TelegramCommand[] {
  const { deps, contributions, imageControls, storeConversation, getBuiltinTools } = opts;

  const allCommands: TelegramCommand[] = [
    ...contributions.commands,
    {
      name: "stop",
      description: "Stop everything Skye is doing in this chat",
      public: true,
      handler: async (ctx, tenant) => {
        deps.reliability.queue.cancelChat(tenant.chatId);
        await sendRichReply(ctx, "**Stopped.**");
      },
    },
    {
      name: "diagnostics",
      description: "Show Telegram processing diagnostics (admins only)",
      public: true,
      handler: async (ctx) => {
        if (!deps.admin.isAdmin(ctx.from?.id)) {
          await sendRichReply(ctx, "This command is available to **bot administrators** only.");
          return;
        }

        const diagnostics = deps.reliability.diagnostics();
        const queue = diagnostics.queue;
        const md = [
          "## Telegram diagnostics",
          "",
          `Status: **${diagnostics.status}**`,
          `API ready: **${diagnostics.apiReady ? "yes" : "no"}**`,
          `LLM preflight: **${diagnostics.llmPreflightComplete ? "complete" : "pending"}**`,
          `Last update: **${diagnostics.lastUpdateAt ?? "none since startup"}**`,
          `Processed / duplicates / failed: **${diagnostics.processedUpdates} / ${diagnostics.duplicateUpdates} / ${diagnostics.failedUpdates}**`,
          `Queue pending / active: **${queue.pendingJobs} / ${queue.activeJobs}**`,
          `Oldest active job: **${queue.oldestActiveMs} ms**`,
          `Timed out / cancelled: **${queue.timedOutTotal} / ${queue.cancelledTotal}**`,
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "start",
      description: "Say hi and get a few starting points",
      public: true,
      handler: async (ctx) => {
        const md = [
          "Hi, I'm Skye.",
          "",
          "Send whatever's on your mind.",
          "",
          "I'll help you work through it clearly.",
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "help",
      description: "Show what Skye can do",
      public: true,
      handler: async (ctx) => {
        const md = [
          "Skye can do things for you — calmly, without the noise.",
          "",
          "## Chat",
          "",
          "Send a message and I answer, streaming in real time. Calm and concise by design. In groups, type “skye” or “скай” anywhere in your message, or reply to one of mine.",
          "",
          "## Memory",
          "",
          "Tell me something worth remembering — _“remember my project uses pnpm”_ — and I’ll keep it for next time. Use /memories to view them or /forget to wipe memories for this chat.",
          "",
          "## Images",
          "",
          "Ask in plain words — _“draw a cat on the moon”_, _“make this photo look like a watercolor”_ (reply to a photo), or send a photo with a question and I’ll describe or analyze it. I’ll generate or edit when it fits.",
          "",
          "## Voice",
          "",
          "Send a voice note — I transcribe and answer. Use /voice text, /voice auto, or /voice always to choose how I reply. You can also ask for a specific voice, tone, language, or spoken performance.",
          "",
          "## Documents, PDFs & audio",
          "",
          "Send `.txt`, `.md`, `.json`, `.csv`, code, or logs and I'll read them. Send a PDF and I'll parse it — text, images, tables, everything. Reply to anyone's PDF, photo, sticker, GIF, or audio message and ask me about it — I'll see the content and reason about it. Audio files and video notes are transcribed too.",
          "",
          "## Stickers",
          "",
          "Send a sticker or GIF while mentioning me (or reply to one) and I can see its thumbnail. Teach me this chat's sticker pack with `/stickers_teach` or `/stickers_seed`, list with `/stickers`, and I’ll fire them back when the vibe fits.",
          "",
          "## Sandbox & web",
          "",
          "I have an isolated per-chat sandbox with internet access. Ask me to run code, fetch data from the web, install packages, or analyze files — _“search the web for X and summarize”_ works.",
          "",
          "## Reminders",
          "",
          "Ask me to remind you of something, or to follow up later. Use /reminders to see active ones.",
          "",
          "## Connectors",
          "",
          "Connect Gmail, GitHub, Notion, Slack, and other services from Settings. Advanced users can also add a trusted custom HTTPS connector. Use /tools to see what is available.",
          "",
          "## Group chats",
          "",
          "Add me to a group. I listen for “skye” / “скай” and replies, log recent messages, summarize older ones to stay aware of context, and offer /catchup for a quick recap.",
          "",
          "---",
          "",
          "Commands: /reset · /image · /voice · /memories · /forget · /stickers · /stickers_teach · /stickers_seed · /status · /tools · /catchup · /reminders · /config",
          "",
          "Project: /source · /terms · /privacy · /paysupport · /developer_info · /delete_my_data",
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "reset",
      description: "Reset conversation context",
      public: true,
      handler: async (ctx, tenant) => {
        const tk = threadKey(tenant);
        deps.chatLog.clearConversation(tenant.chatId, tk);
        await sendRichReply(
          ctx,
          "🧹 **Context reset.**\n\n_Memories are still saved — use /forget to clear them._"
        );
      },
    },
    {
      name: "image",
      description: "Generate an image from a text prompt",
      handler: async (ctx, tenant) => {
        const prompt = ctx.match?.toString().trim();
        if (!prompt) {
          await sendRichReply(
            ctx,
            "Provide a description after `/image`, e.g. `/image a cat on the moon`"
          );
          return;
        }

        const t0 = Date.now();
        log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Image generation");

        const actionInterval = setInterval(() => {
          ctx.replyWithChatAction("upload_photo").catch(() => {});
        }, 4000);

        try {
          await ctx.replyWithChatAction("upload_photo");
          const buffer = await deps.llm.generateImage(
            prompt,
            undefined,
            AbortSignal.timeout(180_000)
          );

          if (!buffer) {
            await sendRichReply(ctx, "_No image was generated. Try a different prompt._");
            deps.audit.log({
              ...ctxAudit(ctx),
              msgType: "image",
              command: "/image",
              inputLen: prompt.length,
              outputLen: 0,
              latencyMs: Date.now() - t0,
              status: "ok",
              inputText: prompt,
            });
            return;
          }

          const sent = await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
            reply_to_message_id: ctx.message!.message_id,
            reply_markup: imageKeyboard(),
          });
          imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
            prompt,
            ownerUserId: tenant.userId!,
            expiresAt: Date.now() + IMAGE_CONTROL_TTL_MS,
          });
          storeConversation(
            tenant,
            "assistant",
            { kind: "image_generated", prompt, messageId: sent.message_id },
            `generated image: ${prompt.slice(0, 200)} (message_id ${sent.message_id})`
          );
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "image",
            command: "/image",
            inputLen: prompt.length,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "ok",
            inputText: prompt,
          });
        } catch (e) {
          const ms = Date.now() - t0;
          log.error({ ...serializeError(e), latencyMs: ms }, "Image generation failed");
          storeConversation(
            tenant,
            "assistant",
            { kind: "image_failed", prompt, error: fmtError(e) },
            `image generation failed: ${fmtError(e)}`
          );
          await sendRichReply(ctx, "**Failed to generate the image.** Please try again.").catch(
            () => {}
          );
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "image",
            command: "/image",
            inputLen: prompt.length,
            outputLen: 0,
            latencyMs: ms,
            status: "error",
            errorMsg: fmtError(e),
            inputText: prompt,
          });
        } finally {
          clearInterval(actionInterval);
        }
      },
    },
    {
      name: "config",
      description: "Open the Skye settings panel",
      public: true,
      handler: async (ctx) => {
        const kb = new InlineKeyboard();
        if (ctx.chat?.type === "private") {
          kb.webApp("Open Settings", deps.webappUrl);
        }
        await sendRichReply(
          ctx,
          [
            "## Settings",
            "",
            "Open the settings panel to manage your subscription, model, and connectors.",
          ].join("\n"),
          {
            reply_markup: kb,
          }
        );
      },
    },
    {
      name: "status",
      description: "Show bot capabilities and current chat state",
      public: true,
      handler: async (ctx, tenant) => {
        const chatCfg = deps.chatConfig.get(tenant.chatId);
        const billAcc = tenant.userId ? deps.billing.getAccount(tenant.userId) : undefined;
        const modelEntry = deps.llm.resolveModel(billAcc?.modelId ?? deps.defaultModelId);
        const connectorTools = tenant.userId ? await deps.connectors.toolsFor(tenant.userId) : [];
        const vision = deps.llm.supportsImages();
        const memoryCount = deps.memory.list(tenant.chatId).length;
        const ctxCount = deps.chatLog.countConversation(tenant.chatId, threadKey(tenant));
        const proactiveOn = deps.proactive?.isEnabled() ?? false;
        const reminderCount = deps.reminders?.list(tenant.chatId).length ?? 0;
        const customPrompt = deps.chatConfig.getPrompt(tenant.chatId, tenant.threadId);
        const activeAgent = deps.agentRuntime.activeProfileFor(tenant);

        const yes = "✅";
        const no = "❌";
        const warn = "⚠️";

        const md = [
          "## Skye status",
          "",
          "| | |",
          "|---|---|",
          `| **Chat** | ${tenant.chatType}${tenant.threadId ? ` · topic ${tenant.threadId}` : ""} |`,
          `| **Model** | \`${modelEntry.name}\` (${modelEntry.multiplier}×) |`,
          `| **Skye Plus** | ${
            billAcc && deps.billing.hasActiveSub(billAcc)
              ? yes + ` until ${new Date(billAcc.subExpiresAt * 1000).toLocaleDateString()}`
              : no
          } |`,
          `| **Tokens left** | ${
            billAcc && deps.billing.hasActiveSub(billAcc)
              ? deps.billing.effectiveRemaining(billAcc).toLocaleString("en-US")
              : "—"
          } |`,
          `| **Vision** | ${vision === true ? yes : vision === false ? no : warn + " unknown"} |`,
          `| **Voice input** | ${deps.speech.isSttAvailable() ? yes : no} |`,
          `| **Voice replies** | ${chatCfg.voiceReplyMode} |`,
          `| **Agent** | ${activeAgent?.name ?? "Default Skye"}${customPrompt ? " + addendum" : ""} |`,
          `| **TTS** | ${deps.speech.isTtsAvailable() ? yes : no} |`,
          `| **Memories** | ${memoryCount} |`,
          `| **Context items** | ${ctxCount} |`,
          `| **Connector tools** | ${connectorTools.length} |`,
          `| **Sandbox** | ${deps.sandbox?.isEnabled() ? yes : no} |`,
          `| **Proactive** | ${proactiveOn ? yes : no} |`,
          `| **Reminders** | ${reminderCount} |`,
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "tools",
      description: "Show all available tools (full debug detail)",
      handler: async (ctx, tenant) => {
        const connectorTools = await deps.connectors.detailedToolsFor(tenant.userId);
        const displayedBuiltinTools = [...getBuiltinTools()];
        if (deps.speech.isTtsAvailable()) {
          displayedBuiltinTools.push(
            createSendVoiceTool({
              speech: deps.speech,
              mode: deps.chatConfig.get(tenant.chatId).voiceReplyMode,
              onPrepared: () => {},
            })
          );
        }
        const total = displayedBuiltinTools.length + connectorTools.length;

        if (total === 0) {
          await sendRichReply(ctx, "_No tools available._");
          return;
        }

        const sep = "\n\n---\n\n";
        const blocks: string[] = [
          `## Tools (${total} total)\n\n**${displayedBuiltinTools.length} built-in · ${connectorTools.length} connector**`,
        ];

        if (displayedBuiltinTools.length > 0) {
          displayedBuiltinTools.forEach((tool, i) => {
            const heading = i === 0 ? "### Built-in\n\n" : "";
            blocks.push(
              `${heading}${formatToolBlock(tool.name, tool.description, tool.parameters)}`
            );
          });
        }

        if (connectorTools.length > 0) {
          const connectorGroups: {
            name: string;
            scope: string;
            tools: ConnectorDetailedTool[];
          }[] = [];
          for (const tool of connectorTools) {
            let group = connectorGroups.find(
              (item) => item.name === tool.connectorName && item.scope === tool.scope
            );
            if (!group) {
              group = { name: tool.connectorName, scope: tool.scope, tools: [] };
              connectorGroups.push(group);
            }
            group.tools.push(tool);
          }
          for (const connector of connectorGroups) {
            connector.tools.forEach((tool, j) => {
              const heading =
                j === 0 ? `### Connector · ${connector.name} (${connector.scope})\n\n` : "";
              blocks.push(
                `${heading}${formatToolBlock(
                  tool.name,
                  tool.description,
                  tool.parameters,
                  `connector:${connector.name}`
                )}`
              );
            });
          }
        }

        await sendRichReplyChunked(ctx, blocks.join(sep));
      },
    },
    {
      name: "catchup",
      description: "Show recent group context",
      public: true,
      handler: async (ctx, tenant) => {
        const context = deps.chatLog.context(tenant.chatId, tenant.threadId);
        if (!context) {
          await sendRichReply(ctx, "_No group context yet._");
          return;
        }
        const lines = context.recentLog.split("\n").filter(Boolean);
        const rows = lines.map((line) => {
          // [HH:MM] Sender (replying to X): [type] content
          const m = line.match(/^\[(.+?)\] (.+?)(?: \(replying to (.+?)\))?: (.+)$/);
          if (!m) return `| ${line.replace(/\|/g, "\\|")} |`;
          const [, time, sender, replyTo, rest] = m;
          const typeMatch = rest.match(/^\[(.+?)\]\s*(.*)$/);
          const typeTag = typeMatch ? typeMatch[1] : "";
          const content = (typeMatch ? typeMatch[2] : rest).replace(/\|/g, "\\|").slice(0, 80);
          const senderCol = replyTo ? `${sender} ↩ ${replyTo}` : sender;
          return `| ${time} | ${senderCol} | ${typeTag || "text"} | ${content} |`;
        });
        const md = [
          `## ${context.chatTitle} — catch-up`,
          "",
          "| Time | Sender | Type | Content |",
          "|---|---|---|---|",
          ...rows,
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "reminders",
      description: "Show active reminders in this chat",
      public: true,
      handler: async (ctx, tenant) => {
        if (!deps.reminders) {
          await sendRichReply(ctx, "_Reminders are not available._");
          return;
        }
        const reminders = deps.reminders.list(tenant.chatId);
        await sendRichReply(ctx, reminderListMarkdown(reminders));
      },
    },
    {
      name: "postpone",
      description: "Postpone a reminder: /postpone 1 35m",
      public: true,
      handler: async (ctx, tenant) => {
        if (!deps.reminders) {
          await sendRichReply(ctx, "_Reminders are not available._");
          return;
        }
        const args = ctx.match?.toString().trim() ?? "";
        const match = args.match(/^(\d+)\s+(.+)$/);
        const number = match ? Number(match[1]) : 0;
        const durationMs = match ? parseReminderDuration(match[2]) : null;
        if (!Number.isSafeInteger(number) || number < 1 || durationMs == null) {
          await sendRichReply(
            ctx,
            "Usage: `/postpone <number> <duration>`, for example `/postpone 1 35m` or `/postpone 2 2h`. Maximum duration: 365 days."
          );
          return;
        }

        const result = applyReminderControl(deps.reminders, {
          action: "postpone",
          number,
          durationMs,
          chatId: tenant.chatId,
          ...(tenant.userId != null ? { userId: tenant.userId } : {}),
        });
        if (result.status === "not_found") {
          await sendRichReply(
            ctx,
            `Reminder **#${number}** was not found. Use \`/reminders\` to refresh the list.`
          );
          return;
        }
        if (result.status === "forbidden") {
          await sendRichReply(ctx, "_Only the reminder creator can change it._");
          return;
        }
        await sendRichReply(
          ctx,
          `⏳ Reminder **#${number}** postponed until **${formatReminderTime(result.reminder.fireAt)}**.`
        );
      },
    },
    {
      name: "delete_reminder",
      description: "Delete a reminder: /delete_reminder 1",
      public: true,
      handler: async (ctx, tenant) => {
        if (!deps.reminders) {
          await sendRichReply(ctx, "_Reminders are not available._");
          return;
        }
        const rawNumber = ctx.match?.toString().trim() ?? "";
        const number = /^\d+$/.test(rawNumber) ? Number(rawNumber) : 0;
        if (!Number.isSafeInteger(number) || number < 1) {
          await sendRichReply(
            ctx,
            "Usage: `/delete_reminder <number>`, for example `/delete_reminder 1`."
          );
          return;
        }

        const result = applyReminderControl(deps.reminders, {
          action: "delete",
          number,
          chatId: tenant.chatId,
          ...(tenant.userId != null ? { userId: tenant.userId } : {}),
        });
        if (result.status === "not_found") {
          await sendRichReply(
            ctx,
            `Reminder **#${number}** was not found. Use \`/reminders\` to refresh the list.`
          );
          return;
        }
        if (result.status === "forbidden") {
          await sendRichReply(ctx, "_Only the reminder creator can delete it._");
          return;
        }
        await sendRichReply(ctx, `✅ Reminder **#${number}** deleted.`);
      },
    },
  ];

  return allCommands;
}
