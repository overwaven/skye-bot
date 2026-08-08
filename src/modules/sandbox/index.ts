import type { SkyeModule } from "../../core/module.js";
import { sandboxConfigSchema } from "./config.js";
import { SandboxService } from "./service.js";
import { sandboxTools } from "./tools.js";
import { sendRichReply } from "../telegram/helpers.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    sandbox: SandboxService;
  }
}

let serviceRef: SandboxService | null = null;

export const sandboxModule: SkyeModule = {
  name: "sandbox",
  configSchema: sandboxConfigSchema,
  init(ctx) {
    const c = ctx.config.sandbox;
    const apiKey = c.daytona_api_key;
    const enabled = c.enabled && apiKey != null;

    const service = new SandboxService({
      enabled,
      apiKey,
      apiUrl: c.daytona_api_url,
      target: c.daytona_target,
      image: c.image,
      snapshot: c.snapshot,
      cpu: c.cpu,
      memoryGiB: c.memory_gib,
      diskGiB: c.disk_gib,
      autoStopMinutes: c.auto_stop_minutes,
      autoArchiveMinutes: c.auto_archive_minutes,
      persistent: c.persistent,
      commandTimeoutMs: c.command_timeout_ms,
      maxOutputChars: c.max_output_chars,
      maxFileBytes: c.max_file_bytes,
    });

    serviceRef = service;
    return {
      service,
      tools: enabled ? sandboxTools(service) : [],
      commands: enabled
        ? [
            {
              name: "sandbox",
              description: "Run a command in this chat's Daytona Sandbox",
              handler: async (ctx, tenant) => {
                const command = ctx.match?.toString().trim();
                if (!command) {
                  await sendRichReply(
                    ctx,
                    [
                      "## Sandbox",
                      "",
                      "Usage: `/sandbox <command>`",
                      "",
                      "Example:",
                      "```",
                      "/sandbox curl -s https://api.github.com/users/daytonaio",
                      "```",
                    ].join("\n")
                  );
                  return;
                }
                await ctx.replyWithChatAction("typing");
                const parts = command.split(/\s+/);
                const result = await service.runCommand(tenant.chatId, parts[0], parts.slice(1));
                const output = [result.stdout, result.stderr]
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 3800);
                const body = output || "_(no output)_";
                await sendRichReply(
                  ctx,
                  [
                    `## Exit code \`${result.exitCode}\``,
                    "",
                    output ? ["```", body, "```"].join("\n") : body,
                  ].join("\n")
                );
              },
            },
            {
              name: "sandbox_reset",
              description: "Reset this chat's Daytona Sandbox to a clean state",
              handler: async (ctx, tenant) => {
                await ctx.replyWithChatAction("typing");
                await service.reset(tenant.chatId);
                await sendRichReply(
                  ctx,
                  "✅ **Sandbox reset.** A fresh environment is ready."
                );
              },
            },
            {
              name: "sandbox_status",
              description: "Show this chat's Daytona Sandbox status",
              handler: async (ctx, tenant) => {
                const status = await service.status(tenant.chatId);
                if (!status) {
                  await sendRichReply(ctx, "_No active sandbox for this chat yet._");
                  return;
                }
                await sendRichReply(
                  ctx,
                  [
                    "## Sandbox status",
                    "",
                    `| | |`,
                    `|---|---|`,
                    `| **Name** | \`${status.name}\` |`,
                    `| **Status** | **${status.status}** |`,
                    `| **Resources** | ${status.cpu} CPU · ${status.memoryGiB} GiB RAM · ${status.diskGiB} GiB disk |`,
                    `| **Auto-stop** | ${status.autoStopMinutes ?? "unknown"} minutes |`,
                    `| **Persistent** | ${status.persistent ? "yes" : "no"} |`,
                  ].join("\n")
                );
              },
            },
          ]
        : [],
    };
  },
  async shutdown() {
    if (serviceRef) {
      await serviceRef.shutdown();
      serviceRef = null;
    }
  },
};
