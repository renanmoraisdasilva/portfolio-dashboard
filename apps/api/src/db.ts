import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';
import { createHash } from 'node:crypto';

// The data directory is overridable so a test run cannot touch the real
// database. The e2e suite points it at a temporary directory and seeds the
// fixture there; the container and every normal `npm run dev` leave it unset.
const DATA_DIR = process.env.PORTFOLIO_DATA_DIR
  ? path.resolve(process.env.PORTFOLIO_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'portfolio.db');
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'drizzle', 'migrations');

export const sqlite = new Database(DB_PATH);

export const drizzleDb = drizzle(sqlite, { schema });

export const db = sqlite;

/**
 * Promisified helpers for the single-statement case.
 *
 * `better-sqlite3` is synchronous, and wrapping it in promises buys no
 * parallelism — there is none to have. What it *does* buy is that a thrown error
 * becomes a rejected Promise, which is the contract the route handlers are
 * written against (`try { await run(...) } catch { res.status(500) }`).
 *
 * Inside a transaction use `transaction()` with the `*Sync` helpers instead — see
 * the note there. It cannot await, because the driver commits when the function
 * returns.
 */
export function run(sql: string, params: any[] = []): Promise<void> {
  return Promise.resolve().then(() => {
    sqlite.prepare(sql).run(...params);
  });
}

export function get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return Promise.resolve().then(() => sqlite.prepare(sql).get(...params) as T | undefined);
}

export function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return Promise.resolve().then(() => sqlite.prepare(sql).all(...params) as T[]);
}

/* ------------------------------------------------------------------------- *
 * Transaction scope
 *
 * Six call sites used to hand-roll `BEGIN` / `try` / `COMMIT` / `catch ROLLBACK`
 * as prepared statements, each slightly different. Three problems with that:
 *
 * 1. **The rollback could mask the cause.** `await run('ROLLBACK')` sits in the
 *    catch block, so a failure *of the rollback* replaced the original error —
 *    the one thing the operator needed — with something about transactions.
 * 2. **Nothing stopped a commit from being skipped.** A `throw` between `BEGIN`
 *    and `COMMIT` that was not the kind the author anticipated left the
 *    connection inside a transaction, and every later write on it rolled back at
 *    the next `ROLLBACK`.
 * 3. **It was still the driver's own mechanism, spelled out.** `sqlite.transaction`
 *    is the same `BEGIN`/`COMMIT` with the rollback, the savepoint handling and
 *    the re-entrancy rules already correct.
 *
 * The body is **synchronous by necessity**: the driver commits the moment the
 * function returns, so an `await` inside it would commit early and run the rest
 * of the body outside the transaction. That is why the `*Sync` helpers exist
 * rather than the promise-returning ones.
 * ------------------------------------------------------------------------- */

/** A single statement, synchronous. For use inside `transaction()`. */
export function runSync(sql: string, params: any[] = []): void {
  sqlite.prepare(sql).run(...params);
}

/** A single row, synchronous. For use inside `transaction()`. */
export function getSync<T = any>(sql: string, params: any[] = []): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

/** Every matching row, synchronous. For use inside `transaction()`. */
export function allSync<T = any>(sql: string, params: any[] = []): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

/**
 * Runs `fn` in a transaction, committing when it returns and rolling back when it
 * throws. The original error propagates — a failing rollback cannot replace it.
 *
 * Nested calls become savepoints, so a helper that opens its own transaction is
 * still safe to call from inside one.
 *
 * ```ts
 * const { trade, cashEntry } = transaction(() => {
 *   const cashEntry = createAutoCashEntry(...);   // runSync internally
 *   runSync('INSERT INTO trades ...');
 *   return { trade, cashEntry };
 * });
 * ```
 */
export function transaction<T>(fn: () => T): T {
  return sqlite.transaction(fn)();
}

