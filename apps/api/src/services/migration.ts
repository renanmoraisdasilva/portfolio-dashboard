import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { runSync, init, transaction } from '../db';

export async function migrateFromJson() {
  // __dirname is apps/api/{src,dist}/services, so the repository root is four
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', '..', 'fixtures', 'portfolio_data.json'),
    path.resolve(__dirname, '..', '..', '..', '..', 'portfolio_data.json'),
    path.resolve(__dirname, '..', '..', 'portfolio_data.json'),
    path.resolve(process.cwd(), 'fixtures', 'portfolio_data.json'),
    path.resolve(process.cwd(), 'portfolio_data.json'),
  ];
  const dataPath = candidates.find((p) => fs.existsSync(p));
  if (!dataPath) throw new Error('portfolio_data.json not found (checked: ' + candidates.join(', ') + ')');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const json = JSON.parse(raw);

  await init();

  // The counts are derived from the parsed payload rather than read back, so the
  // transaction's return value is not needed here.
  transaction(() => {
    // Trades
    if (Array.isArray(json.trades)) {
      for (const t of json.trades) {
        const id = randomUUID();
        runSync('INSERT OR REPLACE INTO trades (id, symbol, side, qty, price, time) VALUES (?, ?, ?, ?, ?, ?)', [
          id,
          t.symbol,
          t.side,
          t.qty,
          t.price ?? null,
          t.time,
        ]);
      }
    }

    if (Array.isArray(json.history)) {
      for (const h of json.history) {
        const id = randomUUID();
        runSync('INSERT OR REPLACE INTO portfolio_snapshots (id, t, ts, v, i, p, manual, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          id,
          h.t ?? null,
          h.ts ?? null,
          h.v ?? 0,
          h.i ?? null,
          h.p ?? null,
          h.manual ? 1 : 0,
          h.note ?? null,
        ]);
      }
    }

    // Interest months — interest.currency defaults to BRL, so tag USD explicitly.
    if (Array.isArray(json.interestReaisMonths)) {
      for (const m of json.interestReaisMonths) {
        runSync('INSERT OR REPLACE INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
          m.month,
          'BRL',
          m.amount,
          Date.now(),
        ]);
      }
    }
    if (Array.isArray(json.interestDollarsMonths)) {
      for (const m of json.interestDollarsMonths) {
        runSync('INSERT OR REPLACE INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
          m.month,
          'USD',
          m.amount,
          Date.now(),
        ]);
      }
    }

    // Cash — append-only ledger; the balance is SUM(amount) per currency. There
    if (Array.isArray(json.cashEntries) && json.cashEntries.length > 0) {
      for (const e of json.cashEntries) {
        runSync('INSERT OR REPLACE INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
          e.id ?? randomUUID(),
          e.currency,
          e.amount,
          e.description ?? '',
          e.ts ?? Date.now(),
        ]);
      }
    } else {
      const cashReais = Number(json.cashReais) || 0;
      const cashDollars = Number(json.cashDollars) || 0;
      if (cashReais !== 0) {
        runSync('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(),
          'BRL',
          cashReais,
          'Imported from portfolio_data.json',
          Date.now(),
        ]);
      }
      if (cashDollars !== 0) {
        runSync('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(),
          'USD',
          cashDollars,
          'Imported from portfolio_data.json',
          Date.now(),
        ]);
      }
    }
  });

  return {
    trades: Array.isArray(json.trades) ? json.trades.length : 0,
    history: Array.isArray(json.history) ? json.history.length : 0,
  };
}
