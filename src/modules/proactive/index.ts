import type { SkyeModule } from "../../core/module.js";
import { proactiveConfigSchema } from "./config.js";
import { ProactiveService, type ProactiveSettings } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    proactive: ProactiveService;
  }
}

export const proactiveModule: SkyeModule = {
  name: "proactive",
  configSchema: proactiveConfigSchema,
  init(ctx) {
    const c = ctx.config.proactive;
    const settings: ProactiveSettings = {
      enabled: c.enabled,
      probability: c.probability,
      warmup: c.warmup,
      minIntervalSec: c.min_interval_sec,
      contextSize: c.context_size,
    };
    const service = new ProactiveService(
      {
        llm: ctx.services.get("llm"),
        chatLog: ctx.services.get("chatLog"),
        memory: ctx.services.get("memory"),
      },
      settings
    );
    return { service };
  },
};
