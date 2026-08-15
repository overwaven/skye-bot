import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { TenantContext } from "../../core/tenant.js";

export type BrowserAction =
  | "navigate"
  | "state"
  | "click"
  | "type"
  | "scroll"
  | "back"
  | "tabs"
  | "switch_tab"
  | "close_tab"
  | "screenshot"
  | "task"
  | "close";

interface BrowserWorkerResponse {
  ok?: boolean;
  result?: unknown;
  error?: string;
  screenshot_base64?: string;
  mime_type?: string;
  metadata?: Record<string, unknown>;
}

export interface BrowserScreenshot {
  buffer: Buffer;
  mimeType: string;
  metadata: Record<string, unknown>;
}

export interface BrowserServiceOptions {
  enabled: boolean;
  workerUrl: string;
  workerToken?: string;
  requestTimeoutMs: number;
  maxOutputChars: number;
  maxScreenshotBytes: number;
  maxAgentSteps: number;
  viewportWidth: number;
  viewportHeight: number;
  allowedDomains: string[];
  prohibitedDomains: string[];
  agentModel?: string;
  agentApiKey?: string;
  agentBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class BrowserService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BrowserServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  get timeoutMs(): number {
    return this.options.requestTimeoutMs;
  }

  get maxAgentSteps(): number {
    return this.options.maxAgentSteps;
  }

  async action(
    tenant: TenantContext,
    action: BrowserAction,
    args: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<string> {
    if (action === "navigate") assertSafeBrowserUrl(String(args.url ?? ""));
    const response = await this.request(tenant, action, args, signal);
    return truncate(formatResult(response.result), this.options.maxOutputChars);
  }

  async screenshot(
    tenant: TenantContext,
    fullPage: boolean,
    signal?: AbortSignal
  ): Promise<BrowserScreenshot> {
    const response = await this.request(tenant, "screenshot", { full_page: fullPage }, signal);
    if (!response.screenshot_base64) throw new Error("Browser worker returned no screenshot");
    const buffer = Buffer.from(response.screenshot_base64, "base64");
    if (buffer.byteLength > this.options.maxScreenshotBytes) {
      throw new Error(`Browser screenshot exceeds ${this.options.maxScreenshotBytes} bytes`);
    }
    return {
      buffer,
      mimeType: response.mime_type ?? "image/png",
      metadata: response.metadata ?? {},
    };
  }

  async close(tenant: TenantContext, signal?: AbortSignal): Promise<void> {
    await this.request(tenant, "close", {}, signal);
  }

  private async request(
    tenant: TenantContext,
    action: BrowserAction,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<BrowserWorkerResponse> {
    if (!this.options.enabled) throw new Error("Browser automation is disabled");

    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const sessionId = browserSessionId(tenant);
    const url = new URL(
      `/v1/sessions/${sessionId}/action`,
      ensureTrailingSlash(this.options.workerUrl)
    );
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.workerToken) headers.authorization = `Bearer ${this.options.workerToken}`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers,
      signal: requestSignal,
      body: JSON.stringify({
        action,
        args,
        settings: {
          allowed_domains: this.options.allowedDomains,
          prohibited_domains: this.options.prohibitedDomains,
          viewport_width: this.options.viewportWidth,
          viewport_height: this.options.viewportHeight,
          max_agent_steps: this.options.maxAgentSteps,
          agent_model: this.options.agentModel,
          agent_api_key: this.options.agentApiKey,
          agent_base_url: this.options.agentBaseUrl,
        },
      }),
    });

    const maxResponseBytes = Math.ceil(this.options.maxScreenshotBytes * 1.5) + 1_000_000;
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maxResponseBytes) throw new Error("Browser worker response is too large");
    const raw = await response.text();
    if (Buffer.byteLength(raw) > maxResponseBytes) {
      throw new Error("Browser worker response is too large");
    }

    let body: BrowserWorkerResponse;
    try {
      body = JSON.parse(raw) as BrowserWorkerResponse;
    } catch {
      throw new Error(`Browser worker returned invalid JSON (${response.status})`);
    }
    if (!response.ok || body.ok === false) {
      throw new Error(body.error || `Browser worker failed with HTTP ${response.status}`);
    }
    return body;
  }
}

export function browserSessionId(tenant: Pick<TenantContext, "chatId" | "threadId">): string {
  return createHash("sha256")
    .update(`${tenant.chatId}:${tenant.threadId ?? 0}`)
    .digest("hex")
    .slice(0, 32);
}

export function assertSafeBrowserUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Browser URL must be an absolute http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser URL must use http or https");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateIpLiteral(host)
  ) {
    throw new Error("Browser navigation to local or private network addresses is blocked");
  }
}

function isPrivateIpLiteral(host: string): boolean {
  const version = isIP(host);
  if (version === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] >= 224
    );
  }
  if (version === 6) {
    return (
      host === "::1" ||
      host === "::" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb")
    );
  }
  return false;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "Browser action completed.";
  return JSON.stringify(result, null, 2);
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n... [truncated]`;
}
