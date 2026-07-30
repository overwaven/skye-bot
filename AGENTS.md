# Repository Guidelines

This document captures how we work in this repo. It is intended for contributors and automation agents alike.

## Project Overview

Skye is a calm, minimal AI assistant for Telegram, built with [grammy](https://grammy.dev/) + an OpenAI-compatible LLM API (OpenRouter by default). It supports streaming chat, long-term memory, image generation/editing/vision, voice (Yandex SpeechKit STT/TTS), document reading, managed Composio apps and custom HTTPS connectors, a per-chat Vercel Sandbox, and a Telegram Mini App settings panel. State lives in a single SQLite database (`better-sqlite3`).

## Architecture: The Module System

Everything is a `SkyeModule` (see `src/core/module.ts`). Modules are declared in a fixed-order array in `src/index.ts`; order matters because modules consume earlier ones' services (e.g. `llm` before `chatLog`, `userConfig` before `mcp`, `telegram` last).

Each module optionally provides:

- `configSchema`: Zod object for the module's YAML config section (native YAML keys, snake_case).
- `migrations[]`: Idempotent schema migrations keyed `${module.name}:${migration.id}`, tracked in a `migrations` table.
- `init(ctx)`: Returns `{ service, tools, commands, telegramHandlers, panelRoutes }`.
- `start(ctx, contributions, extra)`: Second phase; `telegram` and `panel` consume the aggregated bot/Express app.
- `shutdown()`: Cleanup in reverse order.

Config is loaded once from `config.yaml`, validated against the composed Zod schema, and passed as a typed `SkyeConfig` via `ctx.config`. No environment variables are involved (except `SKYE_CONFIG` to point at a non-default config path). Each module augments `SkyeConfig` via `declare module` to add its typed section.

New domains go in `src/modules/<name>/` exporting a `SkyeModule`, register their service type, and add themselves to the array in `src/index.ts`.

## Build, Test, and Development Commands

Package manager is **pnpm** (workspace includes `web/`). Node 22+.

- `pnpm run dev` / `pnpm run dev:pretty`: Run the bot with `tsx watch` (plain or pretty logs).
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

Tests use **Vitest** (`vitest.config.ts`) with in-memory SQLite (`DB_PATH=:memory:`) and a setup file that resets the DB singleton. Test files live in `src/**/__tests__/`. Mirror existing patterns (service-level integration tests backed by the real SQLite DB), keep them deterministic and side-effect-free.

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

Create a `config.yaml` based on `config.example.yaml`. Required: `bot_token`, `openai_key`. Everything else has sensible defaults (OpenRouter). Never commit real secrets (`config.yaml` is gitignored). Full variable reference lives in `config.example.yaml`, `docs/configuration.md`, and the auto-generated `docs/configuration-schema.md` (regenerate with `pnpm config:schema`). Validate before booting with `pnpm validate-config`.

Credential precedence for LLM calls: per-user key → per-chat key → global `openai_key`.

## Useful Pointers

- Personality/system prompt: `src/modules/llm/prompt.ts`.
- Telegram access control: `src/modules/telegram/access.ts`.
- Panel auth: `src/modules/panel/auth.ts`.
- Connector config and service: `src/modules/connectors/config.ts` + `src/modules/connectors/service.ts`.
- User-facing docs: `docs/`.

## Cursor Cloud specific instructions

Dependencies are refreshed automatically on startup via the update script (`pnpm install`), which also builds the native modules (`better-sqlite3`, `esbuild`, `ffmpeg-static`). Standard commands (`dev`, `build`, `lint`, `typecheck`, `test`, `validate-config`) are documented above and in `package.json`.

- Booting requires a real `config.yaml` (gitignored; copy from `config.example.yaml`). Set a valid `bot_token` and, for AI replies, `openai_key`. Provide these as Cloud Agent secrets rather than committing them.
- The bot process (`pnpm dev` / `pnpm start`) hard-exits at `bot.init()` with `GrammyError: getMe 401` if `bot_token` is a placeholder. Everything before that gate (config load, all migrations, `data/skye.db` creation, background job worker, reminder scheduler, and the in-process panel HTTP server on `:3001`) runs fine, so a `getMe 401` means the environment is healthy and only credentials are missing.
- The LLM preflight (`llm.checkCapabilities()`) is advisory and non-fatal, so the bot boots even without a working `openai_key`; only actual chat replies need it.
- Two ways to view the settings panel: the built static UI is served by the bot's own Express server on `:3001` (needs the bot running), while `pnpm --filter skye-panel dev` runs Next.js on `:3000`. The Next dev server only renders shell/error states on its own because it fetches the bot's `/api` (which validates Telegram Mini App `initData` against `bot_token`); for a working panel, run the bot and open `panel.webapp_url` (`:3001`).
- Gotcha: running `next dev` or `next build` in `web/` rewrites `web/tsconfig.json` (adds `dist/types` includes and reformats). Revert with `git checkout -- web/tsconfig.json` before committing.
- Outbound network to `api.telegram.org` and `openrouter.ai` is available in this environment.
- Single-instance polling: the bot uses Telegram long polling, so if the same `bot_token` is already polled elsewhere (e.g. the production deployment), a local `pnpm dev`/`pnpm start` gets `getUpdates 409 Conflict` and the process exits. Use a dedicated dev bot token to run the full bot locally. The panel HTTP server/API (`:3001`) can still be exercised independently of polling — it binds a few seconds before the poller starts and only reads/writes the local SQLite DB.
- To test the panel API without a Telegram client, sign a Mini App `initData` string with the bot token (HMAC scheme in `src/modules/panel/auth.ts`) and send it in the `x-telegram-init-data` header to `http://localhost:3001/api/*`.
