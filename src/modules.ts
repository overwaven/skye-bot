import type { SkyeModule } from "./core/module.js";

import { adminModule } from "./modules/admin/index.js";
import { agentRuntimeModule } from "./modules/agentRuntime/index.js";
import { auditModule } from "./modules/audit/index.js";
import { billingModule } from "./modules/billing/index.js";
import { browserModule } from "./modules/browser/index.js";
import { channelModule } from "./modules/channel/index.js";
import { chatConfigModule } from "./modules/chatConfig/index.js";
import { chatLogModule } from "./modules/chatLog/index.js";
import { legalModule } from "./modules/legal/index.js";
import { jobsModule } from "./modules/jobs/index.js";
import { llmModule } from "./modules/llm/index.js";
import { connectorsModule } from "./modules/connectors/index.js";
import { memoryModule } from "./modules/memory/index.js";
import { monitoringModule } from "./modules/monitoring/index.js";
import { panelModule } from "./modules/panel/index.js";
import { proactiveModule } from "./modules/proactive/index.js";
import { providersModule } from "./modules/providers/index.js";
import { remindersModule } from "./modules/reminders/index.js";
import { sandboxModule } from "./modules/sandbox/index.js";
import { speechModule } from "./modules/speech/index.js";
import { stickersModule } from "./modules/stickers/index.js";
import { telegramModule } from "./modules/telegram/index.js";
import { userConfigModule } from "./modules/userConfig/index.js";

/**
 * Module load order matters:
 *   - providers before llm and speech (provides the live multimodal catalog)
 *   - llm before billing (provides the model catalog consumed by billing & telegram)
 *   - userConfig before connectors (connectors read per-user settings)
 *   - admin before telegram (provides access gate allow/ban list)
 *   - billing after llm (needs the model catalog + default model id)
 *   - audit, memory, chatConfig, billing come before panel (routes contribute)
 *   - legal before telegram (contributes commands + callback handler)
 *   - telegram is last (consumes every other service)
 *   - panel start() runs after all modules' init() returned their routes
 */
export const modules: readonly SkyeModule[] = [
  providersModule,
  llmModule,
  userConfigModule,
  chatConfigModule,
  adminModule,
  billingModule,
  memoryModule,
  chatLogModule,
  speechModule,
  auditModule,
  monitoringModule,
  jobsModule,
  connectorsModule,
  browserModule,
  sandboxModule,
  proactiveModule,
  remindersModule,
  stickersModule,
  channelModule,
  agentRuntimeModule,
  panelModule,
  legalModule,
  telegramModule,
];
