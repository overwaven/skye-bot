import type { SkyeModule } from "../../core/module.js";
import { providersConfigSchema } from "./config.js";
import { migrations } from "./migrations.js";
import { buildProviderRoutes } from "./routes.js";
import { ProviderService } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    providers: ProviderService;
  }
}

export const providersModule: SkyeModule = {
  name: "providers",
  configSchema: providersConfigSchema,
  migrations,
  init(ctx) {
    const providers = new ProviderService(ctx.db, ctx.config.bot_token);
    if (ctx.config.ai.providers.length > 0) providers.syncConfig(ctx.config.ai);
    else providers.seedLegacy(ctx.config);
    return {
      service: providers,
      panelRoutes: buildProviderRoutes(ctx, providers),
    };
  },
};
