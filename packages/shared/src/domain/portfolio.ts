/**
 * Portfolio valuation and FIFO lot replay, shared by `apps/api` and (from
 * Phase 4) `apps/web`.
 *
 * Pure: no DOM, no database, no I/O. The symbol registry is injected through
 * `createPortfolioCalculator`, so the API binds `src/config/symbols.ts` and
 * the frontend binds whatever `/api/config/symbols` returned — one
 * implementation, two registries.
 *
 * Phase 2 of docs/MODERNIZATION-PLAN.md.
 */
import { brlToUSD, createSymbolClassifier, SymbolMap } from './money';

export interface LotEntry {
  qty: number;
  price: number;
}

export interface PortfolioInput {
  lots: Record<string, LotEntry[]>;
  prices: Record<string, number>;
  cash: {
    cashReais: number;
    cashDollars: number;
  };
  realizedFromSells: number;
  interestBRLMonthsTotal: number;
  interestUSDMonthsTotal: number;
}

export interface PortfolioResult {
  total: number;
  investedNet: number;
  p: number;
  brlUsdRate: number;
}

export interface ReplayResult {
  lots: Record<string, LotEntry[]>;
  /** Open quantity per symbol, summed across its lots. Zero positions included. */
  positions: Record<string, number>;
  /** Realized P/L booked by sells, priced at the sell price. */
  realized: number;
}

export interface PortfolioCalculator {
  isBRLNonBond(symbol: string): boolean;
  replayFIFOLots(
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices?: Record<string, number>,
  ): Record<string, LotEntry[]>;
  /**
   * The same FIFO walk as `replayFIFOLots`, but also books realized P/L as
   * sells consume lots. The simulator needs that; the history manager does not
   * — it reads realized P/L from the `trades.profit` column instead.
   */
  replayTradesWithRealized(
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices?: Record<string, number>,
  ): ReplayResult;
  computePortfolioValue(input: PortfolioInput): PortfolioResult;
}

/**
 * Binds the calculator to a symbol registry. Unknown symbols are never BRL.
 */
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
    for (const t of trades) {
      if (!lots[t.symbol]) lots[t.symbol] = [];
      if (t.side === 'buy') {
        lots[t.symbol].push({ qty: t.qty, price: t.price ?? fallbackPrices[t.symbol] ?? 0 });
      } else if (t.side === 'sell') {
        let qtyToSell = t.qty;
        const price = t.price ?? fallbackPrices[t.symbol] ?? 0;
        while (qtyToSell > 0 && lots[t.symbol].length > 0) {
          const lot = lots[t.symbol][0];
          const used = Math.min(lot.qty, qtyToSell);
          realized += used * (price - lot.price);
          lot.qty -= used;
          qtyToSell -= used;
          if (lot.qty <= 0) lots[t.symbol].shift();
        }
      }
    }
    const positions: Record<string, number> = {};
    for (const s of Object.keys(lots)) {
      positions[s] = lots[s].reduce((a, b) => a + b.qty, 0);
    }
    return { lots, positions, realized };
  }

  function computePortfolioValue(input: PortfolioInput): PortfolioResult {
    const { lots, prices, cash, realizedFromSells, interestBRLMonthsTotal, interestUSDMonthsTotal } = input;
    const { cashReais, cashDollars } = cash;
    const brlUsdRate = prices['BRLUSD'] ?? 1;

    let invested = 0;
    for (const symbol of Object.keys(lots)) {
      const needsBRLConversion = isBRLNonBond(symbol);
      for (const lot of lots[symbol]) {
        const lotPriceUSD = needsBRLConversion ? brlToUSD(lot.price, brlUsdRate) : lot.price;
        invested += lot.qty * lotPriceUSD;
      }
    }
    invested += brlToUSD(cashReais, brlUsdRate);
    invested += cashDollars;

    const realized = realizedFromSells + brlToUSD(interestBRLMonthsTotal, brlUsdRate) + interestUSDMonthsTotal;
    const investedNet = Math.max(0, invested - realized);

    let total = 0;
    for (const symbol of Object.keys(lots)) {
      const positionQty = lots[symbol].reduce((sum, l) => sum + l.qty, 0);
      if (positionQty > 0) {
        const price = prices[symbol] ?? 0;
        if (!price || price === 0) {
          throw new Error(`Missing price for ${symbol}; skipping history point`);
        }
        const priceUSD = isBRLNonBond(symbol) ? brlToUSD(price, brlUsdRate) : price;
        total += positionQty * priceUSD;
      }
    }
    total += brlToUSD(cashReais, brlUsdRate);
    total += cashDollars;

    return { total, investedNet, p: total - invested, brlUsdRate };
  }

  return { isBRLNonBond, replayFIFOLots, replayTradesWithRealized, computePortfolioValue };
}
