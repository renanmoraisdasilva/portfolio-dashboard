import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { db, run, init } from '../db';

export async function migrateFromJson() {
  // Resolve probable locations for portfolio_data.json
  const candidates = [
    path.resolve(__dirname, '..', '..', 'portfolio_data.json'),
    path.resolve(__dirname, '..', '..', '..', 'portfolio_data.json'),
    path.resolve(process.cwd(), 'portfolio_data.json')
  ];
  let dataPath = candidates.find(p => fs.existsSync(p));
  if (!dataPath) throw new Error('portfolio_data.json not found (checked: ' + candidates.join(', ') + ')');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const json = JSON.parse(raw);

  await init();

  // Wrap in transaction
  await run('BEGIN TRANSACTION');
  try {
    // Trades
    if (Array.isArray(json.trades)) {
      for (const t of json.trades) {
        const id = randomUUID();
        await run('INSERT OR REPLACE INTO trades (id, symbol, side, qty, price, time, profit) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, t.symbol, t.side, t.qty, t.price ?? null, t.time, t.profit ?? null]);
      }
    }

    // History
    if (Array.isArray(json.history)) {
      for (const h of json.history) {
        const id = randomUUID();
        await run('INSERT OR REPLACE INTO portfolio_snapshots (id, t, ts, v, i, p, manual, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, h.t ?? null, h.ts ?? null, h.v ?? 0, h.i ?? null, h.p ?? null, h.manual ? 1 : 0, h.note ?? null]);
      }
    }

    // Interest months
    if (Array.isArray(json.interestReaisMonths)) {
      for (const m of json.interestReaisMonths) {
        await run('INSERT OR REPLACE INTO interest (month, amount, created_at) VALUES (?, ?, ?)', [m.month, m.amount, Date.now()]);
      }
    }

    // Cash positions - single row id=1
    const cashReais = Number(json.cashReais) || 0;
    const cashDollars = Number(json.cashDollars) || 0;
    const interestReais = Number(json.interestReais) || 0;
    const interestDollars = Number(json.interestDollars) || 0;
    await run('INSERT OR REPLACE INTO cash_positions (id, cashReais, cashDollars, interestReais, interestDollars, last_updated) VALUES (1, ?, ?, ?, ?, ?)',
      [cashReais, cashDollars, interestReais, interestDollars, Date.now()]);

    await run('COMMIT');
    return { trades: Array.isArray(json.trades) ? json.trades.length : 0, history: Array.isArray(json.history) ? json.history.length : 0 };
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}
