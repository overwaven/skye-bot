import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations } from "../migrations.js";
import { TelegramReliabilityService, ThreadWorkQueue } from "../reliability.js";

const abortableWait = (signal: AbortSignal): Promise<void> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

describe("ThreadWorkQueue", () => {
  it("runs jobs serially within a thread", async () => {
    const queue = new ThreadWorkQueue(1_000);
    const events: string[] = [];

    queue.enqueue("chat:1", 1, async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push("first:end");
    });
    queue.enqueue("chat:1", 1, async () => {
      events.push("second");
    });

    await queue.whenIdle();
    expect(events).toEqual(["first:start", "first:end", "second"]);
    expect(queue.diagnostics()).toMatchObject({ pendingJobs: 0, activeJobs: 0 });
  });

  it("runs different chats independently", async () => {
    const queue = new ThreadWorkQueue(1_000);
    const events: string[] = [];
    let finishBlockedChat!: () => void;

    queue.enqueue(
      "1",
      1,
      async () =>
        new Promise<void>((resolve) => {
          finishBlockedChat = resolve;
        })
    );
    queue.enqueue("2", 2, async () => {
      events.push("second-chat");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["second-chat"]);
    expect(queue.diagnostics().activeThreads).toEqual(["1"]);

    finishBlockedChat();
    await queue.whenIdle();
  });

  it("does not wait for one user's private-chat job before answering their group chat", async () => {
    const queue = new ThreadWorkQueue(1_000);
    const userId = 42;
    const events: string[] = [];
    let finishPrivate!: () => void;

    queue.enqueue(
      String(userId),
      userId,
      () =>
        new Promise<void>((resolve) => {
          finishPrivate = resolve;
        })
    );
    queue.enqueue("-100555", -100555, async () => {
      events.push("group-hello");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["group-hello"]);
    finishPrivate();
    await queue.whenIdle();
  });

  it("lets a second chat finish while sequential update handling waits to enqueue", async () => {
    const queue = new ThreadWorkQueue(1_000);
    const events: string[] = [];
    let finishFirst!: () => void;

    queue.enqueue(
      "1",
      1,
      async () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    );
    const sequentialHandler = async (key: string, chatId: number, label: string) => {
      queue.enqueue(key, chatId, async () => {
        events.push(label);
      });
    };

    await sequentialHandler("1", 1, "first-chat-followup");
    await sequentialHandler("2", 2, "second-chat");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["second-chat"]);

    finishFirst();
    await queue.whenIdle();
    expect(events).toEqual(["second-chat", "first-chat-followup"]);
  });

  it("caps simultaneous jobs without serializing unrelated chats beyond the cap", async () => {
    const queue = new ThreadWorkQueue(1_000, 2);
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const thirdStarted = { value: false };

    queue.enqueue("1", 1, () => new Promise<void>((resolve) => (releaseFirst = resolve)));
    queue.enqueue("2", 2, () => new Promise<void>((resolve) => (releaseSecond = resolve)));
    queue.enqueue("3", 3, async () => {
      thirdStarted.value = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.diagnostics().activeJobs).toBe(2);
    expect(thirdStarted.value).toBe(false);

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(thirdStarted.value).toBe(true);
    releaseSecond();
    await queue.whenIdle();
  });

  it("does not overlap a successor while a timed-out job is still settling", async () => {
    const queue = new ThreadWorkQueue(15);
    const events: string[] = [];
    let finishFirst!: () => void;

    queue.enqueue(
      "chat:1",
      1,
      async () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    );
    queue.enqueue("chat:1", 1, async () => {
      events.push("continued");
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events).toEqual([]);
    finishFirst();
    await queue.whenIdle();
    expect(events).toEqual(["continued"]);
    expect(queue.diagnostics().timedOutTotal).toBe(1);
  });

  it("cancels active and pending work without blocking later jobs", async () => {
    const queue = new ThreadWorkQueue(1_000);
    const events: string[] = [];

    queue.enqueue("chat:1", 1, async (signal) => abortableWait(signal));
    queue.enqueue("chat:1", 1, async () => {
      events.push("stale");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.cancelChat(1);
    queue.enqueue("chat:1", 1, async () => {
      events.push("fresh");
    });

    await queue.whenIdle();
    expect(events).toEqual(["fresh"]);
    expect(queue.diagnostics().cancelledTotal).toBe(1);
  });
});

describe("TelegramReliabilityService", () => {
  const createService = () => {
    const db = new Database(":memory:");
    migrations[0]!.up(db);
    return { db, service: new TelegramReliabilityService(db, 1_000) };
  };

  it("persists completed updates and suppresses their duplicates", async () => {
    const { db, service } = createService();
    let calls = 0;

    await service.processUpdate(42, 7, async () => {
      calls += 1;
    });
    await service.processUpdate(42, 7, async () => {
      calls += 1;
    });

    expect(calls).toBe(1);
    expect(service.diagnostics()).toMatchObject({ processedUpdates: 1, duplicateUpdates: 1 });
    expect(
      db.prepare("SELECT chat_id FROM telegram_processed_updates WHERE update_id = 42").get()
    ).toEqual({ chat_id: 7 });
    db.close();
  });

  it("does not mark failed updates as completed", async () => {
    const { db, service } = createService();
    const failure = new Error("temporary failure");

    await expect(
      service.processUpdate(9, undefined, async () => Promise.reject(failure))
    ).rejects.toBe(failure);
    await service.processUpdate(9, undefined, async () => undefined);

    expect(service.diagnostics()).toMatchObject({ processedUpdates: 1, failedUpdates: 1 });
    db.close();
  });

  it("marks an update complete after middleware returns, even if queued work is still running", async () => {
    const { db, service } = createService();
    let finishWork!: () => void;

    await service.processUpdate(10, 7, async () => {
      service.queue.enqueue(
        "chat:7",
        7,
        async () =>
          new Promise<void>((resolve) => {
            finishWork = resolve;
          })
      );
    });

    expect(
      db.prepare("SELECT update_id FROM telegram_processed_updates WHERE update_id = 10").get()
    ).toEqual({ update_id: 10 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishWork();
    await service.queue.whenIdle();
    db.close();
  });

  it("exposes readiness only after polling and preflight complete", () => {
    const { db, service } = createService();
    expect(service.isReady()).toBe(false);
    service.markApiReady("skye_bot");
    service.markLlmPreflightComplete();
    service.markPolling();
    expect(service.isReady()).toBe(true);
    expect(service.diagnostics()).toMatchObject({ status: "polling", botUsername: "skye_bot" });
    db.close();
  });
});
