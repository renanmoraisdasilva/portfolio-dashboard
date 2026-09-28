/**
 * Portfolio valuation: totals, invested cost, BRL conversion, per-position P/L
 * and the allocation split.
 *
 * Phase 6 pulled this out of the two Vue stores, which had each grown their own
 * copy with subtly different rules — the dashboard counts interest as realized
 * P/L, the simulator derives realized P/L from the FIFO walk and has no interest
 * at all. Both call this, and so does `GET /api/portfolio/valuation`, so the
 * number a browser renders is the number the API would have computed.
 *
 * Realized P/L arrives as an *input* rather than being derived here, because the
 * callers trust different sources: the API reads the `profit` column the server
 * recorded on each sell (see `realizedFromTradeProfit`), while the simulator
 * replays lots because its trades do not exist in the database yet.
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
