# Configuration Schema

Auto-generated from `src/modules/*/config.ts` Zod schemas by `pnpm config:schema`.
Do not edit by hand — re-run after changing a module's `configSchema`.

Each module declares its YAML section as a Zod object. At startup,
`config.yaml` is parsed and validated against the composed schema.
The result is a typed `SkyeConfig` object consumed by modules via
`ctx.config.section.key` (camelCase keys in TypeScript).

Legend: **Required** = no default and not optional. **Default** = used
when the key is absent. **Bounds** = numeric min/max or string length.

## access

| YAML path     | Module | Type | Required | Default        | Enum                                   | Bounds |
| ------------- | ------ | ---- | -------- | -------------- | -------------------------------------- | ------ |
| `access.mode` | access | enum |          | `subscription` | private, allowlist, subscription, open |        |

## admin

| YAML path   | Module | Type   | Required | Default | Enum | Bounds |
| ----------- | ------ | ------ | -------- | ------- | ---- | ------ |
| `admin_ids` | admin  | string |          |         |      |        |

## agent_runtime

| YAML path                                    | Module        | Type    | Required | Default         | Enum                  | Bounds     |
| -------------------------------------------- | ------------- | ------- | -------- | --------------- | --------------------- | ---------- |
| `agent_runtime.agents`                       | agent_runtime | array   |          | `[]`            |                       |            |
| `agent_runtime.engine`                       | agent_runtime | enum    |          | `openai_agents` | legacy, openai_agents |            |
| `agent_runtime.max_chat_agents`              | agent_runtime | number  |          | `10`            |                       | ≥ 1, ≤ 50  |
| `agent_runtime.max_turns`                    | agent_runtime | number  |          | `21`            |                       | ≥ 2, ≤ 100 |
| `agent_runtime.max_user_agents`              | agent_runtime | number  |          | `10`            |                       | ≥ 1, ≤ 50  |
| `agent_runtime.subagent_max_turns`           | agent_runtime | number  |          | `8`             |                       | ≥ 1, ≤ 50  |
| `agent_runtime.trace_include_sensitive_data` | agent_runtime | boolean |          | `false`         |                       |            |
| `agent_runtime.tracing`                      | agent_runtime | boolean |          | `false`         |                       |            |

## ai

| YAML path           | Module      | Type   | Required | Default | Enum | Bounds |
| ------------------- | ----------- | ------ | -------- | ------- | ---- | ------ |
| `ai.defaults.image` | llm         | string |          |         |      |        |
| `ai.defaults.stt`   | ai.defaults | string |          |         |      |        |
| `ai.defaults.text`  | ai.defaults | string |          |         |      |        |
| `ai.defaults.tts`   | ai.defaults | string |          |         |      |        |
| `ai.defaults.voice` | speech      | string |          |         |      |        |
| `ai.models`         | llm         | array  |          | `[]`    |      |        |
| `ai.providers`      | ai          | array  |          | `[]`    |      |        |

## audit

| YAML path              | Module | Type   | Required | Default  | Enum | Bounds |
| ---------------------- | ------ | ------ | -------- | -------- | ---- | ------ |
| `audit.max_rows`       | audit  | number |          | `100000` |      | > 0    |
| `audit.retention_days` | audit  | number |          | `90`     |      | > 0    |

## background_jobs

| YAML path                          | Module          | Type    | Required | Default | Enum | Bounds         |
| ---------------------------------- | --------------- | ------- | -------- | ------- | ---- | -------------- |
| `background_jobs.enabled`          | background_jobs | boolean |          | `true`  |      |                |
| `background_jobs.lease_sec`        | background_jobs | number  |          | `300`   |      | ≥ 30, ≤ 3600   |
| `background_jobs.poll_interval_ms` | background_jobs | number  |          | `1000`  |      | ≥ 100, ≤ 60000 |
| `background_jobs.retention_days`   | background_jobs | number  |          | `7`     |      | ≥ 1, ≤ 365     |

## billing

