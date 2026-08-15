import type { ZodObject, ZodRawShape } from "zod";
import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { Context as GrammyContext } from "grammy";
import type { Express, Request, Response, NextFunction } from "express";
import type { EventBus } from "./events.js";
import type { TenantContext } from "./tenant.js";
import type { SkyeConfig } from "./config.js";

/**
 * Service registry. Each module that exposes a service for other modules to
 * consume augments this interface via `declare module` to register its type:
 *
 *   declare module "../../core/module.js" {
 *     interface SkyeServices {
 *       memory: MemoryService;
 *     }
 *   }
 */
export interface SkyeServices {
  // populated via declaration merging by modules
  [key: string]: unknown;
}

/** Migration applied once and tracked in the `migrations` table. */
export interface Migration {
  id: string;
  up: (db: Database.Database) => void;
}

/** A function-call tool exposed to the LLM. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Read-only tools may run concurrently when the model requests several at once. */
  readOnly?: boolean;
  /** Maximum execution time before a timeout result is returned to the model. */
  timeoutMs?: number;
  /** A successful call completes the response without another LLM round. */
  terminal?: boolean;
  execute: (
    args: Record<string, unknown>,
    tenant: TenantContext,
    signal?: AbortSignal
  ) => Promise<string> | string;
}

/** A Telegram bot command (/name). */
export interface TelegramCommand {
  name: string;
  description: string;
  handler: (ctx: GrammyContext, tenant: TenantContext) => Promise<void> | void;
  /** If true, this command bypasses allowlist/subscription. Banned users are still blocked. */
  public?: boolean;
  /** Set false for sensitive bootstrap commands that should not appear in Telegram's menu. */
  advertise?: boolean;
}

/** A free-form Telegram message handler (e.g. message:photo). */
export interface TelegramHandler {
  /**
   * Selector understood by grammy's bot.on() — string or string[].
   * Examples: "message:text", "message:photo", "callback_query:data".
   */
  on: string | string[];
  handler: (
    ctx: GrammyContext,
    tenant: TenantContext,
    next: () => Promise<void>
  ) => Promise<void> | void;
  /**
   * Order hint — lower runs earlier. Defaults to 100.
   * Access gate is at 50, logging at 75, message handlers at 100+.
   */
  order?: number;
}

/** An Express route mounted under the panel /api prefix. */
export interface PanelRoute {
  method: "get" | "post" | "put" | "delete" | "patch";
  path: string;
  handler: (
    req: Request & { tenant: TenantContext },
    res: Response,
    next: NextFunction
  ) => Promise<void> | void;
}

/** What a module returns from `init` — its registrations with the host. */
export interface ModuleInitResult {
  /** Service object stored under `services[mod.name]`. */
  service?: unknown;
  /** LLM tools made available in chat completions. */
  tools?: ToolDefinition[];
  /** Bot commands registered on startup. */
  commands?: TelegramCommand[];
  /** Generic Telegram event handlers. */
  telegramHandlers?: TelegramHandler[];
  /** Express routes under /api. */
  panelRoutes?: PanelRoute[];
}

/** Aggregated registrations passed to the start() phase. */
export interface Contributions {
  tools: ToolDefinition[];
  commands: TelegramCommand[];
  telegramHandlers: TelegramHandler[];
  panelRoutes: PanelRoute[];
}

/** Context handed to every module. */
export interface ModuleContext {
  db: Database.Database;
  events: EventBus;
  config: SkyeConfig;
  logger: Logger;
  services: ServiceRegistry;
}

export class ServiceRegistry {
  private map = new Map<string, unknown>();

  set<K extends keyof SkyeServices>(name: K, service: SkyeServices[K]): void;
  set(name: string, service: unknown): void;
  set(name: string, service: unknown): void {
    this.map.set(name, service);
  }

  get<K extends keyof SkyeServices>(name: K): SkyeServices[K] {
    const svc = this.map.get(name as string);
    if (svc === undefined) {
      throw new Error(`Service "${String(name)}" not registered`);
    }
    return svc as SkyeServices[K];
  }

  has(name: string): boolean {
    return this.map.has(name);
  }
}

/**
 * A self-contained domain module. Declared at the top of `src/index.ts` in the
 * `modules` array; everything below is wired by the host.
 */
export interface SkyeModule {
  name: string;
  /** Zod schema for this module's YAML config section (native YAML keys). */
  configSchema?: ZodObject<ZodRawShape>;
  /** Schema migrations applied once on startup, in order. */
  migrations?: Migration[];
  /**
   * Initialize the module. Returns registrations with the host.
   * Called after migrations have run and ctx.db is ready.
   */
  init?: (ctx: ModuleContext) => Promise<ModuleInitResult | void> | ModuleInitResult | void;
  /**
   * Optional second-phase startup, called after all modules have initialized
   * and contributions have been collected. Used by `telegram` and `panel` to
   * wire collected commands/routes and start listeners.
   */
  start?: (
    ctx: ModuleContext,
    contributions: Contributions,
    extra: { bot?: import("grammy").Bot; app?: Express }
  ) => Promise<void> | void;
  /** Optional cleanup on shutdown. */
  shutdown?: () => Promise<void> | void;
}
