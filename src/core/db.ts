import Database from "better-sqlite3";
import { chmodSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Logger } from "pino";
import type { Migration, SkyeModule } from "./module.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

/**
 * Open (or return cached) SQLite connection.
 * Honours the given dbPath (incl. ":memory:") with a sensible default of data/skye.db.
 */
export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const path = dbPath ?? join(__dirname, "..", "..", "data", "skye.db");

  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Some mounted filesystems do not support POSIX modes.
    }
  }

  _db = new Database(path);
  if (path !== ":memory:") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // Some mounted filesystems do not support POSIX modes.
    }
  }
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 5000");
  _db.pragma("foreign_keys = ON");
  ensureMigrationsTable(_db);
  return _db;
}

/** For tests: replace the singleton with a specific connection. */
export function setDbForTesting(db: Database.Database): void {
  _db = db;
  ensureMigrationsTable(db);
}

/** For tests: close and forget the singleton. */
export function resetDbForTesting(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore
    }
  }
  _db = null;
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
       id         TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`
  );
}

/**
 * Run all module migrations in declared order. Each migration is identified by
 * `${module.name}:${migration.id}` and recorded after successful application.
 */
export function runMigrations(
  db: Database.Database,
  modules: readonly SkyeModule[],
  logger?: Logger
): void {
  ensureMigrationsTable(db);
  const isApplied = db.prepare<[string], { id: string }>("SELECT id FROM migrations WHERE id = ?");
  const record = db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)");

  for (const mod of modules) {
    if (!mod.migrations?.length) continue;
    for (const migration of mod.migrations) {
      const key = `${mod.name}:${migration.id}`;
      if (isApplied.get(key)) continue;

      const tx = db.transaction((m: Migration) => {
        m.up(db);
        record.run(key, new Date().toISOString());
      });

      try {
        tx(migration);
        logger?.info({ migration: key }, "Applied migration");
      } catch (e) {
        logger?.error({ migration: key, err: e }, "Migration failed");
        throw e;
      }
    }
  }
}
