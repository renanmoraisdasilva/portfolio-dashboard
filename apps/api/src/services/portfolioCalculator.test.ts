/**
 * Unit tests for portfolioCalculator.ts — pure functions, no DB, no mocks needed.
 *
 * Covers:
 *   replayFIFOLots  — lot accumulation, FIFO sell consumption, oversell, empty input
 *   computePortfolioValue — basic math, BRL conversion, missing-price throw,
 *                           investedNet floor, cash handling, realized gains
 */

import { replayFIFOLots, computePortfolioValue, isBRLNonBond } from './portfolioCalculator';

// ─── isBRLNonBond ─────────────────────────────────────────────────────────────

describe('isBRLNonBond', () => {
  test('returns true for BRL-denominated stocks (BOVA11, IVVB11)', () => {
    expect(isBRLNonBond('BOVA11')).toBe(true);
    expect(isBRLNonBond('IVVB11')).toBe(true);
  });

  test('returns false for USD-denominated symbols', () => {
    expect(isBRLNonBond('BTC')).toBe(false);
    expect(isBRLNonBond('SPY')).toBe(false);
  });

  test('returns false for unknown symbol', () => {
    expect(isBRLNonBond('UNKNOWN')).toBe(false);
  });
});

// ─── replayFIFOLots ───────────────────────────────────────────────────────────

describe('replayFIFOLots', () => {
  test('empty trade list returns empty lots', () => {
    expect(replayFIFOLots([])).toEqual({});
  });

  test('single buy creates one lot', () => {
    const lots = replayFIFOLots([{ symbol: 'BTC', side: 'buy', qty: 1, price: 50000 }]);
    expect(lots['BTC']).toEqual([{ qty: 1, price: 50000 }]);
  });

  test('multiple buys accumulate lots in order', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 1, price: 40000 },
      { symbol: 'BTC', side: 'buy', qty: 2, price: 50000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toEqual([
      { qty: 1, price: 40000 },
      { qty: 2, price: 50000 },
    ]);
  });

  test('sell fully consumes oldest lot (FIFO)', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy',  qty: 1, price: 40000 },
      { symbol: 'BTC', side: 'buy',  qty: 2, price: 50000 },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 60000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toEqual([{ qty: 2, price: 50000 }]);
  });

  test('sell partially consumes oldest lot', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy',  qty: 3, price: 40000 },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 60000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toEqual([{ qty: 2, price: 40000 }]);
  });

  test('sell spanning multiple lots consumes them in order', () => {
    const trades = [
      { symbol: 'ETH', side: 'buy',  qty: 2, price: 2000 },
      { symbol: 'ETH', side: 'buy',  qty: 3, price: 3000 },
      { symbol: 'ETH', side: 'sell', qty: 3, price: 4000 }, // exhausts first lot + 1 from second
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['ETH']).toEqual([{ qty: 2, price: 3000 }]);
  });

  test('selling entire position leaves empty lot array', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy',  qty: 1, price: 50000 },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 60000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toEqual([]);
  });

  test('oversell beyond lots does not throw and empties lots', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy',  qty: 1, price: 50000 },
      { symbol: 'BTC', side: 'sell', qty: 5, price: 60000 }, // sell more than owned
    ];
    expect(() => replayFIFOLots(trades)).not.toThrow();
    expect(replayFIFOLots(trades)['BTC']).toEqual([]);
  });

  test('buy with null price uses fallbackPrices', () => {
    const trades = [{ symbol: 'SPY', side: 'buy', qty: 10, price: null }];
    const lots = replayFIFOLots(trades, { SPY: 500 });
    expect(lots['SPY']).toEqual([{ qty: 10, price: 500 }]);
  });

  test('buy with null price and no fallback defaults to 0', () => {
    const trades = [{ symbol: 'SPY', side: 'buy', qty: 10, price: null }];
    const lots = replayFIFOLots(trades, {});
    expect(lots['SPY']).toEqual([{ qty: 10, price: 0 }]);
  });

  test('multiple symbols are tracked independently', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 1, price: 50000 },
      { symbol: 'ETH', side: 'buy', qty: 5, price: 2000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toHaveLength(1);
    expect(lots['ETH']).toHaveLength(1);
  });
});

// ─── computePortfolioValue ────────────────────────────────────────────────────

const zeroCash = { cashReais: 0, cashDollars: 0 };

