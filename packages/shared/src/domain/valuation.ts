import { CENT, brlToUSD, createSymbolClassifier, type Currency, type SymbolMap } from './money';
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
  brlTotal: number;
  usdTotal: number;
}

export interface ValuationInput {
  trades: readonly ValuationTrade[];
  prices: Record<string, number>;
  lotFallbackPrices?: Record<string, number>;
  priceMeta?: Record<string, { priceBRL?: number } | undefined>;
  cash: ValuationCash;
  realizedFromSells: number;
  interest: ValuationInterest;
  brlUsdRate: number;
  symbols: SymbolMap;
  includeCashRows?: boolean;
  includeCashInAllocation?: boolean;
}

export type PositionRowKind = 'position' | 'brl-cash' | 'usd-cash';

export interface PositionRow {
  symbol: string;
  kind: PositionRowKind;
  qty: number;
  avgCost: number;
  currentPrice: number;
  value: number;
  pl: number;
  plPct: number;
  valueCurrency: Currency;
  plCurrency: Currency;
  quotedInBrl?: boolean;
}

export interface AllocationSlice {
  label: string;
  value: number;
  pct: number;
}

export interface ValuationResult {
  lots: Record<string, LotEntry[]>;
  positions: Record<string, number>;
  total: number;
  invested: number;
  investedNet: number;
  realized: number;
  unrealized: number;
  unrealizedPct: number;
  tickerValue: number;
  investedPct: number;
  breakEven: boolean;
  rows: PositionRow[];
  allocation: AllocationSlice[];
  plByAsset: Array<{ symbol: string; pl: number }>;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export interface RealizedSaleTrade {
  id?: string;
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
}

export interface RealizedFromSales {
  totalUsd: number;
  nativeByTradeId: Record<string, number>;
}

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
  const rate = brlUsdRate || 1;

  let totalUsd = 0;
  const nativeByTradeId: Record<string, number> = {};
  trades.forEach((trade, index) => {
    if (trade.side !== 'sell') return;
    const native = realizedByTradeIndex[index] ?? 0;
    totalUsd += calculator.isBRLNonBond(trade.symbol) ? brlToUSD(native, rate) : native;
    if (trade.id) nativeByTradeId[trade.id] = native;
  });

  return { totalUsd, nativeByTradeId };
}

export function computeValuation(input: ValuationInput): ValuationResult {
  const { prices, cash, interest, brlUsdRate, symbols, priceMeta = {} } = input;
  const { isBRLNonBond, isBRLBond } = createSymbolClassifier(symbols);
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
  const openSymbols = symbols_.filter((symbol) => positions[symbol] !== 0);

  const nativeCost = (symbol: string): number => sum(lots[symbol].map((lot) => lot.qty * lot.price));
  const nativeValue = (symbol: string): number => positions[symbol] * (prices[symbol] ?? 0);
  const toUSD = (symbol: string, amount: number): number => (isBRLNonBond(symbol) ? brlToUSD(amount, rate) : amount);

  let invested = 0;
  for (const symbol of symbols_) invested += toUSD(symbol, nativeCost(symbol));
  invested += brlToUSD(cash.cashReais, rate) + cash.cashDollars;

  let total = 0;
  for (const symbol of symbols_) total += toUSD(symbol, nativeValue(symbol));
  total += brlToUSD(cash.cashReais, rate) + cash.cashDollars;

  const realized = input.realizedFromSells + brlToUSD(interest.brlTotal, rate) + interest.usdTotal;
  const investedNet = invested - realized;
  const unrealized = total - invested;
  const unrealizedPct = invested > 0 ? (unrealized / invested) * 100 : 0;

  const tickerSymbols = symbols_.filter((s) => s !== 'BRLUSD');
  const tickerValue = sum(tickerSymbols.map((s) => toUSD(s, nativeValue(s))));
  const investedPct = total > 0 ? (tickerValue / total) * 100 : 0;

  const rows: PositionRow[] = openSymbols.map((symbol) => {
    const qty = positions[symbol];
    const cost = nativeCost(symbol);
    const current = prices[symbol] ?? 0;

    if (isBRLBond(symbol)) {
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

  const labels = [...openSymbols];
  const slices = openSymbols.map((s) => toUSD(s, nativeValue(s)));
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

  const plByAsset = openSymbols.map((symbol) => ({
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
    breakEven: Math.abs(unrealized) < CENT,
    rows,
    allocation,
    plByAsset,
  };
}
