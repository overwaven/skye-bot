# Repository Guidelines

This document captures how we work in this repo. It is intended for contributors and automation agents alike.

## Project Overview

Skye is a calm, minimal AI assistant for Telegram, built with [grammy](https://grammy.dev/) + an OpenAI-compatible LLM API (OpenRouter by default, with optional Perplexity Agent API routing). It supports streaming chat, long-term memory, image generation/editing/vision, voice (Yandex SpeechKit, OpenRouter, or Tinfoil STT/TTS), document/PDF reading, managed Composio apps and custom HTTPS connectors, a per-chat Daytona Sandbox, reminders, proactive messages, user-defined agents, Telegram channel capture, Telegram Stars billing, audit logging, and a Telegram Mini App settings panel (`web/`). State lives in a single SQLite database (`better-sqlite3`).

User-facing documentation is published at [skye-bot.com](https://skye-bot.com). In-repo reference: `config.example.yaml`.

## Architecture: The Module System

Everything is a `SkyeModule` (see `src/core/module.ts`). Modules are declared in a fixed-order array in `src/modules.ts`; order matters because modules consume earlier ones' services (e.g. `llm` before `billing` and `telegram`, `userConfig` before `connectors`, `admin` before `telegram`, `telegram` last). The host boot sequence lives in `src/core/bootstrap.ts`; `src/index.ts` loads config, runs migrations, and starts modules.

Each module optionally provides:

- `configSchema`: Zod object for the module's YAML config section (native YAML keys, snake_case).
- `migrations[]`: Idempotent schema migrations keyed `${module.name}:${migration.id}`, tracked in a `migrations` table.
- `init(ctx)`: Returns `{ service, tools, commands, telegramHandlers, panelRoutes }`.
- `start(ctx, contributions, extra)`: Second phase; `telegram` and `panel` consume the aggregated bot/Express app.
- `shutdown()`: Cleanup in reverse order.

`ModuleContext` exposes `db`, `config`, `logger`, `events` (an `EventBus`), and `services` (a typed `ServiceRegistry`). Modules register services via `declare module` on `SkyeServices`. Request identity is a `TenantContext` (`src/core/tenant.ts`) — chat scope vs. user scope for Telegram and panel surfaces.

Config is loaded once from `config.yaml`, validated against the composed Zod schema, and passed as a typed `SkyeConfig` via `ctx.config`. Runtime config uses YAML only (override the path with `SKYE_CONFIG`). Each module augments `SkyeConfig` via `declare module` to add its typed section.

Current modules (see `src/modules.ts` for the authoritative order): `llm`, `userConfig`, `chatConfig`, `admin`, `billing`, `memory`, `chatLog`, `speech`, `audit`, `monitoring`, `jobs`, `connectors`, `sandbox`, `proactive`, `reminders`, `channel`, `agentRuntime`, `panel`, `legal`, `telegram`.

New domains go in `src/modules/<name>/` exporting a `SkyeModule`, register their service type, and add themselves to the array in `src/modules.ts`.

## Build, Test, and Development Commands

Package manager is **pnpm** (workspace includes `web/`). Node 22+.

- `pnpm run dev` / `pnpm run dev:pretty`: Run the bot with `tsx watch` (plain or pretty logs).
- `pnpm start`: Run once without watch (still via `tsx`).
- `pnpm run build`: Compile to `dist/` via `tsc -p tsconfig.build.json`.
- `pnpm run typecheck`: Type-check only.
- `pnpm run lint` / `pnpm run lint:fix`: ESLint flat config.
- `pnpm run format` / `pnpm run format:check`: Prettier.
- `pnpm run test` / `pnpm run test:watch`: Vitest.
- `pnpm --filter skye-panel build`: Build the web panel only.
- `pnpm validate-config`: Validate `config.yaml` against the composed module config schemas (run before booting if you changed config).
- `pnpm config:schema`: Regenerate `docs/configuration-schema.md` from the module Zod schemas (run after adding/changing a module's `configSchema`).

Local dev runs TypeScript directly via `tsx`; production runs `node dist/index.js`.

## Testing Guidelines

Tests use **Vitest** (`vitest.config.ts`) with in-memory SQLite (`DB_PATH=:memory:` in the Vitest env) and a setup file (`src/__tests__/setup.ts`) that applies module migrations. Test files match `src/**/*.test.ts` (often colocated under `src/**/__tests__/`). Mirror existing patterns (service-level integration tests backed by the real SQLite DB), keep them deterministic and side-effect-free.

## Coding Style & Naming Conventions

- Language: TypeScript (ESM, `"type": "module"`), `strict` mode, `moduleResolution: Bundler`, target `ES2022`.
- Imports use explicit `.js` extensions in relative paths (required by ESM + tsx), e.g. `import { log } from "../../utils/log.js"`.
- Indentation: 2 spaces. Formatting: Prettier. Linting: ESLint with `typescript-eslint`; `@typescript-eslint/no-explicit-any` is a warning, not an error.
- File naming: lower camelCase for modules.
- Keep functions small and focused; prefer clear names over comments. Do not add comments unless asked.

## Commit & Pull Request Guidelines

This repo uses **git** with a standard PR flow. Recent commit history uses short, imperative messages (e.g. "Add long-term memory", "Fix image processing issue"). Please follow that style.

For pull requests:

- Include a concise summary and a short testing note (e.g. "Tested: `pnpm run dev`").
- Link related issues when applicable.
- Include screenshots only if UI output changes.

Run `pnpm run typecheck`, `pnpm run lint`, and `pnpm run test` before submitting; fix anything you broke.

## Configuration & Secrets

Create a `config.yaml` based on `config.example.yaml`. Required: `bot_token`, `openai_key`. Everything else has sensible defaults (OpenRouter). Never commit real secrets (`config.yaml` is gitignored). Full variable reference lives in `config.example.yaml`; regenerate the auto-generated schema reference with `pnpm config:schema` when module schemas change. Validate before booting with `pnpm validate-config`.

Provider credentials are global (`openai_key`, optional `perplexity_api_key`, image/speech/sandbox keys in their sections). Per-user BYOK was removed — users pick models and personalities, not upstream API keys.

Access is controlled via `access.mode` (`private`, `allowlist`, `subscription`, `open`) and the `admin` module; see `config.example.yaml` for semantics.

## Useful Pointers

- Module registration and load order: `src/modules.ts`.
- Host bootstrap: `src/core/bootstrap.ts`.
- Personality/system prompt: `src/modules/llm/prompt.ts`.
- LLM client (chat, images, Perplexity routing): `src/modules/llm/client.ts`.
- Telegram access control: `src/modules/telegram/access.ts` and `src/modules/admin/`.
- Panel auth: `src/modules/panel/auth.ts`.
- Connector config and service: `src/modules/connectors/config.ts` + `src/modules/connectors/service.ts`.
- Sandbox (Daytona): `src/modules/sandbox/`.
- User-facing docs: [skye-bot.com](https://skye-bot.com).