| YAML path                             | Module  | Type    | Required | Default                                                                                                                                                                                                        | Enum | Bounds |
| ------------------------------------- | ------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| `billing.base_quota_tokens`           | billing | number  |          | `2000000`                                                                                                                                                                                                      |      | > 0    |
| `billing.currency`                    | billing | string  |          | `XTR`                                                                                                                                                                                                          |      |        |
| `billing.description`                 | billing | string  |          | `Monthly subscription — unlocks Skye and adds 2,000,000 tokens per month.`                                                                                                                                     |      |        |
| `billing.enabled`                     | billing | boolean |          | `true`                                                                                                                                                                                                         |      |        |
| `billing.subscription_period_seconds` | billing | number  |          | `2592000`                                                                                                                                                                                                      |      | > 0    |
| `billing.subscription_stars`          | billing | number  |          | `1899`                                                                                                                                                                                                         |      | > 0    |
| `billing.title`                       | billing | string  |          | `Skye Plus`                                                                                                                                                                                                    |      |        |
| `billing.token_packs`                 | billing | array   |          | `[{"id":"pack_500","name":"Quick Boost","stars":499,"tokens":500000},{"id":"pack_1500","name":"Big Boost","stars":999,"tokens":1500000},{"id":"pack_5000","name":"Mega Boost","stars":2499,"tokens":5000000}]` |      |        |

## browser

| YAML path                      | Module  | Type    | Required | Default                                                                                                                                                                | Enum | Bounds          |
| ------------------------------ | ------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------- |
| `browser.agent_api_key`        | browser | string  |          |                                                                                                                                                                        |      |                 |
| `browser.agent_base_url`       | browser | string  |          |                                                                                                                                                                        |      |                 |
| `browser.agent_model`          | browser | string  |          |                                                                                                                                                                        |      |                 |
| `browser.allowed_domains`      | browser | array   |          | `[]`                                                                                                                                                                   |      |                 |
| `browser.enabled`              | browser | boolean |          | `false`                                                                                                                                                                |      |                 |
| `browser.max_agent_steps`      | browser | number  |          | `25`                                                                                                                                                                   |      | > 0, ≤ 100      |
| `browser.max_output_chars`     | browser | number  |          | `20000`                                                                                                                                                                |      | > 0, ≤ 200000   |
| `browser.max_screenshot_bytes` | browser | number  |          | `10485760`                                                                                                                                                             |      | > 0, ≤ 26214400 |
| `browser.prohibited_domains`   | browser | array   |          | `["localhost","127.0.0.1","::1","169.254.169.254","host.docker.internal","*.localhost","*.local","*.internal","metadata.google.internal","browser-worker","skye-bot"]` |      |                 |
| `browser.request_timeout_ms`   | browser | number  |          | `300000`                                                                                                                                                               |      | > 0, ≤ 900000   |
| `browser.viewport_height`      | browser | number  |          | `900`                                                                                                                                                                  |      | ≥ 600, ≤ 1600   |
| `browser.viewport_width`       | browser | number  |          | `1440`                                                                                                                                                                 |      | ≥ 800, ≤ 2560   |
| `browser.worker_token`         | browser | string  |          |                                                                                                                                                                        |      |                 |
| `browser.worker_url`           | browser | string  |          | `http://127.0.0.1:8765`                                                                                                                                                |      |                 |

## channel

| YAML path            | Module  | Type    | Required | Default | Enum | Bounds |
| -------------------- | ------- | ------- | -------- | ------- | ---- | ------ |
| `channel.admin_only` | channel | boolean |          | `true`  |      |        |
| `channel.chat_id`    | channel | string  |          |         |      |        |
| `channel.enabled`    | channel | boolean |          | `false` |      |        |

## connectors

| YAML path                                       | Module              | Type    | Required | Default                                                              | Enum | Bounds                       |
| ----------------------------------------------- | ------------------- | ------- | -------- | -------------------------------------------------------------------- | ---- | ---------------------------- |
| `connectors.composio.allowed_toolkits`          | connectors.composio | array   |          | `["gmail","googlecalendar","googledrive","github","notion","slack"]` |      | min length 1, max length 100 |
| `connectors.composio.api_key`                   | connectors.composio | string  |          |                                                                      |      |                              |
| `connectors.composio.disable_destructive_tools` | connectors.composio | boolean |          | `true`                                                               |      |                              |
| `connectors.custom.allow_private_networks`      | connectors.custom   | boolean |          | `false`                                                              |      |                              |
| `connectors.custom.enabled`                     | connectors.custom   | boolean |          | `true`                                                               |      |                              |
| `connectors.custom.max_per_user`                | connectors.custom   | number  |          | `8`                                                                  |      | ≥ 0, ≤ 50                    |
| `connectors.max_tool_output_chars`              | connectors          | number  |          | `64000`                                                              |      | ≥ 1000, ≤ 1000000            |

