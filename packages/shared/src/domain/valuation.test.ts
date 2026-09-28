import { computeValuation, type ValuationInput } from './valuation';
import { createPortfolioCalculator } from './portfolio';

const SYMBOLS = {
  BTC: { type: 'crypto' },
  SPY: { type: 'stock' },
  BRLUSD: { type: 'currency' },
  BOVA11: { type: 'stock', denominatedInBRL: true },
  /** A bond: BRL-denominated for display, stored in USD. */
  BOVB11: { type: 'bond', denominatedInBRL: true },
};

const baseInput: ValuationInput = {
  trades: [
    { symbol: 'BTC', side: 'buy', qty: 0.5, price: 50_000 },
    { symbol: 'SPY', side: 'buy', qty: 10, price: 400 },
  ],
  prices: { BTC: 60_000, SPY: 500, BRLUSD: 0.18 },
  cash: { cashReais: 0, cashDollars: 0 },
  realizedFromSells: 0,
  interest: { brlTotal: 0, usdTotal: 0 },
  brlUsdRate: 0.18,
  symbols: SYMBOLS,
};

const valuation = (overrides: Partial<ValuationInput> = {}) => computeValuation({ ...baseInput, ...overrides });

describe('computeValuation totals', () => {
  test('total is holdings at market value plus both cash balances', () => {
    const result = valuation({ cash: { cashReais: 1000, cashDollars: 500 } });
    // 0.5 BTC at 60k + 10 SPY at 500 + 1000 BRL at 0.18 + 500 USD
    expect(result.total).toBeCloseTo(0.5 * 60_000 + 5_000 + 180 + 500, 8);
  });

  test('invested is the cost basis of open lots plus both cash balances', () => {
    const result = valuation({ cash: { cashReais: 1000, cashDollars: 500 } });
    expect(result.invested).toBeCloseTo(0.5 * 50_000 + 10 * 400 + 180 + 500, 8);
  });

  test('unrealized is total minus invested', () => {
    const result = valuation();
    expect(result.unrealized).toBeCloseTo(result.total - result.invested, 8);
  });

  test('unrealized follows the prices: up after a rally, negative after a fall', () => {
    const rallied = valuation();
    expect(rallied.unrealized).toBeCloseTo(6_000, 8);

    const sold_off = valuation({ prices: { BTC: 40_000, SPY: 300, BRLUSD: 0.18 } });
    // 0.5 BTC down 10k, 10 SPY down 100.
    expect(sold_off.unrealized).toBeCloseTo(-6_000, 8);
  });

  test('a BRL non-bond position is converted once, into both total and invested', () => {
    const result = valuation({
      trades: [{ symbol: 'BOVA11', side: 'buy', qty: 100, price: 10 }],
      prices: { BOVA11: 12, BRLUSD: 0.2 },
      brlUsdRate: 0.2,
      cash: { cashReais: 0, cashDollars: 0 },
    });
    // 100 shares at 10 BRL bought, 12 BRL now, at 0.2 USD per BRL.
    expect(result.total).toBeCloseTo(240, 8);
    expect(result.invested).toBeCloseTo(200, 8);
    expect(result.unrealized).toBeCloseTo(40, 8);
  });

  test('realized counts interest on both currencies, converting the BRL side', () => {
    const result = valuation({
      cash: { cashReais: 1000, cashDollars: 0 },
      interest: { brlTotal: 20, usdTotal: 7 },
      brlUsdRate: 0.2,
    });
    expect(result.realized).toBeCloseTo(0 + 20 * 0.2 + 7, 8);
  });

  test('investedNet is never negative, however much was realized', () => {
    const result = valuation({ realizedFromSells: 10_000_000, interest: { brlTotal: 0, usdTotal: 0 } });
    expect(result.investedNet).toBe(0);
  });

  test('unrealizedPct is measured against invested and is zero when nothing is invested', () => {
    expect(valuation().unrealizedPct).toBeCloseTo(
      ((valuation().total - valuation().invested) / valuation().invested) * 100,
      8,
    );
    const empty = computeValuation({
      ...baseInput,
      trades: [],
      prices: {},
      cash: { cashReais: 0, cashDollars: 0 },
    });
    expect(empty.unrealizedPct).toBe(0);
  });

  test('breakOnly holds when the portfolio is within a cent of its cost', () => {
    const flat = valuation({
      prices: { BTC: 50_000, SPY: 400, BRLUSD: 0.18 },
      cash: { cashReais: 0, cashDollars: 0 },
    });
    expect(flat.unrealized).toBeCloseTo(0, 8);
    expect(flat.breakEven).toBe(true);
    expect(valuation().breakEven).toBe(false);
  });

  test('tickerValue excludes cash and the BRLUSD pair, so investedPct is the share at risk', () => {
    const result = valuation({
      trades: [...baseInput.trades, { symbol: 'BRLUSD', side: 'buy', qty: 100, price: 0.18 }],
      cash: { cashReais: 1000, cashDollars: 500 },
    });
    expect(result.tickerValue).toBeCloseTo(0.5 * 60_000 + 5_000, 8);
    expect(result.investedPct).toBeCloseTo((result.tickerValue / result.total) * 100, 8);
  });
});

