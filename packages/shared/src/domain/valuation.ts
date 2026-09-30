/**
 * Portfolio valuation: totals, invested cost, BRL conversion, per-position P/L
 * and the allocation split.
 *
 * This was pulled out of the two Vue stores, which had each grown their own
 * copy with subtly different rules — the dashboard counts interest as realized
 * P/L, the simulator derives realized P/L from the FIFO walk and has no interest
 * at all. Both call this, and so does `GET /api/portfolio/valuation`, so the
 * number a browser renders is the number the API would have computed.
 *
 * Realized P/L from sales arrives as an *input* rather than being derived here,
 * because this function must also value a portfolio that does not exist yet: the
 * simulator's what-if trades. Callers that have real trades should derive it with
 * `computeRealizedFromSales` and pass the result, so that the server, the
 * snapshot writer and the simulator cannot disagree about it.
 *
 * Pure: no DOM, no database, no clock. The FIFO walk itself stays in
 * `portfolio.ts` — this module composes it rather than repeating it, because two
 * FIFO walks would drift and the drift would only show up as a wrong P/L.
 *
 * Every number here is an amount in the currency named beside it; deciding how
 * to *print* an amount (`formatMoney`, prefixes, sign placement) belongs to the
 * view. What the view must not re-derive is which currency an amount is in, or
 * whether a BRL quote needs converting — that is the domain, and it is here.
 */
import { brlToUSD, createSymbolClassifier, type Currency, type SymbolMap } from './money';
import { createPortfolioCalculator, type LotEntry } from './portfolio';

export interface ValuationTrade {
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
}

export interface ValuationCash {
  cashReais: number;
  cashDollars: number;
}

export interface ValuationInterest {
  /** Interest earned on BRL cash, in BRL. */
  brlTotal: number;
  /** Interest earned on USD cash, in USD. */
  usdTotal: number;
}

export interface ValuationInput {
  trades: readonly ValuationTrade[];
  prices: Record<string, number>;
  /**
   * Prices used only to cost a buy that carries none. Defaults to `prices`.
   *
   * The simulator needs it distinct: an override of exactly 0 means "this asset
   * is now worthless", so it must reach the FIFO walk, while the same 0 falling
   * back to the market price is right for a *current* valuation of an asset the
   * scenario never set. Collapsing the two would silently cost a lot at the
   * market price the scenario just zeroed.
   */
  lotFallbackPrices?: Record<string, number>;
  /** `priceBRL` is the BRL quote for a symbol the database stores in USD (bonds). */
  priceMeta?: Record<string, { priceBRL?: number } | undefined>;
  cash: ValuationCash;
  /** Realized P/L in USD from sells, excluding interest. */
  realizedFromSells: number;
  interest: ValuationInterest;
  brlUsdRate: number;
  symbols: SymbolMap;
  /** Adds the BRL-cash and USD-cash rows to `rows`, as the positions table shows them. */
  includeCashRows?: boolean;
  /** Adds cash to the allocation slices, as the "With Cash" toggle does. */
  includeCashInAllocation?: boolean;
}

export type PositionRowKind = 'position' | 'brl-cash' | 'usd-cash';

export interface PositionRow {
  symbol: string;
  kind: PositionRowKind;
  qty: number;
  /** Average cost, in `valueCurrency`. */
  avgCost: number;
  /** Current price, in `valueCurrency`. Zero for the USD-cash row, which has none. */
  currentPrice: number;
  value: number;
  pl: number;
  plPct: number;
  /** Currency `avgCost`, `currentPrice` and `value` are denominated in. */
  valueCurrency: Currency;
  /**
   * Currency `pl` is denominated in. Differs from `valueCurrency` for the BRL
   * cash row: the balance and its value are USD (the portfolio is valued in
   * USD) while the interest earned on it is a BRL amount.
   */
  plCurrency: Currency;
  /** The current price came from `priceMeta.priceBRL` (a bond quoting in BRL). */
  quotedInBrl?: boolean;
}

