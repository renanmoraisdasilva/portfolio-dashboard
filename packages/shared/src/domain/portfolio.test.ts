import { createPortfolioCalculator } from './portfolio';

const calculator = createPortfolioCalculator({
  BOVA11: { type: 'stock', denominatedInBRL: true },
  IVVB11: { type: 'stock', denominatedInBRL: true },
});

const { isBRLNonBond, replayFIFOLots, replayTradesWithRealized } = calculator;

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

describe('replayTradesWithRealized', () => {
  test('returns the same lots as replayFIFOLots', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
      { symbol: 'BTC', side: 'buy', qty: 1, price: 200 },
      { symbol: 'BTC', side: 'sell', qty: 1.5, price: 300 },
    ];
    expect(replayTradesWithRealized(trades).lots).toEqual(replayFIFOLots(trades));
  });

  test('books realized P/L as sells consume the oldest lots first', () => {
    const out = replayTradesWithRealized([
      { symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
      { symbol: 'BTC', side: 'buy', qty: 1, price: 200 },
      { symbol: 'BTC', side: 'sell', qty: 1.5, price: 300 },
    ]);
    expect(out.realized).toBeCloseTo(250);
    expect(out.positions.BTC).toBeCloseTo(0.5);
    expect(out.lots.BTC).toEqual([{ qty: 0.5, price: 200 }]);
  });

  test('falls back to the market price when a trade has none', () => {
    const out = replayTradesWithRealized(
      [
        { symbol: 'BTC', side: 'buy', qty: 1 },
        { symbol: 'BTC', side: 'sell', qty: 1, price: 250 },
      ],
      { BTC: 100 },
    );
    expect(out.realized).toBeCloseTo(150);
    expect(out.positions.BTC).toBe(0);
  });

  test('ignores sells with no open lots', () => {
    const out = replayTradesWithRealized([{ symbol: 'ETH', side: 'sell', qty: 2, price: 50 }]);
    expect(out.realized).toBe(0);
    expect(out.positions.ETH).toBe(0);
  });
});

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
      { symbol: 'BTC', side: 'buy', qty: 1, price: 40000 },
      { symbol: 'BTC', side: 'buy', qty: 2, price: 50000 },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 60000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toEqual([{ qty: 2, price: 50000 }]);
  });

  test('sell partially consumes oldest lot', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 3, price: 40000 },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 60000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toEqual([{ qty: 2, price: 40000 }]);
  });

  test('sell spanning multiple lots consumes them in order', () => {
    const trades = [
      { symbol: 'ETH', side: 'buy', qty: 2, price: 2000 },
      { symbol: 'ETH', side: 'buy', qty: 3, price: 3000 },
      { symbol: 'ETH', side: 'sell', qty: 3, price: 4000 }, // exhausts first lot + 1 from second
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['ETH']).toEqual([{ qty: 2, price: 3000 }]);
  });

  test('selling entire position leaves empty lot array', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 1, price: 50000 },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 60000 },
    ];
    const lots = replayFIFOLots(trades);
    expect(lots['BTC']).toEqual([]);
  });

  test('oversell beyond lots does not throw and empties lots', () => {
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 1, price: 50000 },
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