## core

| YAML path   | Module | Type   | Required | Default        | Enum                                   | Bounds |
| ----------- | ------ | ------ | -------- | -------------- | -------------------------------------- | ------ |
| `db_path`   | core   | string |          | `data/skye.db` |                                        |        |
| `log_level` | core   | enum   |          | `info`         | trace, debug, info, warn, error, fatal |        |

## image

| YAML path            | Module | Type   | Required | Default                                 | Enum            | Bounds |
| -------------------- | ------ | ------ | -------- | --------------------------------------- | --------------- | ------ |
| `image.api_key`      | image  | string |          |                                         |                 |        |
| `image.aspect_ratio` | image  | string |          |                                         |                 |        |
| `image.base_url`     | llm    | string |          |                                         |                 |        |
| `image.model`        | image  | string |          | `google/gemini-3.1-flash-image-preview` |                 |        |
| `image.provider`     | image  | enum   |          |                                         | openrouter, xai |        |
| `image.resolution`   | image  | enum   |          |                                         | 1k, 2k,         |        |

## legal

| YAML path                | Module | Type   | Required | Default                                             | Enum | Bounds |
| ------------------------ | ------ | ------ | -------- | --------------------------------------------------- | ---- | ------ |
| `legal.developer_alias`  | legal  | string |          | `Erich Helvig`                                      |      |        |
| `legal.developer_email`  | legal  | string |          | `serg@skye-bot.com`                                 |      |        |
| `legal.developer_name`   | legal  | string |          | `Sergey Gamuylo`                                    |      |        |
| `legal.privacy_url`      | legal  | string |          | `https://shiftlinehq.craft.me/skye-privacy`         |      |        |
| `legal.security_url`     | legal  | string |          | `https://github.com/ehlvg/skye-bot/security/policy` |      |        |
| `legal.source_url`       | legal  | string |          | `https://github.com/ehlvg/skye-bot`                 |      |        |
| `legal.support_username` | legal  | string |          | `@overwaven`                                        |      |        |
| `legal.terms_url`        | legal  | string |          | `https://shiftlinehq.craft.me/skye-terms`           |      |        |

## llm

| YAML path               | Module | Type    | Required | Default                                                                                                                                                                                                                                                                                                                                                                                                                            | Enum | Bounds |
| ----------------------- | ------ | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| `base_url`              | llm    | string  |          | `https://openrouter.ai/api/v1`                                                                                                                                                                                                                                                                                                                                                                                                     |      |        |
| `default_model_id`      | llm    | string  |          | `sydney`                                                                                                                                                                                                                                                                                                                                                                                                                           |      |        |
| `max_completion_tokens` | llm    | number  |          | `500`                                                                                                                                                                                                                                                                                                                                                                                                                              |      | > 0    |
| `models`                | llm    | array   |          | `[{"id":"sydney","name":"Sydney","model":"google/gemini-3.1-flash-lite","multiplier":1,"contextWindow":128000},{"id":"tokyo","name":"Tokyo","model":"openai/gpt-oss-20b","multiplier":1.5,"contextWindow":128000},{"id":"berlin","name":"Berlin","model":"anthropic/claude-3.7-sonnet","multiplier":2.5,"contextWindow":128000},{"id":"toronto","name":"Toronto","model":"openai/gpt-5.5","multiplier":4,"contextWindow":128000}]` |      |        |
| `openai_key`            | llm    | string  |          |                                                                                                                                                                                                                                                                                                                                                                                                                                    |      |        |
| `pdf_engine`            | llm    | string  |          |                                                                                                                                                                                                                                                                                                                                                                                                                                    |      |        |
| `pdf_max_bytes`         | llm    | number  |          | `26214400`                                                                                                                                                                                                                                                                                                                                                                                                                         |      | > 0    |
| `perplexity_api_key`    | llm    | string  |          |                                                                                                                                                                                                                                                                                                                                                                                                                                    |      |        |
| `perplexity_base_url`   | llm    | string  |          | `https://api.perplexity.ai/v1`                                                                                                                                                                                                                                                                                                                                                                                                     |      |        |
| `use_chat_completions`  | llm    | boolean |          | `false`                                                                                                                                                                                                                                                                                                                                                                                                                            |      |        |
| `xai_api_key`           | llm    | string  |          |                                                                                                                                                                                                                                                                                                                                                                                                                                    |      |        |
| `xai_base_url`          | llm    | string  |          | `https://api.x.ai/v1`                                                                                                                                                                                                                                                                                                                                                                                                              |      |        |