describe('computeValuation positions and FIFO', () => {
  test('positions are the open quantity per symbol after sells consume lots', () => {
    const result = valuation({
      trades: [
        { symbol: 'BTC', side: 'buy', qty: 1, price: 50_000 },
        { symbol: 'BTC', side: 'buy', qty: 1, price: 60_000 },
        { symbol: 'BTC', side: 'sell', qty: 1.5, price: 70_000 },
      ],
      prices: { BTC: 70_000, BRLUSD: 0.18 },
    });
    expect(result.positions['BTC']).toBeCloseTo(0.5, 8);
    // The remaining half-lot is the 60k one, not a 55k average.
    expect(result.lots['BTC']).toEqual([{ qty: 0.5, price: 60_000 }]);
  });

  test('a buy with no price falls back to the market price', () => {
    const result = valuation({
      trades: [{ symbol: 'BTC', side: 'buy', qty: 2 }],
      prices: { BTC: 25_000, BRLUSD: 0.18 },
    });
    expect(result.lots['BTC']).toEqual([{ qty: 2, price: 25_000 }]);
  });

  test('lot fallback prices are separate from the prices a position is valued at', () => {
    // The simulator's zeroed override: the lot is costed at 0, while a position
    // with no scenario price still reads its market price.
    const result = valuation({
      trades: [{ symbol: 'BTC', side: 'buy', qty: 2 }],
      prices: { BTC: 25_000, BRLUSD: 0.18 },
      lotFallbackPrices: { BTC: 0, BRLUSD: 0.18 },
    });
    expect(result.lots['BTC']).toEqual([{ qty: 2, price: 0 }]);
    expect(result.invested).toBe(0);
    expect(result.total).toBeCloseTo(50_000, 8);
  });

  test('an empty portfolio values to zero rather than NaN', () => {
    const empty = valuation({ trades: [], prices: {}, cash: { cashReais: 0, cashDollars: 0 } });
    expect(empty.total).toBe(0);
    expect(empty.invested).toBe(0);
    expect(empty.rows).toEqual([]);
    expect(empty.allocation).toEqual([]);
    expect(empty.breakEven).toBe(true);
  });
});

