import { describe, expect, it } from "vitest";
import { browserConfigSchema } from "../config.js";

describe("browser config schema", () => {
  it("is disabled by default and applies safe limits", () => {
    const parsed = browserConfigSchema.parse({}).browser;
    expect(parsed.enabled).toBe(false);
    expect(parsed.worker_url).toBe("http://127.0.0.1:8765");
    expect(parsed.max_agent_steps).toBe(25);
    expect(parsed.viewport_width).toBe(1440);
    expect(parsed.prohibited_domains).toContain("169.254.169.254");
  });

  it("treats empty credentials as absent", () => {
    const parsed = browserConfigSchema.parse({
      browser: { worker_token: "", agent_api_key: "", agent_base_url: "" },
    }).browser;
    expect(parsed.worker_token).toBeUndefined();
    expect(parsed.agent_api_key).toBeUndefined();
    expect(parsed.agent_base_url).toBeUndefined();
  });

  it("rejects unsafe resource values", () => {
    expect(() => browserConfigSchema.parse({ browser: { max_agent_steps: 101 } })).toThrow();
    expect(() => browserConfigSchema.parse({ browser: { viewport_width: 400 } })).toThrow();
    expect(() =>
      browserConfigSchema.parse({ browser: { max_screenshot_bytes: 30 * 1024 * 1024 } })
    ).toThrow();
  });
});
