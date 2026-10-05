import { createSymbolClassifier, SymbolMap } from './money';

export interface LotEntry {
  qty: number;
  price: number;
}

export interface ReplayResult {
  lots: Record<string, LotEntry[]>;
  positions: Record<string, number>;
  realized: number;
  realizedByTradeIndex: number[];
}

export interface PortfolioCalculator {
  isBRLNonBond(this: void, symbol: string): boolean;
  replayFIFOLots(
    this: void,
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices?: Record<string, number>,
  ): Record<string, LotEntry[]>;
  replayTradesWithRealized(
    this: void,
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices?: Record<string, number>,
  ): ReplayResult;
}

export function createPortfolioCalculator(symbols: SymbolMap): PortfolioCalculator {
  const { isBRLNonBond } = createSymbolClassifier(symbols);

  function replayFIFOLots(
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices: Record<string, number> = {},
  ): Record<string, LotEntry[]> {
    const lots: Record<string, LotEntry[]> = {};
    for (const t of trades) {
      if (!lots[t.symbol]) lots[t.symbol] = [];
      if (t.side === 'buy') {
        lots[t.symbol].push({ qty: t.qty, price: t.price ?? fallbackPrices[t.symbol] ?? 0 });
      } else if (t.side === 'sell') {
        let qtyToSell = t.qty;
        while (qtyToSell > 0 && lots[t.symbol].length > 0) {
          const lot = lots[t.symbol][0];
          const used = Math.min(lot.qty, qtyToSell);
          lot.qty -= used;
          qtyToSell -= used;
          if (lot.qty <= 0) lots[t.symbol].shift();
        }
      }
    }
    return lots;
  }

  function replayTradesWithRealized(
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices: Record<string, number> = {},
  ): ReplayResult {
    const lots: Record<string, LotEntry[]> = {};
    let realized = 0;
    const realizedByTradeIndex: number[] = new Array(trades.length).fill(0);
    for (let index = 0; index < trades.length; index++) {
      const t = trades[index];
      if (!lots[t.symbol]) lots[t.symbol] = [];
      if (t.side === 'buy') {
        lots[t.symbol].push({ qty: t.qty, price: t.price ?? fallbackPrices[t.symbol] ?? 0 });
      } else if (t.side === 'sell') {
        let qtyToSell = t.qty;
        const price = t.price ?? fallbackPrices[t.symbol] ?? 0;
        let booked = 0;
        while (qtyToSell > 0 && lots[t.symbol].length > 0) {
          const lot = lots[t.symbol][0];
          const used = Math.min(lot.qty, qtyToSell);
          const gain = used * (price - lot.price);
          realized += gain;
          booked += gain;
          lot.qty -= used;
          qtyToSell -= used;
          if (lot.qty <= 0) lots[t.symbol].shift();
        }
        realizedByTradeIndex[index] = booked;
      }
    }
    const positions: Record<string, number> = {};
    for (const s of Object.keys(lots)) {
      positions[s] = lots[s].reduce((a, b) => a + b.qty, 0);
    }
    return { lots, positions, realized, realizedByTradeIndex };
  }

  return { isBRLNonBond, replayFIFOLots, replayTradesWithRealized };
}