describe('computeValuation rows', () => {
  test('a USD row carries its amounts in USD', () => {
    const result = valuation();
    const btc = result.rows.find((r) => r.symbol === 'BTC');
    expect(btc).toMatchObject({
      kind: 'position',
      qty: 0.5,
      avgCost: 50_000,
      currentPrice: 60_000,
      value: 30_000,
      pl: 5_000,
      plPct: 20,
      valueCurrency: 'USD',
      plCurrency: 'USD',
    });
  });

  test('a BRL non-bond row stays in BRL — the view converts, the domain does not', () => {
    const result = valuation({
      trades: [{ symbol: 'BOVA11', side: 'buy', qty: 100, price: 10 }],
      prices: { BOVA11: 12, BRLUSD: 0.2 },
      brlUsdRate: 0.2,
    });
    expect(result.rows[0]).toMatchObject({
      symbol: 'BOVA11',
      value: 1_200,
      pl: 200,
      plPct: 20,
      valueCurrency: 'BRL',
      plCurrency: 'BRL',
    });
  });

  test('a bond row quotes priceBRL from the price metadata, and says so', () => {
    // Bought 10 at 0.5 USD = 5 USD = 25 BRL; quoted at 2.5 BRL, so 25 BRL today.
    const result = valuation({
      trades: [{ symbol: 'BOVB11', side: 'buy', qty: 10, price: 0.5 }],
      prices: { BOVB11: 0.6, BRLUSD: 0.2 },
      priceMeta: { BOVB11: { priceBRL: 2.5 } },
      brlUsdRate: 0.2,
    });
    expect(result.rows[0]).toMatchObject({
      symbol: 'BOVB11',
      avgCost: 2.5,
      currentPrice: 2.5,
      value: 25,
      pl: 0,
      plPct: 0,
      quotedInBrl: true,
      valueCurrency: 'BRL',
    });
  });

  test('a bond down from its purchase price shows the loss in BRL', () => {
    const result = valuation({
      trades: [{ symbol: 'BOVB11', side: 'buy', qty: 10, price: 1 }],
      prices: { BOVB11: 0.8, BRLUSD: 0.2 },
      priceMeta: { BOVB11: { priceBRL: 2 } },
      brlUsdRate: 0.2,
    });
    expect(result.rows[0]).toMatchObject({ avgCost: 5, value: 20, pl: -30, plPct: -60 });
  });

  test('a bond without priceBRL metadata falls back to converting the USD price', () => {
    const result = valuation({
      trades: [{ symbol: 'BOVB11', side: 'buy', qty: 10, price: 0.5 }],
      prices: { BOVB11: 0.6, BRLUSD: 0.2 },
      brlUsdRate: 0.2,
    });
    expect(result.rows[0].currentPrice).toBeCloseTo(3, 8);
    expect(result.rows[0].quotedInBrl).toBe(false);
  });

  test('cash rows are only added when asked for', () => {
    const withoutRows = valuation({ cash: { cashReais: 1000, cashDollars: 500 } });
    expect(withoutRows.rows.map((r) => r.kind)).toEqual(['position', 'position']);

    const withRows = valuation({ cash: { cashReais: 1000, cashDollars: 500 }, includeCashRows: true });
    expect(withRows.rows.map((r) => r.kind)).toEqual(['position', 'position', 'brl-cash', 'usd-cash']);
  });

  test('the BRL cash row is valued in USD but reports its P/L in BRL', () => {
    const result = valuation({
      cash: { cashReais: 2000, cashDollars: 0 },
      interest: { brlTotal: 50, usdTotal: 0 },
      brlUsdRate: 0.2,
      includeCashRows: true,
    });
    const row = result.rows.find((r) => r.kind === 'brl-cash');
    expect(row).toMatchObject({
      symbol: 'BRL (100% CDI)',
      qty: 2000,
      avgCost: 0.2,
      currentPrice: 0.2,
      value: 400,
      pl: 50,
      plPct: 2.5,
      valueCurrency: 'USD',
      plCurrency: 'BRL',
    });
  });

  test('the USD cash row has no purchase price', () => {
    const result = valuation({
      cash: { cashReais: 0, cashDollars: 1000 },
      interest: { brlTotal: 0, usdTotal: 20 },
      includeCashRows: true,
    });
    const row = result.rows.find((r) => r.kind === 'usd-cash');
    expect(row).toMatchObject({ symbol: 'Dollar', qty: 1000, avgCost: 0, currentPrice: 0, value: 1000, pl: 20, plPct: 2 });
  });

  test('a zero balance with no interest produces no cash row at all', () => {
    const result = valuation({ includeCashRows: true });
    expect(result.rows.filter((r) => r.kind !== 'position')).toEqual([]);
  });
});

describe('computeValuation allocation', () => {
  test('slices are the positions, with percentages over their own total', () => {
    const result = valuation();
    expect(result.allocation.map((s) => s.label)).toEqual(['BTC', 'SPY']);
    expect(result.allocation.map((s) => s.value)).toEqual([30_000, 5_000]);
    expect(result.allocation[0].pct).toBeCloseTo(85.714285, 5);
  });

  test('cash joins the split only when the toggle is on', () => {
    const withoutCash = valuation({ cash: { cashReais: 1000, cashDollars: 500 } });
    expect(withoutCash.allocation.map((s) => s.label)).toEqual(['BTC', 'SPY']);

    const withCash = valuation({ cash: { cashReais: 1000, cashDollars: 500 }, includeCashInAllocation: true });
    expect(withCash.allocation.map((s) => s.label)).toEqual(['BTC', 'SPY', 'BRL', 'Dollar']);
    expect(withCash.allocation.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100, 8);
  });

  test('a zero balance is not given an empty slice', () => {
    const result = valuation({ cash: { cashReais: 0, cashDollars: 0 }, includeCashInAllocation: true });
    expect(result.allocation.map((s) => s.label)).toEqual(['BTC', 'SPY']);
  });
});

describe('computeValuation plByAsset', () => {
  test('reports unrealized P/L per open position, in USD', () => {
    expect(valuation().plByAsset).toEqual([
      { symbol: 'BTC', pl: 5_000 },
      { symbol: 'SPY', pl: 1_000 },
    ]);
  });

  test('converts a BRL position exactly once', () => {
    const result = valuation({
      trades: [{ symbol: 'BOVA11', side: 'buy', qty: 100, price: 10 }],
      prices: { BOVA11: 12, BRLUSD: 0.2 },
      brlUsdRate: 0.2,
    });
    expect(result.plByAsset).toEqual([{ symbol: 'BOVA11', pl: 40 }]);
  });
});

