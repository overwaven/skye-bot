import { describe, expect, test, vi } from "vitest";
import { checkAccess, hasMeteredAccess, type AccessDeps } from "../access.js";

function deps(
  options: {
    mode?: AccessDeps["mode"];
    admin?: boolean;
    allowed?: boolean;
    banned?: boolean;
    subscribed?: boolean;
  } = {}
): AccessDeps {
  return {
    mode: options.mode ?? "subscription",
    subscriptionStars: 1899,
    billing: {
      getAccount: vi.fn().mockReturnValue({}),
      hasActiveSub: vi.fn().mockReturnValue(options.subscribed ?? false),
    } as unknown as AccessDeps["billing"],
    admin: {
      isAdmin: vi.fn().mockReturnValue(options.admin ?? false),
      isAllowed: vi.fn().mockReturnValue(options.allowed ?? false),
      isBanned: vi.fn().mockReturnValue(options.banned ?? false),
    } as unknown as AccessDeps["admin"],
  };
}

describe("access modes", () => {
  test("private mode only allows administrators", () => {
    expect(checkAccess(deps({ mode: "private" }), 10, 20).ok).toBe(false);
    expect(checkAccess(deps({ mode: "private", admin: true }), 10, 20)).toMatchObject({
      ok: true,
      reason: "admin",
    });
  });

  test("allowlist mode allows approved targets", () => {
    expect(checkAccess(deps({ mode: "allowlist", allowed: true }), 10, 20)).toMatchObject({
      ok: true,
      reason: "allowlist",
    });
  });

  test("subscription mode meters only subscription-granted access", () => {
    const paid = deps({ subscribed: true });
    expect(hasMeteredAccess(paid, 10, 20)).toBe(true);
    expect(hasMeteredAccess(deps({ subscribed: true, allowed: true }), 10, 20)).toBe(false);
    expect(hasMeteredAccess(deps({ mode: "open", subscribed: true }), 10, 20)).toBe(false);
  });

  test("open mode still honors bans for non-admins", () => {
    expect(checkAccess(deps({ mode: "open", banned: true }), 10, 20)).toMatchObject({
      ok: false,
      reason: "banned",
    });
    expect(checkAccess(deps({ mode: "open", banned: true, admin: true }), 10, 20).ok).toBe(true);
  });

  test("bans are checked before public-command bypass would apply", () => {
    const banned = checkAccess(deps({ mode: "open", banned: true }), 10, 20);
    expect(banned.reason).toBe("banned");
  });
});
