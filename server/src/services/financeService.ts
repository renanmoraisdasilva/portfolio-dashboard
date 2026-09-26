import { runF, allF, getF, currentYear, yearFilter } from '../financeDb';
import { randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export interface FinanceIncome {
  id: string;
  month: number;
  year: number;
  source: string;
  value: number;
  description?: string | null;
  ts?: number;
}

export interface FinanceTithe {
  id: string;
  month: number;
  year: number;
  source: string;
  value: number;
  breakdown?: string | null;
  ts?: number;
}

export interface FinanceFixedExpense {
  id: string;
  month: number;
  year: number;
  name: string;
  category: string;
  value: number;
  paymentMethod?: string | null;
  normallyDueDay?: number | null; // day of month (1-31)
  paidOnDate?: string | null; // ISO date string, null if not yet paid
  ts?: number;
}

export interface FinanceEventualExpense {
  id: string;
  month: number;
  year: number;
  category: string;
  value: number;
  description?: string | null;
  paymentMethod?: string | null;
  ts?: number;
}

export interface FinanceCreditExpense {
  id: string;
  card: string;
  month: number;
  year: number;
  category: string;
  value: number;
  paymentMethod?: string | null;
  description?: string | null;
  paidOnDate?: string | null; // ISO date string, null if not yet paid
  ts?: number;
}

export interface FinanceJSON {
  year: number;
  incomes: any[][];
  tithes: any[][];
  fixedExpenses: any[][];
  eventualExpenses: any[][];
  creditCards: {
    nuRenan: any[][];
    nuJu: any[][];
    nomad: any[][];
  };
}

// ============================================================================
// Constants
// ============================================================================

const DATA_TABLES = ['incomes', 'tithes', 'fixed_expenses', 'eventual_expenses', 'credit_card_expenses'] as const;
const CREDIT_CARDS = ['nuRenan', 'nuJu', 'nomad'] as const;

// ============================================================================
// Database initialization
// ============================================================================

export async function initFinanceDB(): Promise<void> {
  await runF('PRAGMA journal_mode = WAL');
  await runF('PRAGMA foreign_keys = ON');

  await runF(`CREATE TABLE IF NOT EXISTS incomes (
    id TEXT PRIMARY KEY, month INTEGER NOT NULL, year INTEGER NOT NULL,
    source TEXT, value REAL DEFAULT 0, description TEXT, ts INTEGER
  )`);

  await runF(`CREATE TABLE IF NOT EXISTS tithes (
    id TEXT PRIMARY KEY, month INTEGER NOT NULL, year INTEGER NOT NULL,
    source TEXT, value REAL DEFAULT 0, breakdown TEXT, ts INTEGER
  )`);

  await runF(`CREATE TABLE IF NOT EXISTS fixed_expenses (
    id TEXT PRIMARY KEY, month INTEGER NOT NULL, year INTEGER NOT NULL,
    name TEXT, category TEXT, value REAL DEFAULT 0, paymentMethod TEXT,
    normallyDueDay INTEGER, paidOnDate TEXT, ts INTEGER
  )`);

  await runF(`CREATE TABLE IF NOT EXISTS eventual_expenses (
    id TEXT PRIMARY KEY, month INTEGER NOT NULL, year INTEGER NOT NULL,
    category TEXT, value REAL DEFAULT 0, description TEXT, paymentMethod TEXT, ts INTEGER
  )`);

  await runF(`CREATE TABLE IF NOT EXISTS credit_card_expenses (
    id TEXT PRIMARY KEY, card TEXT NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL,
    category TEXT, value REAL DEFAULT 0, paymentMethod TEXT, description TEXT, paidOnDate TEXT, ts INTEGER
  )`);

  await runF(`CREATE TABLE IF NOT EXISTS finance_years (
    year INTEGER PRIMARY KEY, created_at INTEGER
  )`);

  // Migrate legacy DBs: ensure every data table has a `year` column
  const fallbackYear = currentYear();
  for (const table of DATA_TABLES) {
    const cols: any[] = await allF(`PRAGMA table_info(${table})`);
    if (!cols.find((c) => c.name === 'year')) {
      try { await runF(`ALTER TABLE ${table} ADD COLUMN year INTEGER DEFAULT ${fallbackYear}`); }
      catch (err) { console.warn(`Could not add year column to ${table}`, err); }
    }
  }

  // Migrate fixed_expenses table: add normallyDueDay and paidOnDate columns if missing
  const fixedCols: any[] = await allF(`PRAGMA table_info(fixed_expenses)`);
  if (!fixedCols.find((c) => c.name === 'normallyDueDay')) {
    try { await runF(`ALTER TABLE fixed_expenses ADD COLUMN normallyDueDay INTEGER`); }
    catch (err) { console.warn(`Could not add normallyDueDay column`, err); }
  }
  if (!fixedCols.find((c) => c.name === 'paidOnDate')) {
    try { await runF(`ALTER TABLE fixed_expenses ADD COLUMN paidOnDate TEXT`); }
    catch (err) { console.warn(`Could not add paidOnDate column`, err); }
  }

  // Migrate credit_card_expenses table: add paidOnDate column if missing
  const creditCols: any[] = await allF(`PRAGMA table_info(credit_card_expenses)`);
  if (!creditCols.find((c) => c.name === 'paidOnDate')) {
    try { await runF(`ALTER TABLE credit_card_expenses ADD COLUMN paidOnDate TEXT`); }
    catch (err) { console.warn(`Could not add paidOnDate column to credit_card_expenses`, err); }
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

function newId(): string { return randomUUID(); }
function now(): number { return Date.now(); }
function resolveYear(year?: number): number {
  return typeof year === 'number' && Number.isFinite(year) ? year : currentYear();
}

/**
 * Normalize normallyDueDay: ensure it's either null or a valid day (1-31).
 * This eliminates null vs 0 confusion by explicitly rejecting invalid values.
 */
function normalizeNormallyDueDay(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num >= 1 && num <= 31) return num;
  return null; // reject 0, negative, > 31, etc.
}

// ============================================================================
// Income CRUD
// ============================================================================

export async function addIncome(month: number, source: string, value: number, description?: string, year?: number): Promise<FinanceIncome> {
  const id = newId();
  await runF(
    'INSERT INTO incomes (id,month,year,source,value,description,ts) VALUES (?,?,?,?,?,?,?)',
    [id, month, resolveYear(year), source, value, description ?? null, now()],
  );
  return (await getF<FinanceIncome>('SELECT * FROM incomes WHERE id=?', [id]))!;
}

export async function updateIncome(id: string, source: string, value: number, description?: string): Promise<FinanceIncome | undefined> {
  await runF('UPDATE incomes SET source=?,value=?,description=?,ts=? WHERE id=?', [source, value, description ?? null, now(), id]);
  return getF<FinanceIncome>('SELECT * FROM incomes WHERE id=?', [id]);
}

export async function deleteIncome(id: string): Promise<void> {
  await runF('DELETE FROM incomes WHERE id=?', [id]);
}

// ============================================================================
// Tithe helpers (computed client-side, persisted only for import/export)
// ============================================================================

async function insertTithe(month: number, source: string, value: number, breakdown: string | null, year: number, ts: number): Promise<void> {
  await runF(
    'INSERT INTO tithes (id,month,year,source,value,breakdown,ts) VALUES (?,?,?,?,?,?,?)',
    [newId(), month, year, source, value, breakdown, ts],
  );
}

// ============================================================================
// Fixed Expense CRUD
// ============================================================================

export async function getFixedExpenses(month: number, year?: number): Promise<FinanceFixedExpense[]> {
  const yf = yearFilter(year);
  return allF<FinanceFixedExpense>(`SELECT * FROM fixed_expenses WHERE month=?${yf.clause} ORDER BY ts ASC`, [month, ...yf.params]);
}

export async function addFixedExpense(
  month: number,
  name: string,
  category: string,
  value: number,
  paymentMethod?: string,
  year?: number,
  normallyDueDay?: number,
  paidOnDate?: string
): Promise<FinanceFixedExpense> {
  const id = newId();
  const normalizedDueDay = normalizeNormallyDueDay(normallyDueDay);
  await runF(
    'INSERT INTO fixed_expenses (id,month,year,name,category,value,paymentMethod,normallyDueDay,paidOnDate,ts) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, month, resolveYear(year), name, category, value, paymentMethod ?? null, normalizedDueDay, paidOnDate ?? null, now()],
  );
  return (await getF<FinanceFixedExpense>('SELECT * FROM fixed_expenses WHERE id=?', [id]))!;
}

export async function updateFixedExpense(
  id: string,
  fields: {
    name?: string;
    category?: string;
    value?: number;
    paymentMethod?: string;
    normallyDueDay?: number | null;
    paidOnDate?: string | null;
  }
): Promise<FinanceFixedExpense | undefined> {
  // Build SET clause selectively — only update fields that were provided
  const setClauses: string[] = [];
  const params: any[] = [];

  if (fields.name !== undefined) { setClauses.push('name=?'); params.push(fields.name ?? null); }
  if (fields.category !== undefined) { setClauses.push('category=?'); params.push(fields.category ?? null); }
  if (fields.value !== undefined) { setClauses.push('value=?'); params.push(fields.value ?? 0); }
  if (fields.paymentMethod !== undefined) { setClauses.push('paymentMethod=?'); params.push(fields.paymentMethod ?? null); }
  if (fields.normallyDueDay !== undefined) { 
    setClauses.push('normallyDueDay=?');
    const normalizedDueDay = normalizeNormallyDueDay(fields.normallyDueDay);
    params.push(normalizedDueDay);
  }
  if (fields.paidOnDate !== undefined) { setClauses.push('paidOnDate=?'); params.push(fields.paidOnDate ?? null); }

  // Always update ts
  setClauses.push('ts=?');
  params.push(now());
  params.push(id);

  if (setClauses.length === 1) {
    // Only ts was updated, which shouldn't happen but handle it anyway
    return getF<FinanceFixedExpense>('SELECT * FROM fixed_expenses WHERE id=?', [id]);
  }

  await runF(`UPDATE fixed_expenses SET ${setClauses.join(',')} WHERE id=?`, params);
  return getF<FinanceFixedExpense>('SELECT * FROM fixed_expenses WHERE id=?', [id]);
}

export async function deleteFixedExpense(id: string): Promise<void> {
  await runF('DELETE FROM fixed_expenses WHERE id=?', [id]);
}

// ============================================================================
// Eventual Expense CRUD
// ============================================================================

export async function getEventualExpenses(month: number, year?: number): Promise<FinanceEventualExpense[]> {
  const yf = yearFilter(year);
  return allF<FinanceEventualExpense>(`SELECT * FROM eventual_expenses WHERE month=?${yf.clause} ORDER BY ts ASC`, [month, ...yf.params]);
}

export async function addEventualExpense(month: number, category: string, value: number, description?: string, paymentMethod?: string, year?: number): Promise<FinanceEventualExpense> {
  const id = newId();
  await runF(
    'INSERT INTO eventual_expenses (id,month,year,category,value,description,paymentMethod,ts) VALUES (?,?,?,?,?,?,?,?)',
    [id, month, resolveYear(year), category, value, description ?? null, paymentMethod ?? null, now()],
  );
  return (await getF<FinanceEventualExpense>('SELECT * FROM eventual_expenses WHERE id=?', [id]))!;
}

export async function updateEventualExpense(id: string, fields: { category?: string; value?: number; description?: string; paymentMethod?: string }): Promise<FinanceEventualExpense | undefined> {
  await runF(
    'UPDATE eventual_expenses SET category=?,value=?,description=?,paymentMethod=?,ts=? WHERE id=?',
    [fields.category ?? null, fields.value ?? 0, fields.description ?? null, fields.paymentMethod ?? null, now(), id],
  );
  return getF<FinanceEventualExpense>('SELECT * FROM eventual_expenses WHERE id=?', [id]);
}

export async function deleteEventualExpense(id: string): Promise<void> {
  await runF('DELETE FROM eventual_expenses WHERE id=?', [id]);
}

// ============================================================================
// Credit Card Expense CRUD
// ============================================================================

export async function getCreditExpenses(card: string, month: number, year?: number): Promise<FinanceCreditExpense[]> {
  const yf = yearFilter(year);
  return allF<FinanceCreditExpense>(`SELECT * FROM credit_card_expenses WHERE card=? AND month=?${yf.clause} ORDER BY ts ASC`, [card, month, ...yf.params]);
}

export async function addCreditExpense(card: string, month: number, category: string, value: number, paymentMethod?: string, description?: string, year?: number, paidOnDate?: string): Promise<FinanceCreditExpense> {
  const id = newId();
  await runF(
    'INSERT INTO credit_card_expenses (id,card,month,year,category,value,paymentMethod,description,paidOnDate,ts) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, card, month, resolveYear(year), category, value, paymentMethod ?? null, description ?? null, paidOnDate ?? null, now()],
  );
  return (await getF<FinanceCreditExpense>('SELECT * FROM credit_card_expenses WHERE id=?', [id]))!;
}

export async function updateCreditExpense(id: string, fields: { category?: string; value?: number; paymentMethod?: string; description?: string; paidOnDate?: string | null }): Promise<FinanceCreditExpense | undefined> {
  // Build SET clause selectively — only update fields that were provided
  const setClauses: string[] = [];
  const params: any[] = [];

  if (fields.category !== undefined) { setClauses.push('category=?'); params.push(fields.category ?? null); }
  if (fields.value !== undefined) { setClauses.push('value=?'); params.push(fields.value ?? 0); }
  if (fields.paymentMethod !== undefined) { setClauses.push('paymentMethod=?'); params.push(fields.paymentMethod ?? null); }
  if (fields.description !== undefined) { setClauses.push('description=?'); params.push(fields.description ?? null); }
  if (fields.paidOnDate !== undefined) { setClauses.push('paidOnDate=?'); params.push(fields.paidOnDate ?? null); }

  // Always update ts
  setClauses.push('ts=?');
  params.push(now());
  params.push(id);

  if (setClauses.length === 1) {
    // Only ts was updated, which shouldn't happen but handle it anyway
    return getF<FinanceCreditExpense>('SELECT * FROM credit_card_expenses WHERE id=?', [id]);
  }

  await runF(`UPDATE credit_card_expenses SET ${setClauses.join(',')} WHERE id=?`, params);
  return getF<FinanceCreditExpense>('SELECT * FROM credit_card_expenses WHERE id=?', [id]);
}

export async function deleteCreditExpense(id: string): Promise<void> {
  await runF('DELETE FROM credit_card_expenses WHERE id=?', [id]);
}

// ============================================================================
// Year management
// ============================================================================

export async function getAvailableYears(): Promise<number[]> {
  const rows = await allF<{ year: number }>(`
    SELECT DISTINCT year FROM (
      SELECT year FROM incomes          UNION ALL
      SELECT year FROM tithes           UNION ALL
      SELECT year FROM fixed_expenses   UNION ALL
      SELECT year FROM eventual_expenses UNION ALL
      SELECT year FROM credit_card_expenses UNION ALL
      SELECT year FROM finance_years
    ) WHERE year IS NOT NULL ORDER BY year DESC
  `);
  return rows.map((r) => r.year).filter(Number.isFinite);
}

export async function createFinanceYear(year: number): Promise<number> {
  if (!Number.isFinite(year) || year < 1900 || year > 3000) throw new Error('Invalid year');
  await runF('INSERT OR IGNORE INTO finance_years (year,created_at) VALUES (?,?)', [year, now()]);
  return year;
}

export async function resetFinanceYear(year: number): Promise<boolean> {
  if (!Number.isFinite(year)) throw new Error('Invalid year');
  for (const table of DATA_TABLES) {
    await runF(`DELETE FROM ${table} WHERE year=?`, [year]);
  }
  return true;
}

// ============================================================================
// Import / Export  — full-year JSON ↔ DB
// ============================================================================

/**
 * Import a full finance JSON payload into the DB.
 * If `json.year` is set, only that year's rows are replaced; otherwise all rows are cleared (legacy).
 */
export async function importFinanceJSON(json: any): Promise<void> {
  const importYear: number | null = Number.isFinite(json.year) ? json.year : null;
  const targetYear = importYear ?? currentYear();
  const timestamp = now();

  // Clear target scope
  for (const table of DATA_TABLES) {
    await runF(importYear === null ? `DELETE FROM ${table}` : `DELETE FROM ${table} WHERE year=?`, importYear === null ? [] : [importYear]);
  }

  // Helper: iterate a 12-element month array and call an inserter for each item
  const eachMonth = async (arr: any[] | undefined, fn: (item: any, month: number) => Promise<void>) => {
    if (!Array.isArray(arr)) return;
    for (let m = 0; m < arr.length; m++) {
      for (const item of arr[m] || []) await fn(item, m);
    }
  };

  await eachMonth(json.incomes, async (it, m) => {
    await runF('INSERT INTO incomes (id,month,year,source,value,description,ts) VALUES (?,?,?,?,?,?,?)',
      [newId(), m, targetYear, it.source ?? null, Number(it.value) || 0, it.description ?? null, timestamp]);
  });

  await eachMonth(json.tithes, async (it, m) => {
    await insertTithe(m, it.source ?? null, Number(it.value) || 0, it.breakdown ?? null, targetYear, timestamp);
  });

  await eachMonth(json.fixedExpenses, async (it, m) => {
    const normalizedDueDay = normalizeNormallyDueDay(it.normallyDueDay);
    await runF('INSERT INTO fixed_expenses (id,month,year,name,category,value,paymentMethod,normallyDueDay,paidOnDate,ts) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [newId(), m, targetYear, it.name ?? null, it.category ?? null, Number(it.value) || 0, it.paymentMethod ?? null, normalizedDueDay, it.paidOnDate ?? null, timestamp]);
  });

  await eachMonth(json.eventualExpenses, async (it, m) => {
    await runF('INSERT INTO eventual_expenses (id,month,year,category,value,description,paymentMethod,ts) VALUES (?,?,?,?,?,?,?,?)',
      [newId(), m, targetYear, it.category ?? null, Number(it.value) || 0, it.description ?? null, it.paymentMethod ?? null, timestamp]);
  });

  for (const card of CREDIT_CARDS) {
    const months = json.creditCards?.[card];
    if (!Array.isArray(months)) continue;
    for (let m = 0; m < months.length; m++) {
      for (const it of months[m] || []) {
        await runF('INSERT INTO credit_card_expenses (id,card,month,year,category,value,paymentMethod,description,paidOnDate,ts) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [newId(), card, m, targetYear, it.category ?? null, Number(it.value) || 0, it.paymentMethod ?? null, it.description ?? null, it.paidOnDate ?? null, timestamp]);
      }
    }
  }
}

/**
 * Export finance data for a given year (or all data) as the canonical JSON shape
 * consumed by the frontend.
 */
export async function exportFinanceJSON(year?: number): Promise<FinanceJSON> {
  const targetYear = year ?? currentYear();
  const yf = yearFilter(year);

  const out: FinanceJSON = {
    year: targetYear,
    incomes: [], tithes: [], fixedExpenses: [], eventualExpenses: [],
    creditCards: { nuRenan: [], nuJu: [], nomad: [] },
  };

  for (let m = 0; m < 12; m++) {
    const mp = [m, ...yf.params];

    out.incomes[m]        = await allF(`SELECT id,source,value,description FROM incomes WHERE month=?${yf.clause}`, mp);
    out.tithes[m]         = await allF(`SELECT id,source,value,breakdown FROM tithes WHERE month=?${yf.clause}`, mp);
    out.fixedExpenses[m]  = await allF(`SELECT id,name,category,value,paymentMethod,normallyDueDay,paidOnDate FROM fixed_expenses WHERE month=?${yf.clause}`, mp);
    out.eventualExpenses[m] = await allF(`SELECT id,category,value,description,paymentMethod FROM eventual_expenses WHERE month=?${yf.clause}`, mp);

    for (const card of CREDIT_CARDS) {
      (out.creditCards as any)[card][m] = await allF(
        `SELECT id,category,value,description,paymentMethod,paidOnDate FROM credit_card_expenses WHERE month=? AND card=?${yf.clause}`,
        [m, card, ...yf.params],
      );
    }
  }

  return out;
}


