import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FINANCE_DB_PATH = path.join(DATA_DIR, 'finance.db');
export const financeDb = new Database(FINANCE_DB_PATH);

// ---------------------------------------------------------------------------
// Promisified helpers
// ---------------------------------------------------------------------------

/** Execute a write statement (INSERT / UPDATE / DELETE / CREATE). */
export function runF(sql: string, params: any[] = []): Promise<void> {
  return Promise.resolve().then(() => { financeDb.prepare(sql).run(...params); });
}

/** Fetch a single row. */
export function getF<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return Promise.resolve().then(() => financeDb.prepare(sql).get(...params) as T | undefined);
}

/** Fetch all rows. */
export function allF<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return Promise.resolve().then(() => financeDb.prepare(sql).all(...params) as T[]);
}

// ---------------------------------------------------------------------------
// Query-building helpers
// ---------------------------------------------------------------------------

/** Return current year as a fallback. */
export function currentYear(): number {
  return new Date().getFullYear();
}

/**
 * Build an optional `AND year = ?` clause + param array fragment.
 * Usage:
 *   const yf = yearFilter(year);
 *   allF(`SELECT * FROM t WHERE month = ?${yf.clause}`, [month, ...yf.params]);
 */
export function yearFilter(year?: number): { clause: string; params: any[] } {
  if (typeof year === 'number' && Number.isFinite(year)) {
    return { clause: ' AND year = ?', params: [year] };
  }
  return { clause: '', params: [] };
}
