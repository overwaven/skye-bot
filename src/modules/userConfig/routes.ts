import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const userConfig = ctx.services.get("userConfig");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);

  return [
    {
      method: "get",
      path: "/config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const config = userConfig.get(userId);
        res.json({
          ...(config.primaryAgentId ? { primaryAgentId: config.primaryAgentId } : {}),
        });
      },
    },
    {
      method: "put",
      path: "/config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        // Personality and custom instructions moved to agents; keep endpoint for compatibility.
        audit()?.event({
          action: "settings_saved",
          userId,
          details: { changed: [] },
        });
        const config = userConfig.get(userId);
        res.json({
          ...(config.primaryAgentId ? { primaryAgentId: config.primaryAgentId } : {}),
        });
      },
    },
  ];
}