describe('computePortfolioValue', () => {
  test('single USD position: total = qty * price', () => {
    const lots  = { BTC: [{ qty: 2, price: 40000 }] };
    const prices = { BTC: 50000, BRLUSD: 0.2 };
    const { total } = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });
    expect(total).toBeCloseTo(100000);
  });

  test('BRL-denominated position (BOVA11) is converted to USD', () => {
    const brlusd = 0.2; // 1 BRL = 0.2 USD
    const lots   = { BOVA11: [{ qty: 100, price: 50 }] }; // 100 units @ R$50 each
    const prices = { BOVA11: 55, BRLUSD: brlusd };         // current price R$55

    const { total } = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });
    // 100 * 55 BRL * 0.2 BRLUSD = 1100 USD
    expect(total).toBeCloseTo(1100);
  });

  test('cash in BRL and USD is included in total', () => {
    const lots   = {};
    const prices = { BRLUSD: 0.2 };
    const cash   = { cashReais: 1000, cashDollars: 200 };

    const { total } = computePortfolioValue({ lots, prices, cash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });
    // 1000 * 0.2 + 200 = 400
    expect(total).toBeCloseTo(400);
  });

  test('missing BRLUSD defaults to rate 1', () => {
    const lots   = {};
    const prices = {}; // no BRLUSD
    const cash   = { cashReais: 100, cashDollars: 0 };

    const { total, brlUsdRate } = computePortfolioValue({ lots, prices, cash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });
    expect(brlUsdRate).toBe(1);
    expect(total).toBeCloseTo(100);
  });

  test('brlUsdRate in result matches BRLUSD price', () => {
    const { brlUsdRate } = computePortfolioValue({
      lots: {}, prices: { BRLUSD: 0.18 }, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0,
    });
    expect(brlUsdRate).toBeCloseTo(0.18);
  });

  test('throws when open position has missing price', () => {
    const lots = { ETH: [{ qty: 1, price: 2000 }] };
    const prices = { BRLUSD: 0.2 }; // ETH price absent

    expect(() => computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 }))
      .toThrow(/Missing price for ETH/);
  });

  test('throws when open position has price 0', () => {
    const lots = { BTC: [{ qty: 1, price: 50000 }] };
    const prices = { BTC: 0, BRLUSD: 0.2 };

    expect(() => computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 }))
      .toThrow(/Missing price for BTC/);
  });

  test('zero-qty lots do not trigger missing-price error', () => {
    const lots = { BTC: [{ qty: 0, price: 50000 }] };
    const prices = { BTC: 0, BRLUSD: 0.2 }; // price=0 but no position

    expect(() => computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 }))
      .not.toThrow();
  });

  test('investedNet reflects cost basis of open lots in USD', () => {
    const lots = { BTC: [{ qty: 2, price: 40000 }] }; // bought @ 40k each
    const prices = { BTC: 60000, BRLUSD: 0.2 };

    const { investedNet } = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });
    // cost basis = 2 * 40000 = 80000
    expect(investedNet).toBeCloseTo(80000);
  });

  test('realized gains reduce investedNet', () => {
    const lots = { BTC: [{ qty: 1, price: 50000 }] };
    const prices = { BTC: 60000, BRLUSD: 0.2 };

    const { investedNet } = computePortfolioValue({
      lots, prices, cash: zeroCash, realizedFromSells: 10000, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0,
    });
    // cost basis 50000 - realized 10000 = 40000
    expect(investedNet).toBeCloseTo(40000);
  });

  test('investedNet is floored at 0 (never negative)', () => {
    const lots = {};
    const prices = { BRLUSD: 0.2 };

    const { investedNet } = computePortfolioValue({
      lots, prices, cash: zeroCash, realizedFromSells: 999999, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0,
    });
    expect(investedNet).toBe(0);
  });

  test('p = total - invested (unrealized P/L)', () => {
    const lots = { BTC: [{ qty: 1, price: 40000 }] };
    const prices = { BTC: 50000, BRLUSD: 0.2 };

    const { total, p } = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });
    // invested = 40000, total = 50000, p = 50000 - 40000 = 10000
    expect(total).toBeCloseTo(50000);
    expect(p).toBeCloseTo(10000);
  });

  test('interestBRLMonthsTotal is added to realized and reduces investedNet', () => {
    const lots = { BTC: [{ qty: 1, price: 50000 }] };
    const prices = { BTC: 50000, BRLUSD: 0.2 };

    const withInterest    = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 5000, interestUSDMonthsTotal: 0 });
    const withoutInterest = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });

    // 5000 BRL * 0.2 = 1000 USD additional realized → investedNet decreases by 1000
    expect(withInterest.investedNet).toBeCloseTo(withoutInterest.investedNet - 1000);
  });

  test('interestUSDMonthsTotal is added to realized and reduces investedNet', () => {
    const lots = { BTC: [{ qty: 1, price: 50000 }] };
    const prices = { BTC: 50000, BRLUSD: 0.2 };

    const withInterest    = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 500 });
    const withoutInterest = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });

    // 500 USD directly reduces investedNet by 500 (no currency conversion)
    expect(withInterest.investedNet).toBeCloseTo(withoutInterest.investedNet - 500);
  });

  test('BRL and USD interest combine correctly', () => {
    const lots = { BTC: [{ qty: 1, price: 50000 }] };
    const prices = { BTC: 50000, BRLUSD: 0.2 };

    // 5000 BRL * 0.2 = 1000 USD + 300 USD = 1300 USD total realized
    const result = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 5000, interestUSDMonthsTotal: 300 });
    const baseline = computePortfolioValue({ lots, prices, cash: zeroCash, realizedFromSells: 0, interestBRLMonthsTotal: 0, interestUSDMonthsTotal: 0 });

    expect(result.investedNet).toBeCloseTo(baseline.investedNet - 1300);
  });
});
