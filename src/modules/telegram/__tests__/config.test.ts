import { describe, expect, it } from "vitest";
import { telegramConfigSchema } from "../config.js";

describe("telegram config security limits", () => {
  it("keeps pending updates and applies a bounded job timeout by default", () => {
    const c = telegramConfigSchema.parse({ bot_token: "token" });
    expect(c.telegram_drop_pending_updates).toBe("0");
    expect(c.telegram_job_timeout_ms).toBe(180_000);
    expect(c.telegram_max_concurrent_jobs).toBe(64);
  });

  it("rejects unsafe queue timeout values", () => {
    expect(() =>
      telegramConfigSchema.parse({ bot_token: "token", telegram_job_timeout_ms: 9_999 })
    ).toThrow();
    expect(() =>
      telegramConfigSchema.parse({ bot_token: "token", telegram_job_timeout_ms: 900_001 })
    ).toThrow();
    expect(() =>
      telegramConfigSchema.parse({ bot_token: "token", telegram_max_concurrent_jobs: 1 })
    ).toThrow();
  });

  it("defaults attachment downloads to 25 MiB", () => {
    expect(telegramConfigSchema.parse({ bot_token: "token" }).telegram_max_attachment_bytes).toBe(
      25 * 1024 * 1024
    );
  });

  it("rejects attachment limits above 50 MiB", () => {
    expect(() =>
      telegramConfigSchema.parse({
        bot_token: "token",
        telegram_max_attachment_bytes: 51 * 1024 * 1024,
      })
    ).toThrow();
  });
});