describe('degenerate inputs', () => {
  /**
   * A position whose lots are all consumed still appears in `positions`, at
   * quantity zero. Every per-row division has a zero denominator there, and the
   * alternative is `NaN` in a table cell.
   */
  const closedOut = (symbol: string) => ({
    trades: [
      { symbol, side: 'buy', qty: 1, price: 10 },
      { symbol, side: 'sell', qty: 1, price: 12 },
    ],
    prices: { [symbol]: 12, BRLUSD: 0.2 },
    cash: { cashReais: 0, cashDollars: 0 },
  });

  test.each([
    ['a USD symbol', 'BTC'],
    ['a BRL non-bond', 'BOVA11'],
    ['a bond', 'BOVB11'],
  ])('a closed-out %s reports zero averages rather than NaN', (_label, symbol) => {
    const result = valuation(closedOut(symbol));
    const row = result.rows.find((r) => r.symbol === symbol);
    expect(row).toBeDefined();
    expect(row?.qty).toBe(0);
    expect(row?.avgCost).toBe(0);
    expect(Number.isNaN(row?.avgCost ?? NaN)).toBe(false);
    expect(Number.isNaN(row?.plPct ?? NaN)).toBe(false);
    expect(row?.plPct).toBe(0);
  });

  test('an open position with no price is valued at zero, not at NaN', () => {
    const result = valuation({ trades: [{ symbol: 'GHOST', side: 'buy', qty: 2, price: 5 }], prices: {} });
    const row = result.rows.find((r) => r.symbol === 'GHOST');
    expect(row).toMatchObject({ currentPrice: 0, value: 0, pl: -10, plPct: -100 });
  });

  test('a zero BRL rate falls back to 1:1 rather than zeroing the BRL side', () => {
    const result = valuation({
      trades: [{ symbol: 'BOVA11', side: 'buy', qty: 10, price: 10 }],
      prices: { BOVA11: 10, BRLUSD: 0 },
      brlUsdRate: 0,
      includeCashRows: true,
      includeCashInAllocation: true,
    });
    expect(result.total).toBeCloseTo(100, 8);
    expect(result.invested).toBeCloseTo(100, 8);
    expect(Number.isFinite(result.rows[0].avgCost)).toBe(true);
    expect(result.allocation.every((s) => Number.isFinite(s.pct))).toBe(true);
  });

  test('an interest row with no balance reports a zero return, not Infinity', () => {
    const result = valuation({
      cash: { cashReais: 0, cashDollars: 0 },
      interest: { brlTotal: 25, usdTotal: 10 },
      includeCashRows: true,
    });
    expect(result.rows.find((r) => r.kind === 'brl-cash')?.plPct).toBe(0);
    expect(result.rows.find((r) => r.kind === 'usd-cash')?.plPct).toBe(0);
  });

  test('allocation percentages are zero when every slice is worth nothing', () => {
    const result = valuation({
      trades: [{ symbol: 'BTC', side: 'buy', qty: 1, price: 10 }],
      prices: { BTC: 0, BRLUSD: 0.2 },
    });
    expect(result.allocation).toEqual([{ label: 'BTC', value: 0, pct: 0 }]);
  });

  test('a trade with a null price is treated the same as one with no price', () => {
    const withNull = valuation({
      trades: [{ symbol: 'BTC', side: 'buy', qty: 1, price: null }],
      prices: { BTC: 25_000, BRLUSD: 0.18 },
    });
    const withNone = valuation({
      trades: [{ symbol: 'BTC', side: 'buy', qty: 1 }],
      prices: { BTC: 25_000, BRLUSD: 0.18 },
    });
    expect(withNull.invested).toBe(withNone.invested);
  });

  test('a FIFO walk and a valuation agree on what is open', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 2, price: 100 },
      { symbol: 'BTC', side: 'sell', qty: 0.5, price: 120 },
    ];
    const replay = createPortfolioCalculator(SYMBOLS).replayTradesWithRealized(trades, { BTC: 120 });
    const result = valuation({ trades, prices: { BTC: 120, BRLUSD: 0.18 } });
    expect(result.positions).toEqual(replay.positions);
    // The simulator's realized P/L comes from that walk; the API's does not,
    // because the column it used to read was dropped in migration 0003.
    expect(replay.realized).toBeCloseTo(10, 8);
    expect(result.realized).toBe(0);
  });

  test('handing the walk its realized P/L is what the simulator does', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 2, price: 100 },
      { symbol: 'BTC', side: 'sell', qty: 0.5, price: 120 },
    ];
    const replay = createPortfolioCalculator(SYMBOLS).replayTradesWithRealized(trades, { BTC: 120 });
    const result = valuation({ trades, prices: { BTC: 120, BRLUSD: 0.18 }, realizedFromSells: replay.realized });
    expect(result.realized).toBeCloseTo(10, 8);
    // Realized P/L does not change what the portfolio is worth today: 1.5 BTC
    // is still open, at 120 each, and the 0.5 sold left the ledger.
    expect(result.total).toBeCloseTo(180, 8);
    expect(result.invested).toBeCloseTo(150, 8);
    expect(result.investedNet).toBeCloseTo(150 - 10, 8);
  });
});