// Ensure tables that were added via Drizzle migrations exist in pre-Drizzle
// databases. Called only when a legacy database is detected (has `trades` but
// no `__drizzle_migrations`). Safe to run repeatedly — all statements are
// idempotent (CREATE IF NOT EXISTS / ALTER only when source table exists).
function ensureLegacyTablesExist() {
  const tableExists = (name: string) =>
    !!sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);

  // cash — migration 0001 renamed cash_entries → cash.
  // Very old databases (before cash was introduced) have neither.
  if (!tableExists('cash')) {
    if (tableExists('cash_entries')) {
      sqlite.prepare(`ALTER TABLE "cash_entries" RENAME TO "cash"`).run();
      sqlite.prepare(`DROP INDEX IF EXISTS "idx_cash_entries_ts"`).run();
    } else {
      sqlite
        .prepare(
          `
        CREATE TABLE "cash" (
          "id"          text    PRIMARY KEY NOT NULL,
          "currency"    text    NOT NULL,
          "amount"      real    NOT NULL,
          "description" text    NOT NULL DEFAULT '',
          "ts"          integer NOT NULL
        )
      `,
        )
        .run();
    }
    sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_cash_ts" ON "cash" ("ts")`).run();
  }

  // interest — migration 0002 renamed interest_months → interest.
  if (!tableExists('interest')) {
    if (tableExists('interest_months')) {
      sqlite.prepare(`ALTER TABLE "interest_months" RENAME TO "interest"`).run();
    } else {
      sqlite
        .prepare(
          `
        CREATE TABLE "interest" (
          "month"      text NOT NULL,
          "currency"   text NOT NULL DEFAULT 'BRL',
          "amount"     real,
          "created_at" integer
        )
      `,
        )
        .run();
    }
  }
}

// Seed __drizzle_migrations for databases that existed before Drizzle adoption.
//
// Drizzle's migrate() skips any migration whose journal `when` timestamp is
// ≤ the max `created_at` stored in __drizzle_migrations.  For a database
// bootstrapped by the old CREATE TABLE IF NOT EXISTS code path, we insert one
// row for the latest migration so Drizzle won't try to re-run already-applied SQL.
function seedDrizzleMigrationsIfNeeded() {
  const hasMigrationsTable = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get();
  if (hasMigrationsTable) return;

  const hasTradesTable = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='trades'`).get();
  if (!hasTradesTable) return;

  ensureLegacyTablesExist();

  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) return;

  const journal: { entries: { tag: string; when: number }[] } = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (journal.entries.length === 0) return;

  sqlite
    .prepare(
      `
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id         SERIAL  PRIMARY KEY,
      hash       text    NOT NULL,
      created_at numeric
    )
  `,
    )
    .run();

  const lastEntry = journal.entries.reduce((max, e) => (e.when > max.when ? e : max), journal.entries[0]);
  const sqlContent = fs.readFileSync(path.join(MIGRATIONS_DIR, `${lastEntry.tag}.sql`), 'utf8');
  const hash = createHash('sha256').update(sqlContent).digest('hex');
  sqlite.prepare(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`).run(hash, lastEntry.when);

  console.log(`[db] Seeded __drizzle_migrations: existing DB recorded at '${lastEntry.tag}'`);
}

export async function init() {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  if (fs.existsSync(MIGRATIONS_DIR)) {
    seedDrizzleMigrationsIfNeeded();
    migrate(drizzleDb, { migrationsFolder: MIGRATIONS_DIR });
    console.log('[db] Drizzle migrations up to date');
  }
}

/**
 * Checkpoints the WAL and closes the connection.
 *
 * The reason this exists at all: in WAL mode, recent writes live in
 * `portfolio.db-wal` until a checkpoint folds them into the main file, and a
 * checkpoint happens when the last connection closes *cleanly*. Without a
 * shutdown path, `docker stop` and Ctrl-C both skipped it — so the main file
 * could be weeks behind its own WAL. That is not hypothetical here: copying
 * `portfolio.db` on its own once captured a 7-week-old state, complete with a row
 * deleted hours earlier. (`GET /api/state/export` reads through the WAL and is
 * unaffected, which is why it is the documented backup route.)
 *
 * `TRUNCATE` rather than the default `PASSIVE`: it checkpoints everything and
 * resets the WAL to zero bytes, so a later bare file copy is a complete backup.
 * Best-effort, because a checkpoint can fail on a busy database and refusing to
 * exit over it would be worse than exiting anyway.
 */
export function close(): void {
  try {
    if (sqlite.open) {
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
      sqlite.close();
      console.log('[db] WAL checkpointed and connection closed');
    }
  } catch (err) {
    console.error('[db] close failed, exiting anyway:', err instanceof Error ? err.message : err);
  }
}
