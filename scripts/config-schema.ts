#!/usr/bin/env tsx
/**
 * Auto-generate docs/configuration-schema.md from the module config schemas.
 *
 * Introspects every module's Zod `configSchema` and writes a reference table
 * mapping YAML paths to types, defaults, and bounds. Re-run after adding or
 * changing a module schema: `pnpm config:schema`.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import type { ZodObject, ZodTypeAny } from "zod";

import { composeSchema } from "../src/core/config.js";
import { modules } from "../src/modules.js";

interface LeafDef {
  yamlPath: string;
  module: string;
  type: string;
  required: boolean;
  defaultStr: string;
  enumVals: string[];
  bounds: string;
}

interface LeafInfo {
  defaults: unknown[];
  optional: boolean;
  leaf: string;
  enum: string[] | null;
  bounds: string[];
}

function introspect(s: ZodTypeAny): LeafInfo {
  const info: LeafInfo = {
    defaults: [],
    optional: false,
    leaf: "unknown",
    enum: null,
    bounds: [],
  };

  function walk(n: ZodTypeAny): void {
    if (!n) return;
    const d = (n as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
    switch (d.type) {
      case "default":
        info.defaults.push(d.defaultValue);
        if (d.innerType) walk(d.innerType as ZodTypeAny);
        return;
      case "optional":
        info.optional = true;
        if (d.innerType) walk(d.innerType as ZodTypeAny);
        return;
      case "pipe":
        if (d.in) walk(d.in as ZodTypeAny);
        if (d.out) walk(d.out as ZodTypeAny);
        return;
      case "transform":
      case "preprocess":
        if (d.in) walk(d.in as ZodTypeAny);
        return;
      case "union": {
        if (d.options) {
          for (const opt of d.options as ZodTypeAny[]) {
            const od = (opt as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
            if (od.type !== "literal") {
              walk(opt);
              return;
            }
          }
          walk((d.options as ZodTypeAny[])[0]!);
        }
        return;
      }
      default:
        info.leaf = d.type as string;
        if (d.type === "enum" && d.entries) {
          info.enum = Object.values(d.entries as Record<string, string>);
        }
        if (d.checks) {
          for (const c of d.checks as Array<{ _zod: { def: Record<string, unknown> } }>) {
            const cd = c._zod.def;
            if (cd.check === "greater_than") {
              info.bounds.push(`${cd.inclusive ? "≥" : ">"} ${cd.value}`);
            } else if (cd.check === "less_than") {
              info.bounds.push(`${cd.inclusive ? "≤" : "<"} ${cd.value}`);
            } else if (cd.check === "min_length") {
              info.bounds.push(`min length ${cd.minimum ?? cd.value}`);
            } else if (cd.check === "max_length") {
              info.bounds.push(`max length ${cd.maximum ?? cd.value}`);
            }
          }
        }
        return;
    }
  }

  walk(s);
  return info;
}

function typeLabel(info: LeafInfo): string {
  const t = info.leaf;
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "enum") return "enum";
  if (t === "array") return "array";
  if (t === "object") return "object";
  return t;
}

interface RawShape {
  [key: string]: ZodTypeAny;
}

function collectLeaves(shape: RawShape, prefix: string, moduleMap: Map<string, string>): LeafDef[] {
  const leaves: LeafDef[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    const yamlPath = prefix ? `${prefix}.${key}` : key;

    // Drill into default/optional/pipe/preprocess wrappers to find the inner object.
    let inner = schema;
    while (true) {
      const def = (inner as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
      if (def.type === "default" && def.innerType) {
        inner = def.innerType as ZodTypeAny;
        continue;
      }
      if (def.type === "optional" && def.innerType) {
        inner = def.innerType as ZodTypeAny;
        continue;
      }
      // section() wraps objects in z.preprocess → Zod v4 represents it as a
      // pipe; the inner object schema is in def.out.
      if (def.type === "pipe" && def.out) {
        inner = def.out as ZodTypeAny;
        continue;
      }
      break;
    }

    const innerDef = (inner as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
    if (innerDef.type === "object" && innerDef.shape) {
      leaves.push(...collectLeaves(innerDef.shape as RawShape, yamlPath, moduleMap));
      continue;
    }

    const info = introspect(schema);
    const def = info.defaults[0];
    const defStr =
      def === undefined
        ? ""
        : typeof def === "string"
          ? def
          : Array.isArray(def)
            ? JSON.stringify(def)
            : String(def);
    leaves.push({
      yamlPath,
      module: moduleMap.get(key) ?? prefix ?? "?",
      type: typeLabel(info),
      required: !info.optional && info.defaults.length === 0,
      defaultStr: defStr,
      enumVals: info.enum ?? [],
      bounds: info.bounds.join(", "),
    });
  }
  return leaves;
}

function main(): void {
  const schema = composeSchema(modules);
  const shape = (schema as ZodObject<RawShape>).shape as RawShape;

  // Build a map: top-level key → module name, by checking each module's configSchema.
  const moduleMap = new Map<string, string>();
  for (const mod of modules) {
    if (!mod.configSchema) continue;
    const modShape = (mod.configSchema as ZodObject<RawShape>).shape as RawShape;
    for (const key of Object.keys(modShape)) {
      moduleMap.set(key, mod.name);
    }
  }
  // Core keys.
  moduleMap.set("db_path", "core");
  moduleMap.set("log_level", "core");

  const leaves = collectLeaves(shape, "", moduleMap);

  // Group by top-level YAML section.
  const bySection = new Map<string, LeafDef[]>();
  for (const leaf of leaves) {
    const section = leaf.yamlPath.includes(".") ? leaf.yamlPath.split(".")[0]! : leaf.module;
    const arr = bySection.get(section) ?? [];
    arr.push(leaf);
    bySection.set(section, arr);
  }

  const lines: string[] = [
    "# Configuration Schema",
    "",
    "Auto-generated from `src/modules/*/config.ts` Zod schemas by `pnpm config:schema`.",
    "Do not edit by hand — re-run after changing a module's `configSchema`.",
    "",
    "Each module declares its YAML section as a Zod object. At startup,",
    "`config.yaml` is parsed and validated against the composed schema.",
    "The result is a typed `SkyeConfig` object consumed by modules via",
    "`ctx.config.section.key` (camelCase keys in TypeScript).",
    "",
    "Legend: **Required** = no default and not optional. **Default** = used",
    "when the key is absent. **Bounds** = numeric min/max or string length.",
    "",
  ];

  for (const [section, items] of [...bySection.entries()].sort()) {
    items.sort((a, b) => a.yamlPath.localeCompare(b.yamlPath));
    lines.push(`## ${section}`, "");
    lines.push("| YAML path | Module | Type | Required | Default | Enum | Bounds |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const i of items) {
      const req = i.required ? "yes" : "";
      const def = i.defaultStr ? `\`${i.defaultStr.replace(/\|/g, "\\|")}\`` : "";
      const en = i.enumVals.length ? i.enumVals.join(", ") : "";
      lines.push(
        `| \`${i.yamlPath}\` | ${i.module} | ${i.type} | ${req} | ${def} | ${en} | ${i.bounds} |`
      );
    }
    lines.push("");
  }

  lines.push(
    "## Cross-field rules",
    "",
    '- If any model in `models[]` sets `provider: "perplexity"`, then',
    "  `perplexity_api_key` must be set.",
    '- If any model in `models[]` sets `provider: "xai"`, then',
    "  `xai_api_key` must be set.",
    '- `image.provider: "xai"` requires `image.api_key` or `xai_api_key`.',
    '- `voice.provider: "yandex"` requires `voice.yc_api_key` for STT/TTS.',
    '- `voice.provider: "openrouter"` falls back to `openai_key` when',
    "  `voice.openrouter.api_key` is empty.",
    '- `voice.provider: "xai"` falls back to `xai_api_key` when',
    "  `voice.xai.api_key` is empty.",
    "- `sandbox.enabled: true` requires `sandbox.daytona_api_key`.",
    '- `access.mode: "subscription"` requires `billing.enabled: true`.',
    "- If `owner.user_id` is `0`, first run prints a one-time `/claim_owner`",
    "  token to the operator log and persists the claimed Telegram user ID.",
    ""
  );

  const outPath = join(process.cwd(), "docs", "configuration-schema.md");
  writeFileSync(outPath, lines.join("\n"));
  console.log(`✓ wrote ${outPath} (${leaves.length} keys across ${bySection.size} sections)`);
}

main();
