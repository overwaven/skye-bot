import type { SkyeModule } from "../../core/module.js";
import { auditConfigSchema } from "./config.js";
import { migrations } from "./migrations.js";
import { buildRoutes } from "./routes.js";
import {
  type AuditEntry,
  type AuditService,
  logActivity,
  logRequest,
  scheduleAuditPruning,
} from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    audit: AuditService;
  }
}

export const auditModule: SkyeModule = {
  name: "audit",
  configSchema: auditConfigSchema,
  migrations,
  init(ctx) {
    const c = ctx.config.audit;
    const model = ctx.services.get("llm").defaultModelId;
    const service: AuditService = {
      log(entry: AuditEntry) {
        logRequest(entry, model);
      },
      event(entry) {
        logActivity(entry);
      },
    };
    ctx.services.set("audit", service);
    scheduleAuditPruning(c.retention_days, c.max_rows);
    return { service, panelRoutes: buildRoutes(ctx) };
  },
};
