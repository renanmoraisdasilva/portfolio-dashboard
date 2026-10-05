export interface SymbolConfig {
  id: string;
  name: string;
  coingeckoId?: string;
  yahooTicker?: string;
  historicalFallbacks?: string[];
  type: 'crypto' | 'stock' | 'currency' | 'bond';
  denominatedInBRL?: boolean; // true when price/value is natively in BRL (BOVA11, IVVB11)
}

export const SYMBOLS: Record<string, SymbolConfig> = {
  BTC: {
    id: 'BTC',
    name: 'Bitcoin',
    coingeckoId: 'bitcoin',
    yahooTicker: 'BTC-USD',
    historicalFallbacks: ['BTC-USD', 'BTCUSD', 'BTC'],
    type: 'crypto',
  },
  ETH: {
    id: 'ETH',
    name: 'Ethereum',
    coingeckoId: 'ethereum',
    yahooTicker: 'ETH-USD',
    historicalFallbacks: ['ETH-USD', 'ETHUSD', 'ETH'],
    type: 'crypto',
  },
  SOL: {
    id: 'SOL',
    name: 'Solana',
    coingeckoId: 'solana',
    yahooTicker: 'SOL-USD',
    historicalFallbacks: ['SOL-USD', 'SOLUSD', 'SOL'],
    type: 'crypto',
  },
  SPY: {
    id: 'SPY',
    name: 'S&P 500 ETF',
    yahooTicker: 'SPY',
    historicalFallbacks: ['SPY', 'SPY.SA', 'SPY11.SA'],
    type: 'stock',
  },
  GLD: {
    id: 'GLD',
    name: 'Gold ETF',
    yahooTicker: 'GLD',
    historicalFallbacks: ['GLD', 'GLD.SA', 'GLD11.SA'],
    type: 'stock',
  },
  IBIT: {
    id: 'IBIT',
    name: 'Bitcoin iShares',
    yahooTicker: 'IBIT.SA',
    historicalFallbacks: ['IBIT.SA', 'IBIT', 'IBIT11.SA'],
    type: 'stock',
  },
  IAU: {
    id: 'IAU',
    name: 'Gold iShares',
    yahooTicker: 'IAU',
    historicalFallbacks: ['IAU', 'IAU.SA', 'IAU11.SA'],
    type: 'stock',
  },
  BRLUSD: {
    id: 'BRLUSD',
    name: 'BRL to USD',
    yahooTicker: 'USDBRL=X',
    historicalFallbacks: ['USDBRL=X'],
    type: 'currency',
  },
  BOVA11: {
    id: 'BOVA11',
    name: 'Bovespa ETF',
    yahooTicker: 'BOVA11.SA',
    historicalFallbacks: ['BOVA11.SA', 'BOVA11'],
    type: 'stock',
    denominatedInBRL: true,
  },
  IVVB11: {
    id: 'IVVB11',
    name: 'iShares S&P 500 ETF',
    yahooTicker: 'IVVB11.SA',
    historicalFallbacks: ['IVVB11.SA', 'IVVB11'],
    type: 'stock',
    denominatedInBRL: true,
  },
};

export const SYMBOL_IDS = Object.keys(SYMBOLS);

export const getCryptoSymbols = () =>
  Object.values(SYMBOLS)
    .filter((s) => s.type === 'crypto')
    .map((s) => s.id);
export const getStockSymbols = () =>
  Object.values(SYMBOLS)
    .filter((s) => s.type === 'stock')
    .map((s) => s.id);
export const getCurrencySymbols = () =>
  Object.values(SYMBOLS)
    .filter((s) => s.type === 'currency')
    .map((s) => s.id);
