import { SYMBOLS as SYMBOL_CONFIGS } from '../config/symbols';
import { brlToUSD, createSymbolClassifier } from '@portfolio-dashboard/shared';

/** Money rules bound to the configured symbol registry. */
const moneyRules = createSymbolClassifier(SYMBOL_CONFIGS);

export interface LotEntry {
  qty: number;
  price: number; // trade purchase price in the asset's native currency
}

export interface PortfolioInput {
  lots: Record<string, LotEntry[]>;
  prices: Record<string, number>;
  cash: {
    cashReais: number;
    cashDollars: number;
  };
  realizedFromSells: number;       // sum of trade.profit for all sell trades (USD)
  interestBRLMonthsTotal: number;  // sum of interest.amount WHERE currency='BRL'
  interestUSDMonthsTotal: number;  // sum of interest.amount WHERE currency='USD'
}

export interface PortfolioResult {
  total: number;
  investedNet: number;
  p: number;
  brlUsdRate: number;
}

/**
 * Returns true for BRL-denominated non-bond assets (e.g. BOVA11, IVVB11).
 * Their prices and trade prices are natively in BRL and must be converted to USD.
 */
export function isBRLNonBond(symbol: string): boolean {
  return moneyRules.isBRLNonBond(symbol);
}

/**
 * Replays all trades in FIFO order and returns open lot positions per symbol.
 * fallbackPrices is used when a buy trade has no recorded price.
 */
export function replayFIFOLots(
  trades: Array<{ symbol: string; side: string; qty: number; price?: number | null }>,
  fallbackPrices: Record<string, number> = {}
): Record<string, LotEntry[]> {
  const lots: Record<string, LotEntry[]> = {};
  for (const t of trades) {
    if (!lots[t.symbol]) lots[t.symbol] = [];
    if (t.side === 'buy') {
      lots[t.symbol].push({ qty: t.qty, price: t.price ?? (fallbackPrices[t.symbol] ?? 0) });
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

/**
 * Computes total portfolio value, net invested cost basis, and unrealized P/L.
 * All monetary values are returned in USD.
 * Throws if a symbol with an open position has a missing or zero price.
 */
export function computePortfolioValue(input: PortfolioInput): PortfolioResult {
  const { lots, prices, cash, realizedFromSells, interestBRLMonthsTotal, interestUSDMonthsTotal } = input;
  const { cashReais, cashDollars } = cash;
  const brlUsdRate = prices['BRLUSD'] ?? 1;

  // Cost basis of all open lots (in USD)
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

  // Realized gains reduce the net invested basis
  const realized = realizedFromSells + brlToUSD(interestBRLMonthsTotal, brlUsdRate) + interestUSDMonthsTotal;
  const investedNet = Math.max(0, invested - realized);

  // Market value of all open positions + cash
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