## monitoring

| YAML path              | Module     | Type   | Required | Default | Enum | Bounds       |
| ---------------------- | ---------- | ------ | -------- | ------- | ---- | ------------ |
| `monitoring.error_log` | monitoring | string |          |         |      | min length 1 |
| `monitoring.out_log`   | monitoring | string |          |         |      | min length 1 |

## owner

| YAML path       | Module | Type   | Required | Default | Enum | Bounds                  |
| --------------- | ------ | ------ | -------- | ------- | ---- | ----------------------- |
| `owner.name`    | owner  | string |          |         |      |                         |
| `owner.tag`     | owner  | string |          |         |      |                         |
| `owner.user_id` | owner  | number |          | `0`     |      | ≥ 0, ≤ 9007199254740991 |

## panel

| YAML path                    | Module | Type   | Required | Default                 | Enum | Bounds            |
| ---------------------------- | ------ | ------ | -------- | ----------------------- | ---- | ----------------- |
| `panel.auth_max_age_seconds` | panel  | number |          | `86400`                 |      | ≥ 60, ≤ 86400     |
| `panel.json_body_limit_kb`   | panel  | number |          | `3072`                  |      | ≥ 64, ≤ 10240     |
| `panel.rate_limit_max`       | panel  | number |          | `120`                   |      | ≥ 10, ≤ 10000     |
| `panel.rate_limit_window_ms` | panel  | number |          | `60000`                 |      | ≥ 1000, ≤ 3600000 |
| `panel.webapp_port`          | panel  | number |          | `3001`                  |      | > 0               |
| `panel.webapp_url`           | panel  | string |          | `http://localhost:3001` |      |                   |

## proactive

| YAML path                    | Module    | Type    | Required | Default | Enum | Bounds    |
| ---------------------------- | --------- | ------- | -------- | ------- | ---- | --------- |
| `proactive.context_size`     | proactive | number  |          | `20`    |      | ≥ 2, ≤ 60 |
| `proactive.enabled`          | proactive | boolean |          | `true`  |      |           |
| `proactive.min_interval_sec` | proactive | number  |          | `180`   |      | ≥ 0       |
| `proactive.probability`      | proactive | number  |          | `0.06`  |      | ≥ 0, ≤ 1  |
| `proactive.warmup`           | proactive | number  |          | `8`     |      | ≥ 0       |

## reminders

| YAML path                      | Module    | Type    | Required | Default | Enum | Bounds       |
| ------------------------------ | --------- | ------- | -------- | ------- | ---- | ------------ |
| `reminders.check_interval_sec` | reminders | number  |          | `30`    |      | ≥ 1, ≤ 3600  |
| `reminders.enabled`            | reminders | boolean |          | `true`  |      |              |
| `reminders.grace_sec`          | reminders | number  |          | `300`   |      | ≥ 0, ≤ 86400 |

## sandbox

