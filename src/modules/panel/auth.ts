import { createHmac, timingSafeEqual } from "crypto";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  queryId?: string;
  authDate: number;
}

export type InitDataValidationResult =
  | { ok: true; data: ValidatedInitData }
  | { ok: false; reason: "missing" | "invalid" | "expired" };

/**
 * Validate Telegram WebApp initData against the bot token using the documented
 * HMAC scheme. Returns the parsed user payload, or null if invalid/expired.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
  nowSeconds = Date.now() / 1_000
): ValidatedInitData | null {
  const result = validateInitDataDetailed(initData, botToken, maxAgeSeconds, nowSeconds);
  return result.ok ? result.data : null;
}

export function validateInitDataDetailed(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
  nowSeconds = Date.now() / 1_000
): InitDataValidationResult {
  if (!initData) return { ok: false, reason: "missing" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: "invalid" };

  const dataCheckString = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const expected = Buffer.from(computedHash, "hex");
  const supplied = Buffer.from(hash, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return { ok: false, reason: "invalid" };
  }

  const authDate = Number(params.get("auth_date"));
  const age = nowSeconds - authDate;
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || age < -30) {
    return { ok: false, reason: "invalid" };
  }
  if (age > maxAgeSeconds) return { ok: false, reason: "expired" };

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "invalid" };

  try {
    const user = JSON.parse(userRaw) as TelegramUser;
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string") {
      return { ok: false, reason: "invalid" };
    }
    return {
      ok: true,
      data: {
        user,
        queryId: params.get("query_id") ?? undefined,
        authDate,
      },
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
