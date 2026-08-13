import type { SkyeModule } from "../../core/module.js";
import { billingConfigSchema, type TokenPack } from "./config.js";
import { migrations } from "./migrations.js";
import { BillingService } from "./service.js";
import { buildBilling, type BillingDeps } from "./tele.js";
import { decodeInvoiceConfig } from "./invoices.js";
import { buildRoutes } from "./routes.js";

export interface BillingConfig {
  baseQuotaTokens: number;
  periodSeconds: number;
}

declare module "../../core/module.js" {
  interface SkyeServices {
    billing: BillingService;
  }
}

export const billingModule: SkyeModule = {
  name: "billing",
  configSchema: billingConfigSchema,
  migrations,
  init(ctx) {
    const c = ctx.config;
    const llm = ctx.services.get("llm");
    const billingConfig: BillingConfig = {
      baseQuotaTokens: c.billing.base_quota_tokens,
      periodSeconds: c.billing.subscription_period_seconds,
    };
    const billing = new BillingService(billingConfig, () => llm.defaultModelId);
    ctx.services.set("billing", billing);

    const deps: BillingDeps = {
      enabled: c.billing.enabled,
      billing,
      llm,
      cfg: decodeInvoiceConfig(ctx.config),
      packs: c.billing.token_packs as TokenPack[],
      webappUrl: ctx.config.panel.webapp_url,
    };
    const { commands, handlers } = buildBilling(deps);

    return {
      service: billing,
      commands: c.billing.enabled ? commands : [],
      telegramHandlers: handlers,
      panelRoutes: buildRoutes(ctx),
    };
  },
};