| YAML path                      | Module  | Type    | Required | Default            | Enum | Bounds          |
| ------------------------------ | ------- | ------- | -------- | ------------------ | ---- | --------------- |
| `sandbox.auto_archive_minutes` | sandbox | number  |          | `10080`            |      | ≥ 0             |
| `sandbox.auto_stop_minutes`    | sandbox | number  |          | `15`               |      | ≥ 0             |
| `sandbox.command_timeout_ms`   | sandbox | number  |          | `60000`            |      | > 0             |
| `sandbox.cpu`                  | sandbox | number  |          | `1`                |      | > 0, ≤ 4        |
| `sandbox.daytona_api_key`      | sandbox | string  |          |                    |      | min length 1    |
| `sandbox.daytona_api_url`      | sandbox | string  |          |                    |      |                 |
| `sandbox.daytona_target`       | sandbox | string  |          |                    |      | min length 1    |
| `sandbox.disk_gib`             | sandbox | number  |          | `3`                |      | > 0, ≤ 10       |
| `sandbox.enabled`              | sandbox | boolean |          | `true`             |      |                 |
| `sandbox.image`                | llm     | string  |          | `node:24-bookworm` |      | min length 1    |
| `sandbox.max_file_bytes`       | sandbox | number  |          | `1000000`          |      | > 0, ≤ 52428800 |
| `sandbox.max_output_chars`     | sandbox | number  |          | `64000`            |      | > 0, ≤ 1000000  |
| `sandbox.memory_gib`           | sandbox | number  |          | `1`                |      | > 0, ≤ 8        |
| `sandbox.persistent`           | sandbox | boolean |          | `false`            |      |                 |
| `sandbox.snapshot`             | sandbox | string  |          |                    |      | min length 1    |

## telegram

| YAML path                       | Module   | Type   | Required | Default    | Enum | Bounds            |
| ------------------------------- | -------- | ------ | -------- | ---------- | ---- | ----------------- |
| `allowed_ids`                   | telegram | string |          |            |      |                   |
| `bot_token`                     | telegram | string | yes      |            |      | min length 1      |
| `telegram_drop_pending_updates` | telegram | enum   |          | `0`        | 0, 1 |                   |
| `telegram_job_timeout_ms`       | telegram | number |          | `180000`   |      | ≥ 10000, ≤ 900000 |
| `telegram_max_attachment_bytes` | telegram | number |          | `26214400` |      | > 0, ≤ 52428800   |
| `telegram_max_concurrent_jobs`  | telegram | number |          | `64`       |      | ≥ 2, ≤ 500        |
| `telegram_polling_lock`         | telegram | string |          | `1`        |      |                   |

## voice

