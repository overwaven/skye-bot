<div align="center"><img src="./assets/wordmark.png" alt="Skye textmark" width="96"/></div>

<h3 align="center">
    Skye
</h1>

<p align="center">
    <sup>A calm, minimal-minded assistant that keeps things simple and clear.</sup>
</p>

<p align="center">
    <img src="https://img.shields.io/badge/pnpm-%234a4a4a.svg?style=for-the-badge&logo=pnpm&logoColor=f69220" alt="PNPM"/>
    <img src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
    <img src="https://img.shields.io/badge/node.js-6DA55F.svg?style=for-the-badge&logo=node.js&logoColor=white" alt="NodeJS"/>
    <img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg?style=for-the-badge" alt="License: AGPL-3.0-only"/>
</p>

---

## Quick start

```bash
pnpm install
cp config.example.yaml config.yaml   # fill in bot_token and the unified ai catalog
pnpm run dev                          # or dev:pretty for human-readable logs
```

See `AGENTS.md` for the repository conventions.

## Browser automation

Skye can use an isolated Chromium session powered by
[browser-use](https://github.com/browser-use/browser-use). The first version supports navigation,
page inspection, clicks, typing, scrolling, tab management, autonomous multi-step tasks, and
Telegram screenshots with optional vision descriptions.

```bash
cp config.example.yaml config.yaml
# Set browser.enabled: true and configure browser.agent_* for autonomous tasks.
docker compose up --build
```

Each chat or topic gets a separate temporary browser profile. Sessions expire after inactivity;
local/private network destinations, secret-like input, and unconfirmed consequential actions are
blocked. The worker is not published to the host network.

## Documentation

Skye's full documentation lives on the [website](https://skye-bot.com).

## License

Copyright © 2026 Erich Helvig. Skye Bot is licensed under the [GNU Affero General Public License v3.0 only](LICENSE).

This is a strong copyleft license. Any derivative work — including network services built on top of Skye — must be distributed under the same license, with complete corresponding source code made available to all users.
