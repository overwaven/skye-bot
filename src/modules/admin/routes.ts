import { basename } from "path";
import type { ModuleContext, PanelRoute } from "../../core/module.js";
import {
  listTopLevelKeys,
  readConfigSource,
  validateConfigYaml,
  writeConfigSource,
  type ConfigIssue,
} from "../../core/configFile.js";
import { log } from "../../utils/log.js";
import type { PanelRequest } from "../panel/index.js";

function ownerOnly(ctx: ModuleContext, req: PanelRequest): boolean {
  return ctx.services.get("admin").isOwner(req.initData.user.id);
}

function rejectUnlessOwner(
  ctx: ModuleContext,
  req: PanelRequest,
  res: { status: (code: number) => { json: (body: unknown) => void } }
): boolean {
  if (ownerOnly(ctx, req)) return false;
  res.status(403).json({ error: "Primary owner access required" });
  return true;
}

function scheduleProcessRestart(userId: number): void {
  log.warn({ userId, delayMs: 750 }, "Owner requested process restart after config save");
  setTimeout(() => {
    log.info("Exiting so the process manager can reload the new config");
    process.exit(0);
  }, 750).unref?.();
}

export function buildAdminRoutes(ctx: ModuleContext): PanelRoute[] {
  const admin = ctx.services.get("admin");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);

  return [
    {
      method: "get",
      path: "/admin/principals",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!admin.isAdmin(panelReq.initData.user.id)) {
          res.status(403).json({ error: "Administrator access required" });
          return;
        }
        res.json({
          ownerUserId: admin.ownerUserId() ?? null,
          canManage: admin.isOwner(panelReq.initData.user.id),
          admins: admin.listAdmins(),
        });
      },
    },
    {
      method: "post",
      path: "/admin/principals",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!ownerOnly(ctx, panelReq)) {
          res.status(403).json({ error: "Primary owner access required" });
          return;
        }
        const body = req.body as { userId?: unknown } | undefined;
        const userId = Number(body?.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) {
          res.status(400).json({ error: "A valid Telegram user ID is required" });
          return;
        }
        if (!admin.addAdmin(userId, panelReq.initData.user.id)) {
          res.status(409).json({ error: "That user is already an administrator" });
          return;
        }
        audit()?.event({
          action: "admin_added",
          userId: panelReq.initData.user.id,
          details: { targetUserId: userId, source: "panel" },
        });
        res.status(201).json({ admins: admin.listAdmins() });
      },
    },
    {
      method: "delete",
      path: "/admin/principals/:userId",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!ownerOnly(ctx, panelReq)) {
          res.status(403).json({ error: "Primary owner access required" });
          return;
        }
        const userId = Number(req.params.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) {
          res.status(400).json({ error: "Invalid Telegram user ID" });
          return;
        }
        const result = admin.removeAdmin(userId);
        if (result === "protected") {
          res
            .status(409)
            .json({ error: "This administrator is protected by owner or config settings" });
          return;
        }
        if (result === "not_found") {
          res.status(404).json({ error: "Delegated administrator not found" });
          return;
        }
        audit()?.event({
          action: "admin_removed",
          userId: panelReq.initData.user.id,
          details: { targetUserId: userId, source: "panel" },
        });
        res.json({ admins: admin.listAdmins() });
      },
    },
    {
      method: "get",
      path: "/admin/system-config",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (rejectUnlessOwner(ctx, panelReq, res)) return;
        try {
          const source = readConfigSource();
          res.json({
            name: source.name,
            path: source.path,
            size: source.size,
            mtimeMs: source.mtimeMs,
            etag: source.etag,
            byteLength: source.byteLength,
            content: source.content,
            sections: listTopLevelKeys(source.content),
            restartRequired: true,
            note: "Most settings apply only after Skye restarts. Secrets (bot token, API keys) are visible to the primary owner.",
          });
        } catch (e) {
          const status = (e as { status?: number }).status ?? 500;
          res.status(status).json({
            error: e instanceof Error ? e.message : "Unable to read config",
          });
        }
      },
    },
    {
      method: "post",
      path: "/admin/system-config/validate",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (rejectUnlessOwner(ctx, panelReq, res)) return;
        const body = req.body as { content?: unknown } | undefined;
        if (typeof body?.content !== "string") {
          res.status(400).json({ error: "content must be a YAML string" });
          return;
        }
        const result = validateConfigYaml(body.content);
        res.json({
          ok: result.ok,
          issues: result.ok ? [] : result.issues,
          warnings: result.warnings,
          sections: listTopLevelKeys(body.content),
        });
      },
    },
    {
      method: "put",
      path: "/admin/system-config",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (rejectUnlessOwner(ctx, panelReq, res)) return;
        const body = req.body as
          | {
              content?: unknown;
              etag?: unknown;
              restart?: unknown;
            }
          | undefined;
        if (typeof body?.content !== "string") {
          res.status(400).json({ error: "content must be a YAML string" });
          return;
        }
        if (typeof body?.etag !== "string" || !body.etag) {
          res.status(400).json({ error: "etag is required for concurrent-edit protection" });
          return;
        }
        const restart = body.restart === true;
        try {
          const written = writeConfigSource({
            content: body.content,
            etag: body.etag,
          });
          audit()?.event({
            action: "system_config_saved",
            userId: panelReq.initData.user.id,
            details: {
              source: "panel",
              name: written.source.name,
              byteLength: written.source.byteLength,
              backup: written.backupPath ? basename(written.backupPath) : null,
              restart,
              // Never log YAML contents — secrets live in this file.
            },
          });
          log.info(
            {
              userId: panelReq.initData.user.id,
              name: written.source.name,
              byteLength: written.source.byteLength,
              restart,
            },
            "System config saved from panel"
          );
          if (restart) scheduleProcessRestart(panelReq.initData.user.id);
          res.json({
            ok: true as const,
            name: written.source.name,
            path: written.source.path,
            size: written.source.size,
            mtimeMs: written.source.mtimeMs,
            etag: written.source.etag,
            byteLength: written.source.byteLength,
            content: written.source.content,
            sections: listTopLevelKeys(written.source.content),
            warnings: written.warnings,
            backupName: written.backupPath ? basename(written.backupPath) : null,
            restartScheduled: restart,
            restartRequired: !restart,
          });
        } catch (e) {
          const status = (e as { status?: number }).status ?? 500;
          const issues = (e as { issues?: ConfigIssue[] }).issues;
          const warnings = (e as { warnings?: string[] }).warnings;
          res.status(status).json({
            error: e instanceof Error ? e.message : "Unable to save config",
            ...(issues ? { issues } : {}),
            ...(warnings ? { warnings } : {}),
          });
        }
      },
    },
  ];
}
