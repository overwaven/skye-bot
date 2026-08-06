import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { composeSchema, loadConfig, resetConfigCache } from "../config.js";
import {
  contentEtag,
  listTopLevelKeys,
  readConfigSource,
  validateConfigYaml,
  writeConfigSource,
} from "../configFile.js";
import type { SkyeModule } from "../module.js";

const fixtureDir = join(process.cwd(), "data", "test-config-editor");
const fixturePath = join(fixtureDir, "config.yaml");

const stubModules: readonly SkyeModule[] = [
  {
    name: "stub",
    configSchema: z.object({
      bot_token: z.string().min(1),
      openai_key: z.string().min(1),
      access: z
        .object({
          mode: z.enum(["private", "allowlist", "subscription", "open"]).default("private"),
        })
        .default({ mode: "private" }),
      billing: z
        .object({
          enabled: z.boolean().default(false),
        })
        .default({ enabled: false }),
      owner: z
        .object({
          user_id: z.number().int().default(0),
        })
        .default({ user_id: 0 }),
    }),
  },
];

function minimalYaml(extra = ""): string {
  return [
    'bot_token: "123:ABC"',
    'openai_key: "sk-test"',
    "access:",
    '  mode: "private"',
    "billing:",
    "  enabled: false",
    "owner:",
    "  user_id: 1",
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}

beforeEach(() => {
  resetConfigCache();
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(fixturePath, minimalYaml(), "utf8");
  process.env.SKYE_CONFIG = fixturePath;
  loadConfig(stubModules);
});

afterEach(() => {
  resetConfigCache();
  delete process.env.SKYE_CONFIG;
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("configFile", () => {
  test("reads source with etag and sections", () => {
    const source = readConfigSource();
    expect(source.name).toBe("config.yaml");
    expect(source.content).toContain("bot_token");
    expect(source.etag).toBe(contentEtag(source.content));
    expect(listTopLevelKeys(source.content).map((s) => s.key)).toEqual(
      expect.arrayContaining(["bot_token", "openai_key", "access", "billing", "owner"])
    );
  });

  test("validates yaml and rejects broken documents", () => {
    expect(validateConfigYaml(minimalYaml(), stubModules).ok).toBe(true);
    const bad = validateConfigYaml("bot_token: []\n", stubModules);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.length).toBeGreaterThan(0);
  });

  test("rejects subscription without billing", () => {
    const yaml = minimalYaml().replace('mode: "private"', 'mode: "subscription"');
    const result = validateConfigYaml(yaml, stubModules);
    expect(result.ok).toBe(false);
  });

  test("writes atomically with backup and etag check", () => {
    const before = readConfigSource();
    const next = minimalYaml("log_level: debug\n");
    const written = writeConfigSource({
      content: next,
      etag: before.etag,
      modules: stubModules,
    });
    expect(written.source.content).toContain("log_level: debug");
    expect(readFileSync(fixturePath, "utf8")).toContain("log_level: debug");
    expect(written.backupPath).toBeTruthy();
    expect(readFileSync(written.backupPath!, "utf8")).toBe(before.content);

    expect(() =>
      writeConfigSource({
        content: minimalYaml(),
        etag: before.etag,
        modules: stubModules,
      })
    ).toThrow(/changed on disk/i);
  });

  test("composeSchema remains available for fixtures", () => {
    const schema = composeSchema(stubModules);
    expect(schema.safeParse({ bot_token: "x", openai_key: "y" }).success).toBe(true);
  });
});
