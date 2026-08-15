import type { SkyeModule } from "../../core/module.js";
import { browserConfigSchema } from "./config.js";
import { BrowserService } from "./service.js";
import { browserTools } from "./tools.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    browser: BrowserService;
  }
}

export const browserModule: SkyeModule = {
  name: "browser",
  configSchema: browserConfigSchema,
  init(ctx) {
    const c = ctx.config.browser;
    const llm = ctx.services.get("llm");
    const defaultAgentModel = c.enabled ? llm.resolveModel().model : undefined;
    const service = new BrowserService({
      enabled: c.enabled,
      workerUrl: c.worker_url,
      workerToken: c.worker_token,
      requestTimeoutMs: c.request_timeout_ms,
      maxOutputChars: c.max_output_chars,
      maxScreenshotBytes: c.max_screenshot_bytes,
      maxAgentSteps: c.max_agent_steps,
      viewportWidth: c.viewport_width,
      viewportHeight: c.viewport_height,
      allowedDomains: c.allowed_domains,
      prohibitedDomains: c.prohibited_domains,
      agentModel: c.agent_model ?? defaultAgentModel,
      agentApiKey: c.agent_api_key ?? (ctx.config.openai_key || undefined),
      agentBaseUrl: c.agent_base_url ?? ctx.config.base_url,
    });
    return { service, tools: c.enabled ? browserTools(service) : [] };
  },
};
