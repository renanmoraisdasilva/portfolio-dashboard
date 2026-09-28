
import { replayFIFOLots, isBRLNonBond } from './portfolioCalculator';

export interface SnapshotPoint {
  ts: number;
  v: number;
  brlusd_rate: number | null;
}

export interface PriceMap { [symbol: string]: number; }

export interface CashEstimate {
  ts: number;
  cashBRL: number;
}

export interface CashDelta {
  ts: number;
  amount: number;
}

export type BackfillTrade = {
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
  time: string;
};

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
