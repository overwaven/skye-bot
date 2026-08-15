import type Database from "better-sqlite3";
import { log } from "../../utils/log.js";

const PROCESSED_UPDATE_RETENTION = 10_000;

export class QueueTimeoutError extends Error {
  constructor(
    readonly key: string,
    readonly timeoutMs: number
  ) {
    super(`Telegram work queue timed out after ${timeoutMs} ms for ${key}`);
    this.name = "QueueTimeoutError";
  }
}

export class QueueCancelledError extends Error {
  constructor(readonly chatId: number) {
    super(`Telegram work queue cancelled for chat ${chatId}`);
    this.name = "QueueCancelledError";
  }
}

export interface QueueDiagnostics {
  pendingJobs: number;
  activeJobs: number;
  activeThreads: string[];
  oldestActiveMs: number;
  timedOutTotal: number;
  cancelledTotal: number;
}

type QueueJob = (signal: AbortSignal) => Promise<void>;

export class ThreadWorkQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, number>();
  private readonly active = new Map<
    string,
    { chatId: number; controller: AbortController; startedAt: number }
  >();
  private readonly generations = new Map<number, number>();
  private readonly slotWaiters: Array<() => void> = [];
  private activeSlots = 0;
  private timedOutTotal = 0;
  private cancelledTotal = 0;

  constructor(
    private readonly timeoutMs: number,
    private readonly maxConcurrent = 64
  ) {}

  enqueue(key: string, chatId: number, job: QueueJob): void {
    void this.schedule(key, chatId, job, false);
  }

  enqueueAndWait(key: string, chatId: number, job: QueueJob): Promise<void> {
    return this.schedule(key, chatId, job, true);
  }

  private schedule(
    key: string,
    chatId: number,
    job: QueueJob,
    propagateError: boolean
  ): Promise<void> {
    const generation = this.generations.get(chatId) ?? 0;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);

    const previous = this.tails.get(key) ?? Promise.resolve();
    const execution = previous
      .catch(() => undefined)
      .then(async () => {
        this.decrementPending(key);
        if ((this.generations.get(chatId) ?? 0) !== generation) {
          throw new QueueCancelledError(chatId);
        }

        await this.acquireSlot();
        if ((this.generations.get(chatId) ?? 0) !== generation) {
          this.releaseSlot();
          throw new QueueCancelledError(chatId);
        }

        const controller = new AbortController();
        this.active.set(key, { chatId, controller, startedAt: Date.now() });
        const timeoutError = new QueueTimeoutError(key, this.timeoutMs);
        const timer = setTimeout(() => {
          this.timedOutTotal += 1;
          controller.abort(timeoutError);
        }, this.timeoutMs);
        timer.unref();

        try {
          try {
            await job(controller.signal);
          } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            throw error;
          }
          if (controller.signal.aborted) throw controller.signal.reason;
        } finally {
          clearTimeout(timer);
          if (this.active.get(key)?.controller === controller) this.active.delete(key);
          this.releaseSlot();
        }
      })
      .catch((error: unknown) => {
        if (error instanceof QueueCancelledError) {
          log.info({ chatId, key }, "Telegram queue job cancelled");
        } else if (error instanceof QueueTimeoutError) {
          log.warn({ chatId, key, timeoutMs: error.timeoutMs }, "Telegram queue job timed out");
        } else {
          log.error({ err: error, chatId, key }, "Telegram queue job failed");
        }
        if (propagateError) throw error;
      });
    const next = execution
      .catch(() => undefined)
      .finally(() => {
        if (this.tails.get(key) === next) this.tails.delete(key);
      });

    this.tails.set(key, next);
    return execution;
  }

  cancelChat(chatId: number): void {
    this.generations.set(chatId, (this.generations.get(chatId) ?? 0) + 1);
    const reason = new QueueCancelledError(chatId);
    for (const active of this.active.values()) {
      if (active.chatId !== chatId) continue;
      this.cancelledTotal += 1;
      active.controller.abort(reason);
    }
  }

  diagnostics(): QueueDiagnostics {
    const now = Date.now();
    const activeJobs = [...this.active.entries()];
    return {
      pendingJobs: [...this.pending.values()].reduce((sum, count) => sum + count, 0),
      activeJobs: activeJobs.length,
      activeThreads: activeJobs.map(([key]) => key),
      oldestActiveMs: activeJobs.reduce(
        (oldest, [, value]) => Math.max(oldest, now - value.startedAt),
        0
      ),
      timedOutTotal: this.timedOutTotal,
      cancelledTotal: this.cancelledTotal,
    };
  }

  async whenIdle(): Promise<void> {
    await Promise.all([...this.tails.values()]);
  }

  private acquireSlot(): Promise<void> {
    if (this.activeSlots < this.maxConcurrent) {
      this.activeSlots += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.slotWaiters.push(() => {
        this.activeSlots += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeSlots -= 1;
    const next = this.slotWaiters.shift();
    if (next) next();
  }

  private decrementPending(key: string): void {
    const remaining = (this.pending.get(key) ?? 1) - 1;
    if (remaining > 0) this.pending.set(key, remaining);
    else this.pending.delete(key);
  }
}

export interface TelegramReliabilityDiagnostics {
  status: "initialized" | "polling" | "stopped";
  apiReady: boolean;
  llmPreflightComplete: boolean;
  botUsername?: string;
  lastUpdateAt?: string;
  lastUpdateId?: number;
  lastUpdateAgeMs?: number;
  processedUpdates: number;
  duplicateUpdates: number;
  failedUpdates: number;
  queue: QueueDiagnostics;
}

export class TelegramReliabilityService {
  readonly queue: ThreadWorkQueue;
  private readonly inFlightUpdates = new Set<number>();
  private status: TelegramReliabilityDiagnostics["status"] = "initialized";
  private apiReady = false;
  private llmPreflightComplete = false;
  private botUsername: string | undefined;
  private lastUpdateAt: number | undefined;
  private lastUpdateId: number | undefined;
  private processedUpdates = 0;
  private duplicateUpdates = 0;
  private failedUpdates = 0;

  private readonly findUpdate: Database.Statement<[number], { update_id: number }>;
  private readonly insertUpdate: Database.Statement<[number, number | null, string]>;
  private readonly pruneUpdates: Database.Statement;

  constructor(db: Database.Database, queueTimeoutMs: number, maxConcurrentJobs = 64) {
    this.queue = new ThreadWorkQueue(queueTimeoutMs, maxConcurrentJobs);
    this.findUpdate = db.prepare(
      "SELECT update_id FROM telegram_processed_updates WHERE update_id = ?"
    );
    this.insertUpdate = db.prepare(
      "INSERT OR IGNORE INTO telegram_processed_updates (update_id, chat_id, processed_at) VALUES (?, ?, ?)"
    );
    this.pruneUpdates = db.prepare(`
      DELETE FROM telegram_processed_updates
       WHERE update_id NOT IN (
         SELECT update_id
           FROM telegram_processed_updates
          ORDER BY processed_at DESC, update_id DESC
          LIMIT ${PROCESSED_UPDATE_RETENTION}
       )
    `);
  }

  async processUpdate(
    updateId: number,
    chatId: number | undefined,
    next: () => Promise<void>
  ): Promise<void> {
    this.lastUpdateAt = Date.now();
    this.lastUpdateId = updateId;

    if (this.inFlightUpdates.has(updateId) || this.findUpdate.get(updateId)) {
      this.duplicateUpdates += 1;
      log.info({ updateId, chatId }, "Skipping duplicate Telegram update");
      return;
    }

    this.inFlightUpdates.add(updateId);
    const startedAt = Date.now();
    log.debug({ updateId, chatId }, "Telegram update started");
    try {
      await next();
      this.insertUpdate.run(updateId, chatId ?? null, new Date().toISOString());
      this.processedUpdates += 1;
      if (this.processedUpdates % 100 === 0) this.pruneUpdates.run();
      log.debug(
        { updateId, chatId, durationMs: Date.now() - startedAt },
        "Telegram update completed"
      );
    } catch (error) {
      this.failedUpdates += 1;
      log.error(
        { err: error, updateId, chatId, durationMs: Date.now() - startedAt },
        "Telegram update failed"
      );
      throw error;
    } finally {
      this.inFlightUpdates.delete(updateId);
    }
  }

  markApiReady(username?: string): void {
    this.apiReady = true;
    this.botUsername = username;
  }

  markLlmPreflightComplete(): void {
    this.llmPreflightComplete = true;
  }

  markPolling(): void {
    this.status = "polling";
  }

  markStopped(): void {
    this.status = "stopped";
  }

  isReady(): boolean {
    return this.status === "polling" && this.apiReady && this.llmPreflightComplete;
  }

  diagnostics(): TelegramReliabilityDiagnostics {
    return {
      status: this.status,
      apiReady: this.apiReady,
      llmPreflightComplete: this.llmPreflightComplete,
      ...(this.botUsername ? { botUsername: this.botUsername } : {}),
      ...(this.lastUpdateAt
        ? {
            lastUpdateAt: new Date(this.lastUpdateAt).toISOString(),
            lastUpdateAgeMs: Date.now() - this.lastUpdateAt,
          }
        : {}),
      ...(this.lastUpdateId != null ? { lastUpdateId: this.lastUpdateId } : {}),
      processedUpdates: this.processedUpdates,
      duplicateUpdates: this.duplicateUpdates,
      failedUpdates: this.failedUpdates,
      queue: this.queue.diagnostics(),
    };
  }
}
