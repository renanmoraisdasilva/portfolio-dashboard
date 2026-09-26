/**
 * Pure helper functions for the cash backfill migration.
 * No DB calls here — fully testable with plain data.
 *
 * Strategy:
 *   For each sampled portfolio snapshot:
 *     1. Replay FIFO lots up to that timestamp
 *     2. Look up asset prices at that timestamp (from price_ticks)
 *     3. Derive:  cashUSD = snapshot.total_value − investment_market_value_USD
 *     4. Convert: cashBRL = cashUSD / brlusd_rate
 *   The series of running cashBRL balances is then turned into signed deltas
 *   suitable for INSERT into the append-only `cash` event log.
 */

import { replayFIFOLots, isBRLNonBond } from './portfolioCalculator';

export interface SnapshotPoint {
  ts: number;
  v: number;               // total portfolio value in USD (from portfolio_snapshots.v)
  brlusd_rate: number | null;
}

export interface PriceMap { [symbol: string]: number; }

export interface CashEstimate {
  ts: number;
  cashBRL: number;
}

export interface CashDelta {
  ts: number;
  amount: number;          // signed BRL delta to insert into cash event log
}

export type BackfillTrade = {
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
  time: string;            // ISO string
};

/**
 * Evenly samples `n` elements from `arr`, always including the first and last.
 */
export function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  if (n <= 1) return [arr[0]];
  const result: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const idx = Math.min(Math.round(i * step), arr.length - 1);
    result.push(arr[idx]);
  }
  return result;
}

/**
 * Computes estimated cash balance (in BRL) at each sampled snapshot point.
 *
 * @param sampledSnapshots  Pre-sampled subset of portfolio_snapshots rows
 * @param allTrades         All trades sorted ASC by `time` (filtered internally per ts)
 * @param getPricesAt       Callback that returns the best known price map for a given ts.
 *                          Return an empty object when no price data is available — the
 *                          snapshot will be skipped.
 * @returns Array of { ts, cashBRL } in the same order as sampledSnapshots, skipping
 *          points where no prices were available.
 */
export function computeCashEstimates(
  sampledSnapshots: SnapshotPoint[],
  allTrades: BackfillTrade[],
  getPricesAt: (ts: number) => PriceMap,
): CashEstimate[] {
  const results: CashEstimate[] = [];

  for (const snap of sampledSnapshots) {
    const cutoff = new Date(snap.ts).toISOString();
    const tradesAtTs = allTrades.filter(t => t.time <= cutoff);
    const lots = replayFIFOLots(tradesAtTs, {});

    const prices = getPricesAt(snap.ts);
    if (Object.keys(prices).length === 0) continue;

    const brlusd: number = snap.brlusd_rate ?? prices['BRLUSD'] ?? 1;

    let investmentUSD = 0;
    for (const [symbol, lotList] of Object.entries(lots)) {
      const qty = lotList.reduce((s, l) => s + l.qty, 0);
      if (qty <= 0) continue;
      const price = prices[symbol];
      if (!price) continue;
      const priceUSD = isBRLNonBond(symbol) ? price * brlusd : price;
      investmentUSD += qty * priceUSD;
    }

    const cashUSD = snap.v - investmentUSD;
    const cashBRL = brlusd > 0 ? cashUSD / brlusd : 0;
    results.push({ ts: snap.ts, cashBRL });
  }

  return results;
}

/**
 * Converts a series of running cash balance estimates into signed deltas.
 * The first entry is the initial deposit; subsequent entries are the change
 * from the previous estimate.  Entries with |delta| < 0.001 are omitted.
 */
export function estimatesToDeltas(estimates: CashEstimate[]): CashDelta[] {
  const deltas: CashDelta[] = [];
  let prev = 0;
  for (const e of estimates) {
    const delta = e.cashBRL - prev;
    if (Math.abs(delta) >= 0.001) {
      deltas.push({ ts: e.ts, amount: delta });
    }
    prev = e.cashBRL;
  }
  return deltas;
}
