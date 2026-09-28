import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';
import { createHash } from 'node:crypto';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'portfolio.db');
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'drizzle', 'migrations');

export const sqlite = new Database(DB_PATH);

export const drizzleDb = drizzle(sqlite, { schema });

export const db = sqlite;

// Promisified helpers — backward-compatible with all existing route/service code.
// better-sqlite3 is synchronous; wrapping in .then() converts thrown errors to
// rejected Promises, matching the contract the rest of the codebase expects.
export function run(sql: string, params: any[] = []): Promise<void> {
  return Promise.resolve().then(() => { sqlite.prepare(sql).run(...params); });
}

export function get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return Promise.resolve().then(() => sqlite.prepare(sql).get(...params) as T | undefined);
}

export function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return Promise.resolve().then(() => sqlite.prepare(sql).all(...params) as T[]);
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
      sqlite.prepare(`
        CREATE TABLE "cash" (
          "id"          text    PRIMARY KEY NOT NULL,
          "currency"    text    NOT NULL,
          "amount"      real    NOT NULL,
          "description" text    NOT NULL DEFAULT '',
          "ts"          integer NOT NULL
        )
      `).run();
    }
    sqlite.prepare(`CREATE INDEX IF NOT EXISTS "idx_cash_ts" ON "cash" ("ts")`).run();
  }

  // interest — migration 0002 renamed interest_months → interest.
  if (!tableExists('interest')) {
    if (tableExists('interest_months')) {
      sqlite.prepare(`ALTER TABLE "interest_months" RENAME TO "interest"`).run();
    } else {
      sqlite.prepare(`
        CREATE TABLE "interest" (
          "month"      text NOT NULL,
          "currency"   text NOT NULL DEFAULT 'BRL',
          "amount"     real,
          "created_at" integer
        )
      `).run();
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

  const hasTradesTable = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='trades'`)
    .get();
  if (!hasTradesTable) return;

  ensureLegacyTablesExist();

  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) return;

  const journal: { entries: { tag: string; when: number }[] } = JSON.parse(
    fs.readFileSync(journalPath, 'utf8'),
  );
  if (journal.entries.length === 0) return;

  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id         SERIAL  PRIMARY KEY,
      hash       text    NOT NULL,
      created_at numeric
    )
  `).run();

  const lastEntry = journal.entries.reduce(
    (max, e) => (e.when > max.when ? e : max),
    journal.entries[0],
  );
  const sqlContent = fs.readFileSync(
    path.join(MIGRATIONS_DIR, `${lastEntry.tag}.sql`),
    'utf8',
  );
  const hash = createHash('sha256').update(sqlContent).digest('hex');
  sqlite
    .prepare(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`)
    .run(hash, lastEntry.when);

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

