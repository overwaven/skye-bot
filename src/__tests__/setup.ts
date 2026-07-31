/**
 * Vitest setup: bring the DB up in :memory: and apply all module migrations so
 * tests can exercise services that hit `getDb()` directly.
 */
import { getDb, runMigrations } from "../core/db.js";

import { adminModule } from "../modules/admin/index.js";
import { agentRuntimeModule } from "../modules/agentRuntime/index.js";
import { auditModule } from "../modules/audit/index.js";
import { billingModule } from "../modules/billing/index.js";
import { chatConfigModule } from "../modules/chatConfig/index.js";
import { chatLogModule } from "../modules/chatLog/index.js";
import { legalModule } from "../modules/legal/index.js";
import { jobsModule } from "../modules/jobs/index.js";
import { memoryModule } from "../modules/memory/index.js";
import { remindersModule } from "../modules/reminders/index.js";
import { stickersModule } from "../modules/stickers/index.js";
import { userConfigModule } from "../modules/userConfig/index.js";

runMigrations(getDb(":memory:"), [
  memoryModule,
  chatConfigModule,
  chatLogModule,
  auditModule,
  userConfigModule,
  jobsModule,
  remindersModule,
  stickersModule,
  adminModule,
  billingModule,
  legalModule,
  agentRuntimeModule,
]);
