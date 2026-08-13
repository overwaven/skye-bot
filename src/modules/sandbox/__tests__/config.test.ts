import { describe, expect, it } from "vitest";
import { sandboxConfigSchema } from "../config.js";

describe("sandbox config schema", () => {
  it("parses defaults", () => {
    const parsed = sandboxConfigSchema.parse({}).sandbox;
    expect(parsed.enabled).toBe(true);
    expect(parsed.image).toBe("node:24-bookworm");
    expect(parsed.cpu).toBe(1);
    expect(parsed.memory_gib).toBe(1);
    expect(parsed.disk_gib).toBe(3);
    expect(parsed.auto_stop_minutes).toBe(15);
    expect(parsed.persistent).toBe(false);
    expect(parsed.command_timeout_ms).toBe(60000);
    expect(parsed.max_output_chars).toBe(64000);
    expect(parsed.max_file_bytes).toBe(1000000);
  });

  it("rejects oversized resource and file limits", () => {
    expect(() => sandboxConfigSchema.parse({ sandbox: { cpu: 5 } })).toThrow();
    expect(() => sandboxConfigSchema.parse({ sandbox: { max_file_bytes: 100_000_000 } })).toThrow();
  });

  it("parses boolean flags", () => {
    const parsed = sandboxConfigSchema.parse({
      sandbox: { enabled: false, persistent: true },
    }).sandbox;
    expect(parsed.enabled).toBe(false);
    expect(parsed.persistent).toBe(true);
  });

  it("captures Daytona credentials when present", () => {
    const parsed = sandboxConfigSchema.parse({
      sandbox: {
        daytona_api_key: "dtn_xxx",
        daytona_api_url: "https://daytona.example/api",
        daytona_target: "us",
      },
    }).sandbox;
    expect(parsed.daytona_api_key).toBe("dtn_xxx");
    expect(parsed.daytona_api_url).toBe("https://daytona.example/api");
    expect(parsed.daytona_target).toBe("us");
  });

  it("treats empty daytona credentials as absent", () => {
    const parsed = sandboxConfigSchema.parse({
      sandbox: { daytona_api_key: "" },
    }).sandbox;
    expect(parsed.daytona_api_key).toBeUndefined();
  });
});
