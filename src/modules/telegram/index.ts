import { Bot } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { createHash } from "crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import type { SkyeModule } from "../../core/module.js";
import { telegramConfigSchema } from "./config.js";
import { installTelegram } from "./handlers.js";
import { migrations } from "./migrations.js";
import { TelegramReliabilityService } from "./reliability.js";
import { log } from "../../utils/log.js";

let botRef: Bot | null = null;
let reliabilityRef: TelegramReliabilityService | null = null;
let runnerRef: RunnerHandle | null = null;
let releasePollingLock: (() => void) | null = null;

declare module "../../core/module.js" {
  interface SkyeServices {
    telegramBot: Bot;
    telegramReliability: TelegramReliabilityService;
  }
}

export const telegramModule: SkyeModule = {
  name: "telegram",
  configSchema: telegramConfigSchema,
  migrations,
  async init(ctx) {
    const c = ctx.config;
    const token = c.bot_token;
    const bot = new Bot(token);
    botRef = bot;
    ctx.services.set("telegramBot", bot);
    const reliability = new TelegramReliabilityService(ctx.db, c.telegram_job_timeout_ms);
    reliabilityRef = reliability;
    ctx.services.set("telegramReliability", reliability);
  },
  async start(ctx, contributions, extra) {
    const c = ctx.config;
    const bot = botRef!;
    const reliability = reliabilityRef!;
    extra.bot = bot;

    // Validate the Telegram token and cache botInfo before accepting updates.
    await bot.init();
    reliability.markApiReady(bot.botInfo.username);
    log.info(
      {
        privateTopicsEnabled: bot.botInfo.has_topics_enabled ?? false,
        usersCanCreatePrivateTopics: bot.botInfo.allows_users_to_create_topics ?? false,
      },
      "Telegram private topic capabilities"
    );

    // Pre-flight: probe model capability before serving requests. This probe is
    // intentionally advisory; providers may not expose /models even when chat works.
    const llm = ctx.services.get("llm");
    await llm.checkCapabilities();
    reliability.markLlmPreflightComplete();

    installTelegram(
      bot,
      {
        llm,
        connectors: ctx.services.get("connectors"),
        memory: ctx.services.get("memory"),
        chatLog: ctx.services.get("chatLog"),
        chatConfig: ctx.services.get("chatConfig"),
        userConfig: ctx.services.get("userConfig"),
        speech: ctx.services.get("speech"),
        audit: ctx.services.get("audit"),
        sandbox: ctx.services.has("sandbox") ? ctx.services.get("sandbox") : undefined,
        proactive: ctx.services.has("proactive") ? ctx.services.get("proactive") : undefined,
        reminders: ctx.services.has("reminders") ? ctx.services.get("reminders") : undefined,
        jobs: ctx.services.get("jobs"),
        channel: ctx.services.has("channel") ? ctx.services.get("channel") : undefined,
        stickers: ctx.services.has("stickers") ? ctx.services.get("stickers") : undefined,
        events: ctx.events,
        billing: ctx.services.get("billing"),
        admin: ctx.services.get("admin"),
        agentRuntime: ctx.services.get("agentRuntime"),
        botToken: c.bot_token,
        maxAttachmentBytes: c.telegram_max_attachment_bytes,
        webappUrl: ctx.config.panel.webapp_url,
        defaultModelId: ctx.config.default_model_id,
        reliability,
        accessMode: c.access.mode,
        subscriptionStars: c.billing.subscription_stars,
        ...(c.owner.name || c.owner.tag ? { owner: { name: c.owner.name, tag: c.owner.tag } } : {}),
      },
      contributions
    );

    void bot.api
      .setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Settings",
          web_app: { url: ctx.config.panel.webapp_url },
        },
      })
      .catch((e) => log.warn({ err: e }, "Failed to set menu button"));

    if (c.telegram_polling_lock !== "0") {
      releasePollingLock = acquirePollingLock(c.bot_token, String(c.db_path));
    }

    reliability.markPolling();
    const dropPendingUpdates = c.telegram_drop_pending_updates === "1";
    await bot.api.deleteWebhook({ drop_pending_updates: dropPendingUpdates });
    runnerRef = run(bot);
    void runnerRef.task()?.catch((e) => {
      reliability.markStopped();
      releasePollingLock?.();
      releasePollingLock = null;
      if (isGetUpdatesConflict(e)) {
        log.error(
          {
            err: e,
            hint: "Another process or deployment is already polling this BOT_TOKEN. Stop the other instance, or switch one deployment to webhooks/different token.",
          },
          "Telegram polling conflict"
        );
      } else {
        log.error({ err: e }, "Telegram polling stopped unexpectedly");
      }
      setTimeout(() => process.exit(1), 100).unref();
    });
    log.info({ dropPendingUpdates, concurrentUpdates: true }, "Skye is alive");
  },
  async shutdown() {
    reliabilityRef?.markStopped();
    await runnerRef?.stop().catch(() => {});
    runnerRef = null;
    releasePollingLock?.();
    releasePollingLock = null;
    reliabilityRef = null;
  },
};

function pollingLockPath(token: string, dbPath: string): string {
  const hash = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const dir = dbPath && dbPath !== ":memory:" ? dirname(dbPath) : join(process.cwd(), "data");
  return join(dir, `skye-${hash}.polling.lock`);
}

function acquirePollingLock(token: string, dbPath: string): () => void {
  const path = pollingLockPath(token, dbPath);
  mkdirSync(dirname(path), { recursive: true });

  const tryAcquire = () => {
    const fd = openSync(path, "wx");
    writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          cwd: process.cwd(),
          node: process.version,
        },
        null,
        2
      )
    );
    return fd;
  };

  let fd: number;
  try {
    fd = tryAcquire();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "EEXIST") throw e;

    const holder = readLock(path);
    if (holder.pid && isProcessAlive(holder.pid)) {
      throw new Error(
        `Telegram polling is already locked by PID ${holder.pid}. Stop the other bot process or remove ${path} if it is stale.`
      );
    }

    unlinkSync(path);
    fd = tryAcquire();
  }

  log.debug({ path }, "Acquired Telegram polling lock");
  return () => {
    try {
      closeSync(fd);
    } catch {
      // ignore
    }
    try {
      if (existsSync(path)) unlinkSync(path);
      log.debug({ path }, "Released Telegram polling lock");
    } catch (e) {
      log.warn({ err: e, path }, "Failed to release Telegram polling lock");
    }
  };
}

function readLock(path: string): { pid?: number } {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" ? { pid: parsed.pid } : {};
  } catch {
    return {};
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code !== "ESRCH";
  }
}

function isGetUpdatesConflict(e: unknown): boolean {
  const err = e as { method?: unknown; error_code?: unknown; description?: unknown };
  return (
    err.method === "getUpdates" &&
    err.error_code === 409 &&
    typeof err.description === "string" &&
    err.description.includes("terminated by other getUpdates request")
  );
}