| YAML path                          | Module           | Type   | Required | Default                                                                                                                                                    | Enum                             | Bounds       |
| ---------------------------------- | ---------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------ |
| `voice.openrouter.api_key`         | voice.openrouter | string |          |                                                                                                                                                            |                                  |              |
| `voice.openrouter.base_url`        | llm              | string |          | `https://openrouter.ai/api/v1`                                                                                                                             |                                  |              |
| `voice.openrouter.pcm_channels`    | voice.openrouter | number |          | `1`                                                                                                                                                        |                                  | > 0          |
| `voice.openrouter.pcm_sample_rate` | voice.openrouter | number |          | `24000`                                                                                                                                                    |                                  | > 0          |
| `voice.openrouter.referer`         | voice.openrouter | string |          |                                                                                                                                                            |                                  |              |
| `voice.openrouter.stt_format`      | voice.openrouter | enum   |          | `mp3`                                                                                                                                                      | mp3, wav, oggopus                |              |
| `voice.openrouter.stt_language`    | voice.openrouter | string |          |                                                                                                                                                            |                                  |              |
| `voice.openrouter.stt_model`       | voice.openrouter | string |          | `nvidia/parakeet-tdt-0.6b-v3`                                                                                                                              |                                  |              |
| `voice.openrouter.title`           | voice.openrouter | string |          |                                                                                                                                                            |                                  |              |
| `voice.openrouter.tts_format`      | voice.openrouter | enum   |          | `mp3`                                                                                                                                                      | mp3, pcm                         |              |
| `voice.openrouter.tts_model`       | voice.openrouter | string |          | `google/gemini-3.1-flash-tts-preview`                                                                                                                      |                                  |              |
| `voice.openrouter.tts_voice`       | voice.openrouter | string |          | `Aoede`                                                                                                                                                    |                                  |              |
| `voice.provider`                   | voice            | enum   |          | `yandex`                                                                                                                                                   | yandex, openrouter, tinfoil, xai |              |
| `voice.tinfoil.api_key`            | voice.tinfoil    | string |          |                                                                                                                                                            |                                  |              |
| `voice.tinfoil.base_url`           | llm              | string |          |                                                                                                                                                            |                                  |              |
| `voice.tinfoil.stt_format`         | voice.tinfoil    | enum   |          | `mp3`                                                                                                                                                      | mp3, wav, oggopus                |              |
| `voice.tinfoil.stt_language`       | voice.tinfoil    | string |          |                                                                                                                                                            |                                  |              |
| `voice.tinfoil.stt_model`          | voice.tinfoil    | string |          | `whisper-large-v3-turbo`                                                                                                                                   |                                  |              |
| `voice.tinfoil.tts_instruct`       | voice.tinfoil    | string |          | `Speak very fast and cheerful. Bouncy, energetic young woman, smiling voice, punchy and bright. High energy, upbeat, lively delivery with no long pauses.` |                                  |              |
| `voice.tinfoil.tts_model`          | voice.tinfoil    | string |          | `qwen3-tts`                                                                                                                                                |                                  |              |
| `voice.tinfoil.tts_voice`          | voice.tinfoil    | string |          | `vivian`                                                                                                                                                   |                                  |              |
| `voice.xai.api_key`                | voice.xai        | string |          |                                                                                                                                                            |                                  |              |
| `voice.xai.base_url`               | llm              | string |          | `https://api.x.ai/v1`                                                                                                                                      |                                  |              |
| `voice.xai.stt_format`             | voice.xai        | enum   |          | `mp3`                                                                                                                                                      | mp3, wav, oggopus                |              |
| `voice.xai.stt_language`           | voice.xai        | string |          |                                                                                                                                                            |                                  |              |
| `voice.xai.tts_format`             | voice.xai        | enum   |          | `mp3`                                                                                                                                                      | mp3, wav                         |              |
| `voice.xai.tts_language`           | voice.xai        | string |          | `auto`                                                                                                                                                     |                                  |              |
| `voice.xai.tts_speed`              | voice.xai        | number |          | `1`                                                                                                                                                        |                                  | ≥ 0.7, ≤ 1.5 |
| `voice.xai.tts_voice`              | voice.xai        | string |          | `eve`                                                                                                                                                      |                                  |              |
| `voice.yc_api_key`                 | voice            | string |          |                                                                                                                                                            |                                  |              |
| `voice.yc_folder_id`               | voice            | string |          |                                                                                                                                                            |                                  |              |
| `voice.yc_tts_emotion`             | voice            | string |          | `neutral`                                                                                                                                                  |                                  |              |
| `voice.yc_tts_lang`                | voice            | string |          | `ru-RU`                                                                                                                                                    |                                  |              |
| `voice.yc_tts_speed`               | voice            | number |          | `1`                                                                                                                                                        |                                  | ≥ 0.1, ≤ 3   |
| `voice.yc_tts_voice`               | voice            | string |          | `jane`                                                                                                                                                     |                                  |              |

## Cross-field rules

- Provider and model IDs in the unified `ai` catalog must be unique.
- Every `ai.models[].provider` must reference an entry in `ai.providers`.
- `ai.defaults.image` must support both `image_generation` and `image_edit`.
- Every configured default must reference an enabled model on an enabled provider.
- When `ai.providers` is non-empty, it is the complete source of truth and legacy
  provider fields are ignored. The following rules apply only to legacy configs.
- If any legacy model in `models[]` sets `provider: "perplexity"`, then
  `perplexity_api_key` must be set.
- If any legacy model in `models[]` sets `provider: "xai"`, then
  `xai_api_key` must be set.
- `image.provider: "xai"` requires `image.api_key` or `xai_api_key`.
- `voice.provider: "yandex"` requires `voice.yc_api_key` for STT/TTS.
- `voice.provider: "openrouter"` falls back to `openai_key` when
  `voice.openrouter.api_key` is empty.
- `voice.provider: "xai"` falls back to `xai_api_key` when
  `voice.xai.api_key` is empty.
- `sandbox.enabled: true` requires `sandbox.daytona_api_key`.
- `access.mode: "subscription"` requires `billing.enabled: true`.
- If `owner.user_id` is `0`, first run prints a one-time `/claim_owner`
  token to the operator log and persists the claimed Telegram user ID.
