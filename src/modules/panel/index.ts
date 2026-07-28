import express, { type Request, type Response, type NextFunction, type Express } from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { SkyeModule } from "../../core/module.js";
import { panelConfigSchema } from "./config.js";
import { validateInitData, type ValidatedInitData } from "./auth.js";
import { tenantFromInitData, type TenantContext } from "../../core/tenant.js";
import { log } from "../../utils/log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PanelRequest extends Request {
  tenant: TenantContext;
  initData: ValidatedInitData;
}

let server: import("http").Server | null = null;

interface RateBucket {
  startedAt: number;
  count: number;
}

const rateBuckets = new Map<number, RateBucket>();

function setSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://telegram.org",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob: https://assets.composio.dev",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors https://web.telegram.org https://*.telegram.org",
    ].join("; ")
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
}

export const panelModule: SkyeModule = {
  name: "panel",
  configSchema: panelConfigSchema,
  async start(ctx, contributions, extra) {
    const c = ctx.config;
    const botToken = c.bot_token;
    const webappPort = c.panel.webapp_port;

    const app: Express = extra.app ?? express();
    app.disable("x-powered-by");
    app.use(setSecurityHeaders);
    app.use(express.json({ limit: `${c.panel.json_body_limit_kb}kb`, type: "application/json" }));

    const monitoring = ctx.services.get("monitoring");
    app.get(["/healthz", "/health/live"], (_req: Request, res: Response) => {
      res.json(monitoring.live());
    });
    app.get("/health/ready", (_req: Request, res: Response) => {
      const report = monitoring.ready();
      res.status(report.status === "ok" ? 200 : 503).json(report);
    });

    // Auth middleware — populates req.tenant from validated initData.
    app.use("/api", (req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Cache-Control", "no-store");
      const initData = req.headers["x-telegram-init-data"];
      if (typeof initData !== "string") {
        res.status(401).json({ error: "Missing init data" });
        return;
      }
      const validated = validateInitData(initData, botToken, c.panel.auth_max_age_seconds);
      if (!validated) {
        res.status(401).json({ error: "Invalid init data" });
        return;
      }
      (req as PanelRequest).initData = validated;
      (req as PanelRequest).tenant = tenantFromInitData(validated);
      next();
    });

    app.use("/api", (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as PanelRequest).initData.user.id;
      const now = Date.now();
      const existing = rateBuckets.get(userId);
      const bucket =
        !existing || now - existing.startedAt >= c.panel.rate_limit_window_ms
          ? { startedAt: now, count: 0 }
          : existing;
      bucket.count += 1;
      rateBuckets.set(userId, bucket);
      if (rateBuckets.size > 10_000) {
        const staleBefore = now - c.panel.rate_limit_window_ms * 2;
        for (const [id, candidate] of rateBuckets) {
          if (candidate.startedAt < staleBefore) rateBuckets.delete(id);
        }
      }
      res.setHeader("RateLimit-Limit", String(c.panel.rate_limit_max));
      res.setHeader(
        "RateLimit-Remaining",
        String(Math.max(0, c.panel.rate_limit_max - bucket.count))
      );
      if (bucket.count > c.panel.rate_limit_max) {
        const retryAfter = Math.max(
          1,
          Math.ceil((bucket.startedAt + c.panel.rate_limit_window_ms - now) / 1_000)
        );
        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json({ error: "Too many panel requests. Try again shortly." });
        return;
      }
      next();
    });

    for (const route of contributions.panelRoutes) {
      const fullPath = route.path.startsWith("/api") ? route.path : `/api${route.path}`;
      app[route.method](fullPath, (req, res, next) => {
        Promise.resolve(route.handler(req as PanelRequest, res, next)).catch(next);
      });
    }

    app.use("/api", (_req: Request, res: Response) => {
      res.status(404).json({ error: "API endpoint not found" });
    });

    // Serve the static React build from web/dist if present.
    const publicDir = join(__dirname, "..", "..", "..", "web", "dist");
    if (existsSync(publicDir)) {
      app.use(
        express.static(publicDir, {
          etag: true,
          setHeaders: (res, path) => {
            if (
              path.includes(`${join("assets", "")}`) ||
              path.includes(`${join("_next", "static", "")}`)
            ) {
              res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            }
          },
        })
      );
      app.get("/{*splat}", (_req: Request, res: Response) => {
        res.sendFile(join(publicDir, "index.html"));
      });
    }

    app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
      void next;
      log.error({ err }, "Panel request failed");
      if (res.headersSent) return;
      const status = (err as { status?: unknown }).status;
      const code = typeof status === "number" && status >= 400 && status < 600 ? status : 500;
      res.status(code).json({ error: code === 500 ? "Internal server error" : "Invalid request" });
    });

    server = app.listen(webappPort, () => {
      log.info(`Panel server listening on port ${webappPort}`);
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
  },
  async shutdown() {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    rateBuckets.clear();
  },
};