export interface AllocationSlice {
  label: string;
  /** Share of the portfolio, in USD. */
  value: number;
  pct: number;
}

export interface ValuationResult {
  lots: Record<string, LotEntry[]>;
  positions: Record<string, number>;
  /** Holdings at market value plus both cash balances, in USD. */
  total: number;
  /** Cost basis of open lots plus both cash balances, in USD. */
  invested: number;
  investedNet: number;
  /** Realized P/L from sells plus interest earned, in USD. */
  realized: number;
  unrealized: number;
  unrealizedPct: number;
  /** Market value of the tickers only — excludes cash and the BRLUSD pair. */
  tickerValue: number;
  investedPct: number;
  breakEven: boolean;
  rows: PositionRow[];
  allocation: AllocationSlice[];
  /** Unrealized P/L per open position, in USD. */
  plByAsset: Array<{ symbol: string; pl: number }>;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** A trade as the FIFO walk needs it, plus the id used to report P/L per sell. */
export interface RealizedSaleTrade {
  id?: string;
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
}

export interface RealizedFromSales {
  /**
   * Realized P/L booked by sells, in USD. This is the number `computeValuation`
   * wants as `realizedFromSells`, so the two cannot disagree about currency.
   */
  totalUsd: number;
  /**
   * Realized P/L per sell, keyed by trade id, **in the symbol's own currency** —
   * BRL for BOVA11, USD for a bond (which is stored in USD and quoted in BRL).
   * Buys are absent, and a sell that consumed no lot is 0.
   *
   * Native rather than USD on purpose: this replaces the `trades.profit` column,
   * which was recorded per trade in the asset's own currency, and the trade
   * history renders each row in that currency. Only the *total* has to be one
   * currency, because only the total is added to the portfolio figures.
   */
  nativeByTradeId: Record<string, number>;
}

/**
 * Realized P/L from sales, derived from the FIFO walk.
 *
 * One function, because the alternative was three copies of the same idea
 * disagreeing: `GET /api/portfolio/valuation` and the two snapshot paths in
 * `historyManager` each had their own `trades.profit` sum, and once the column
 * was dropped in migration 0003 all three silently returned zero while every
 * downstream figure (realized P/L, invested net, the analytics) stayed
 * internally consistent and wrong together.
 *
 * Two rules that are easy to get wrong, and are the reason this is shared rather
 * than inlined:
 *
 * 1. **Currency.** A FIFO gain is in the *symbol's* currency. A BRL-denominated
 *    stock (BOVA11, IVVB11) realizes BRL, and adding that to a USD total would
 *    be wrong by the exchange rate. `isBRLNonBond` is the same test
 *    `computeValuation` uses for invested cost, so cost and gain convert
 *    identically. A *bond* is stored in USD and quoted in BRL, so its trades are
 *    already USD and must not be converted — hence non-bond.
 * 2. **Order.** The walk is only correct over chronologically ordered trades;
 *    on unsorted input it produces a plausible wrong number rather than an
 *    error. Callers must pass trades ordered oldest first. In SQLite that means
 *    `ORDER BY time ASC` — *not* rowid order, which differs on this database.
 *
 * Pure: no clock, no database. `trades` must be time-ordered; `fallbackPrices`
 * prices a trade that has no explicit price, exactly as the walk does for lots.
 */
export function computeRealizedFromSales(
  trades: readonly RealizedSaleTrade[],
  symbols: SymbolMap,
  brlUsdRate: number,
  fallbackPrices: Record<string, number> = {},
): RealizedFromSales {
  const calculator = createPortfolioCalculator(symbols);
  const { realizedByTradeIndex } = calculator.replayTradesWithRealized(
    trades.map((t) => ({ symbol: t.symbol, side: t.side, qty: t.qty, price: t.price ?? null })),
    fallbackPrices,
  );
  // Same 1:1 fallback as `computeValuation`: a missing BRLUSD must not make a
  // BRL gain vanish, and must not turn a small one into a large one either.
  const rate = brlUsdRate || 1;

  let totalUsd = 0;
  const nativeByTradeId: Record<string, number> = {};
  trades.forEach((trade, index) => {
    if (trade.side !== 'sell') return;
    const native = realizedByTradeIndex[index] ?? 0;
    // Only a BRL-denominated *non-bond* needs converting. A bond is stored in
    // USD and quoted in BRL, so its trades are already USD — the same test
    // `computeValuation` applies to invested cost, so cost and gain agree.
    totalUsd += calculator.isBRLNonBond(trade.symbol) ? brlToUSD(native, rate) : native;
    if (trade.id) nativeByTradeId[trade.id] = native;
  });

  return { totalUsd, nativeByTradeId };
}

export function computeValuation(input: ValuationInput): ValuationResult {
  const { prices, cash, interest, brlUsdRate, symbols, priceMeta = {} } = input;
  const { isBRLNonBond, isBRLBond } = createSymbolClassifier(symbols);
  // A missing rate means 1:1, the same fallback `computePortfolioValue` uses to
  // write history. Zeroing the BRL side instead would make the portfolio appear
  // to lose every BRL holding the moment BRLUSD is missing from the price cache.
  const rate = brlUsdRate || 1;

  const lots = createPortfolioCalculator(symbols).replayFIFOLots(
    input.trades.map((t) => ({ symbol: t.symbol, side: t.side, qty: t.qty, price: t.price ?? null })),
    input.lotFallbackPrices ?? prices,
  );

  const positions: Record<string, number> = {};
  for (const symbol of Object.keys(lots)) {
    positions[symbol] = sum(lots[symbol].map((lot) => lot.qty));
  }
  const symbols_ = Object.keys(positions);

  /** Lot cost in the symbol's own currency, before any BRL conversion. */
  // Safe without a guard: every key of `positions` came from `lots`, so a closed
  // out position reads as an empty lot list rather than as missing.
  const nativeCost = (symbol: string): number => sum(lots[symbol].map((lot) => lot.qty * lot.price));
  /** Position value in the symbol's own currency, before any BRL conversion. */
  const nativeValue = (symbol: string): number => positions[symbol] * (prices[symbol] ?? 0);
  /** Native amount to USD, converting only what the registry calls BRL. */
  const toUSD = (symbol: string, amount: number): number => (isBRLNonBond(symbol) ? brlToUSD(amount, rate) : amount);

  let invested = 0;
  for (const symbol of symbols_) invested += toUSD(symbol, nativeCost(symbol));
  invested += brlToUSD(cash.cashReais, rate) + cash.cashDollars;

  let total = 0;
  for (const symbol of symbols_) total += toUSD(symbol, nativeValue(symbol));
  total += brlToUSD(cash.cashReais, rate) + cash.cashDollars;

  const realized = input.realizedFromSells + brlToUSD(interest.brlTotal, rate) + interest.usdTotal;
  const investedNet = Math.max(0, invested - realized);
  const unrealized = total - invested;
  const unrealizedPct = invested > 0 ? (unrealized / invested) * 100 : 0;

  const tickerSymbols = symbols_.filter((s) => s !== 'BRLUSD');
  const tickerValue = sum(tickerSymbols.map((s) => toUSD(s, nativeValue(s))));
  const investedPct = total > 0 ? (tickerValue / total) * 100 : 0;

  const rows: PositionRow[] = symbols_.map((symbol) => {
    const qty = positions[symbol];
    const cost = nativeCost(symbol);
    const current = prices[symbol] ?? 0;

    if (isBRLBond(symbol)) {
      // A bond is stored in USD but quoted in BRL, so its row is shown in BRL
      // while the portfolio total stays in USD.
      const costBRL = cost / rate;
      const metaBRL = priceMeta[symbol]?.priceBRL;
      const currentBRL = typeof metaBRL === 'number' ? metaBRL : current / rate;
      const valueBRL = qty * currentBRL;
      const plBRL = valueBRL - costBRL;
      return {
        symbol,
        kind: 'position' as const,
        qty,
        avgCost: qty > 0 ? costBRL / qty : 0,
        currentPrice: currentBRL,
        value: valueBRL,
        pl: plBRL,
        plPct: costBRL > 0 ? (plBRL / costBRL) * 100 : 0,
        valueCurrency: 'BRL' as const,
        plCurrency: 'BRL' as const,
        quotedInBrl: typeof metaBRL === 'number',
      };
    }

    if (isBRLNonBond(symbol)) {
      const value = qty * current;
      const pl = value - cost;
      return {
        symbol,
        kind: 'position' as const,
        qty,
        avgCost: qty > 0 ? cost / qty : 0,
        currentPrice: current,
        value,
        pl,
        plPct: cost > 0 ? (pl / cost) * 100 : 0,
        valueCurrency: 'BRL' as const,
        plCurrency: 'BRL' as const,
      };
    }

    const value = qty * current;
    const pl = value - cost;
    return {
      symbol,
      kind: 'position' as const,
      qty,
      avgCost: qty > 0 ? cost / qty : 0,
      currentPrice: current,
      value,
      pl,
      plPct: cost > 0 ? (pl / cost) * 100 : 0,
      valueCurrency: 'USD' as const,
      plCurrency: 'USD' as const,
    };
  });

  if (input.includeCashRows) {
    if (cash.cashReais > 0 || interest.brlTotal > 0) {
      rows.push({
        symbol: 'BRL (100% CDI)',
        kind: 'brl-cash',
        qty: cash.cashReais,
        // One BRL is worth `rate` USD, so the rate is both the average and the
        // current price of a unit of BRL cash.
        avgCost: rate,
        currentPrice: rate,
        value: brlToUSD(cash.cashReais, rate),
        pl: interest.brlTotal,
        plPct: cash.cashReais > 0 ? (interest.brlTotal / cash.cashReais) * 100 : 0,
        valueCurrency: 'USD',
        plCurrency: 'BRL',
      });
    }
    if (cash.cashDollars > 0 || interest.usdTotal > 0) {
      rows.push({
        symbol: 'Dollar',
        kind: 'usd-cash',
        qty: cash.cashDollars,
        // USD cash has no purchase price, so the row shows a dash for both.
        avgCost: 0,
        currentPrice: 0,
        value: cash.cashDollars,
        pl: interest.usdTotal,
        plPct: cash.cashDollars > 0 ? (interest.usdTotal / cash.cashDollars) * 100 : 0,
        valueCurrency: 'USD',
        plCurrency: 'USD',
      });
    }
  }

  const labels = [...symbols_];
  const slices = symbols_.map((s) => toUSD(s, nativeValue(s)));
  if (input.includeCashInAllocation) {
    if (cash.cashReais > 0) {
      labels.push('BRL');
      slices.push(brlToUSD(cash.cashReais, rate));
    }
    if (cash.cashDollars > 0) {
      labels.push('Dollar');
      slices.push(cash.cashDollars);
    }
  }
  const allocationTotal = sum(slices);
  const allocation: AllocationSlice[] = labels.map((label, i) => ({
    label,
    value: slices[i],
    pct: allocationTotal > 0 ? (slices[i] / allocationTotal) * 100 : 0,
  }));

  const plByAsset = symbols_.map((symbol) => ({
    symbol,
    pl: toUSD(symbol, nativeValue(symbol) - nativeCost(symbol)),
  }));

  return {
    lots,
    positions,
    total,
    invested,
    investedNet,
    realized,
    unrealized,
    unrealizedPct,
    tickerValue,
    investedPct,
    breakEven: Math.abs(unrealized) < 0.01,
    rows,
    allocation,
    plByAsset,
  };
}
