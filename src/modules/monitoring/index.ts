import { closeSync, fstatSync, openSync, readSync } from "fs";
import type { SkyeModule } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { monitoringConfigSchema } from "./config.js";
import { MonitoringService } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    monitoring: MonitoringService;
  }
}

const MAX_BYTES = 256 * 1024;
const MAX_LINES = 250;

function tail(file?: string): string[] {
  if (!file) return [];

  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, MAX_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, Math.max(0, size - length));
    return buffer
      .toString("utf8")
      .split("\n")
      .slice(size > MAX_BYTES ? 1 : 0)
      .filter(Boolean)
      .slice(-MAX_LINES);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export const monitoringModule: SkyeModule = {
  name: "monitoring",
  configSchema: monitoringConfigSchema,
  init(ctx) {
    const c = ctx.config;
    const outLog = c.monitoring.out_log;
    const errorLog = c.monitoring.error_log;
    const service = new MonitoringService(ctx.db, ctx.services, ctx.config.reminders.enabled);

    return {
      service,
      panelRoutes: [
        {
          method: "get",
          path: "/monitoring",
          handler: (req, res) => {
            const panelReq = req as PanelRequest;
            const admin = ctx.services.get("admin");
            if (!admin.isAdmin(panelReq.initData.user.id)) {
              res.status(403).json({ error: "Administrator access required" });
              return;
            }

            res.json({
              status: "ok",
              startedAt: service.startedAt,
              uptimeSeconds: Math.floor(process.uptime()),
              health: service.ready(),
              telegram: ctx.services.has("telegramReliability")
                ? ctx.services.get("telegramReliability").diagnostics()
                : undefined,
              reminders: ctx.services.has("reminderScheduler")
                ? ctx.services.get("reminderScheduler").diagnostics()
                : undefined,
              logs: { out: tail(outLog), error: tail(errorLog) },
            });
          },
        },
      ],
    };
  },
};
