import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';
import { createHash } from 'node:crypto';

const DATA_DIR = process.env.PORTFOLIO_DATA_DIR
  ? path.resolve(process.env.PORTFOLIO_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'portfolio.db');
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'drizzle', 'migrations');

export const sqlite = new Database(DB_PATH);

export const drizzleDb = drizzle(sqlite, { schema });

export const db = sqlite;

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

export function runSync(sql: string, params: any[] = []): void {
  sqlite.prepare(sql).run(...params);
}

export function getSync<T = any>(sql: string, params: any[] = []): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

export function allSync<T = any>(sql: string, params: any[] = []): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

export function transaction<T>(fn: () => T): T {
  return sqlite.transaction(fn)();
}

function ensureLegacyTablesExist() {
  const tableExists = (name: string) =>
    !!sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);

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
