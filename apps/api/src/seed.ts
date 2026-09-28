import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { get, init, run } from './db';

type SeedInterest = { month?: string; amount?: number };
type SeedSnapshot = {
  id?: string;
  t?: string;
  ts?: number;
  v?: number;
  i?: number;
  p?: number;
  manual?: number | boolean;
  note?: string;
  brlusd_rate?: number;
};
type SeedData = {
  trades?: Array<{ id?: string; symbol: string; side: string; qty: number; price?: number; time: string }>;
  history?: SeedSnapshot[];
  interestReaisMonths?: SeedInterest[];
  interestDollarsMonths?: SeedInterest[];
  cashReais?: number;
  cashDollars?: number;
};

async function tableCount(table: string): Promise<number> {
  const row = await get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return row?.count ?? 0;
}

async function seed(filePath: string): Promise<void> {
  await init();

  const existingRows = await Promise.all([tableCount('trades'), tableCount('cash'), tableCount('interest')]);
  if (existingRows.some((count) => count > 0)) {
    console.log('[seed] Database already contains data; skipping seed.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SeedData;
  const now = Date.now();

  await run('BEGIN TRANSACTION');
  try {
    await run('DELETE FROM portfolio_snapshots');
    await run('DELETE FROM analytics_snapshots');

    for (const trade of data.trades ?? []) {
      await run('INSERT INTO trades (id, symbol, side, qty, price, time) VALUES (?, ?, ?, ?, ?, ?)', [
        trade.id ?? randomUUID(),
        trade.symbol,
        trade.side,
        trade.qty,
        trade.price ?? null,
        trade.time,
      ]);
    }

    for (const snapshot of data.history ?? []) {
      await run(
        'INSERT INTO portfolio_snapshots (id, t, ts, v, i, p, manual, note, brlusd_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          snapshot.id ?? randomUUID(),
          snapshot.t ?? null,
          snapshot.ts ?? null,
          snapshot.v ?? 0,
          snapshot.i ?? null,
          snapshot.p ?? null,
          snapshot.manual ? 1 : 0,
          snapshot.note ?? null,
          snapshot.brlusd_rate ?? null,
        ],
      );
    }

    for (const interest of data.interestReaisMonths ?? []) {
      await run('INSERT INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
        interest.month,
        'BRL',
        interest.amount ?? 0,
        now,
      ]);
    }
    for (const interest of data.interestDollarsMonths ?? []) {
      await run('INSERT INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
        interest.month,
        'USD',
        interest.amount ?? 0,
        now,
      ]);
    }

    if (data.cashReais) {
      await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
        randomUUID(),
        'BRL',
        data.cashReais,
        'Local development seed',
        now,
      ]);
    }
    if (data.cashDollars) {
      await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
        randomUUID(),
        'USD',
        data.cashDollars,
        'Local development seed',
        now,
      ]);
    }

    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }

  console.log('[seed] Local sample data inserted.');
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node dist/seed.js /path/to/portfolio_data.json');
  process.exit(1);
}

seed(filePath).catch((error) => {
  console.error('[seed] Failed:', error);
  process.exit(1);
});
