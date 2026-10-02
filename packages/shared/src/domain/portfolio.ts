/**
 * Portfolio valuation and FIFO lot replay, shared by `apps/api` and (from
 * `apps/web`.
 *
 * Pure: no DOM, no database, no I/O. The symbol registry is injected through
 * `createPortfolioCalculator`, so the API binds `src/config/symbols.ts` and
 * the frontend binds whatever `/api/config/symbols` returned — one
 * implementation, two registries.
 *

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
  /**
   * Realized P/L per input trade, aligned by index: `realizedByTradeIndex[i]` is
   * what `trades[i]` booked. Buys and sells that consumed no lot are 0.
   *
   * Index-aligned rather than keyed by id because this walk does not require ids
   * — the simulator's trades have never been in the database. `sum` equals
   * `realized`, so a caller that only needs the total can keep reading that.
   */
  realizedByTradeIndex: number[];
}

/**
 * The calculator as a set of independent functions.
 *
 * Every member is declared `this: void`, and that is load-bearing rather than
 * decoration. `apps/api/src/services/portfolioCalculator.ts` re-exports these by
 * detaching them from the returned object — `export const replayFIFOLots =
 * calculator.replayFIFOLots` — which is the whole point of a factory that closes
 * over a symbol map instead of a class. It works because none of them touch
 * `this`, and saying so in the type is what makes it *stay* working: convert a
 * declaration to a method that reads `this` and these three re-exports break
 * silently, at runtime, on the first call.
 *
 * `unbound-method` is what surfaced this. It is a true positive about the shape
 * and a false positive about the intent, so the fix was to state the invariant
 * rather than to restructure the module.
 */
export interface PortfolioCalculator {
  isBRLNonBond(this: void, symbol: string): boolean;
  replayFIFOLots(
    this: void,
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices?: Record<string, number>,
  ): Record<string, LotEntry[]>;
  /**
   * The same FIFO walk as `replayFIFOLots`, but also books realized P/L as
   * sells consume lots, per trade as well as in total. Used by the simulator,
   * whose trades are not in the database, and by `computeRealizedFromSales`,
   * which every server-side consumer of realized P/L goes through.
   */
  replayTradesWithRealized(
    this: void,
    trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
    fallbackPrices?: Record<string, number>,
  ): ReplayResult;
  computePortfolioValue(this: void, input: PortfolioInput): PortfolioResult;
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
    /**
     * Not floored at zero.
     *
     * This clamp existed in three places — here, in `computeValuation`, and in the
     * simulator store — and reported `0` where the honest figure was a loss, with
     * no log and nothing on screen to say so. All three now report
     * `invested - realized` unchanged.
     *
     * `computePortfolioValue` and `computeValuation` are two implementations of
     * the same rules; keeping this line in step with `valuation.ts` is a manual
     * obligation until that duplication is resolved (3.2, still open). Both are
     * covered by their own test pinning the same negative figure, so a future
     * change to one and not the other fails the build rather than shipping.
     */
    const investedNet = invested - realized;

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
