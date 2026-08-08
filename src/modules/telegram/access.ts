import type { AccessMode } from "../admin/config.js";
import type { BillingService } from "../billing/service.js";
import type { AdminService } from "../admin/service.js";

export interface AccessDeps {
  billing: BillingService;
  admin: AdminService;
  mode: AccessMode;
  subscriptionStars: number;
}

export type AccessDecision =
  | { ok: true; reason: "admin" | "allowlist" | "subscription" | "open" }
  | {
      ok: false;
      reason: "banned" | "private" | "not_allowed" | "no_subscription";
      message: string;
    };

export function checkAccess(deps: AccessDeps, chatId: number, userId?: number): AccessDecision {
  if (userId && deps.admin.isAdmin(userId)) return { ok: true, reason: "admin" };
  if (userId && deps.admin.isBanned(userId)) {
    return { ok: false, reason: "banned", message: "**You've been banned** from using this bot." };
  }

  if (deps.mode === "private") {
    return {
      ok: false,
      reason: "private",
      message: "This is a **private bot**. Ask its owner for administrator access.",
    };
  }

  const allowlisted = deps.admin.isAllowed(chatId) || (!!userId && deps.admin.isAllowed(userId));
  if (allowlisted) return { ok: true, reason: "allowlist" };

  if (deps.mode === "allowlist") {
    return {
      ok: false,
      reason: "not_allowed",
      message: "This chat isn't authorized. Ask a bot administrator to **allow** it.",
    };
  }

  if (deps.mode === "open") return { ok: true, reason: "open" };

  if (userId) {
    const account = deps.billing.getAccount(userId);
    if (deps.billing.hasActiveSub(account)) return { ok: true, reason: "subscription" };
    return {
      ok: false,
      reason: "no_subscription",
      message: `**Skye Plus** is required to use this bot. Tap \`/plus\` to subscribe with Telegram Stars (**${deps.subscriptionStars} ⭐** / 30 days).`,
    };
  }

  return {
    ok: false,
    reason: "not_allowed",
    message: "This chat isn't authorized. Ask a bot administrator to **allow** it.",
  };
}

export function hasAccess(deps: AccessDeps, chatId: number, userId?: number): boolean {
  return checkAccess(deps, chatId, userId).ok;
}

export function hasMeteredAccess(deps: AccessDeps, chatId: number, userId?: number): boolean {
  if (deps.mode !== "subscription" || !userId) return false;
  const decision = checkAccess(deps, chatId, userId);
  return decision.ok && decision.reason === "subscription";
}
