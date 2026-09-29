import { computeRealizedFromSales } from './valuation';

const SYMBOLS = {
  BTC: { type: 'crypto' },
  BOVA11: { type: 'stock', denominatedInBRL: true },
  /** A bond: quoted in BRL, stored and traded in USD. */
  BOVB11: { type: 'bond', denominatedInBRL: true },
};

const RATE = 0.2;

/**
 * These tests exist because the function they cover replaced a hardcoded 0 in
 * three places, after the `trades.profit` column was dropped in migration 0003.
 * A wrong answer here is not a cosmetic error: it feeds the realized P/L card,
 * invested net, every history snapshot and the analytics.
 */
describe('computeRealizedFromSales', () => {
  test('books a gain as sells consume the oldest lots first', () => {
    const out = computeRealizedFromSales(
      [
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
        { id: 'b2', symbol: 'BTC', side: 'buy', qty: 1, price: 200 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 1, price: 300 },
      ],
      SYMBOLS,
      RATE,
    );

    // The oldest lot (100) is consumed, so the gain is 300 - 100, not 300 - 200.
    expect(out.totalUsd).toBeCloseTo(200);
  });

  test('a sell spanning two lots books both', () => {
    const out = computeRealizedFromSales(
      [
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
        { id: 'b2', symbol: 'BTC', side: 'buy', qty: 1, price: 200 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 2, price: 300 },
      ],
      SYMBOLS,
      RATE,
    );

    expect(out.totalUsd).toBeCloseTo(300); // (300-100) + (300-200)
  });

  test('a partial lot leaves the remainder open and books only what was sold', () => {
    const out = computeRealizedFromSales(
      [
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 2, price: 100 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 0.5, price: 300 },
      ],
      SYMBOLS,
      RATE,
    );

    expect(out.totalUsd).toBeCloseTo(0.5 * 200);
  });

  test('a losing sale books a negative gain', () => {
    const out = computeRealizedFromSales(
      [
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 500 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 1, price: 300 },
      ],
      SYMBOLS,
      RATE,
    );

    expect(out.totalUsd).toBeCloseTo(-200);
  });

  test('a sell with no lot behind it books nothing rather than a phantom gain', () => {
    const out = computeRealizedFromSales([{ id: 's1', symbol: 'BTC', side: 'sell', qty: 1, price: 300 }], SYMBOLS, RATE);

    expect(out.totalUsd).toBe(0);
    expect(out.nativeByTradeId['s1']).toBe(0);
  });

  test('buys are absent from the per-trade map', () => {
    const out = computeRealizedFromSales([{ id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 }], SYMBOLS, RATE);

    expect(Object.keys(out.nativeByTradeId)).toEqual([]);
  });

  describe('currency', () => {
    test('a BRL-denominated gain is converted to USD for the total', () => {
      const out = computeRealizedFromSales(
        [
          { id: 'b1', symbol: 'BOVA11', side: 'buy', qty: 10, price: 100 }, // 1000 BRL
          { id: 's1', symbol: 'BOVA11', side: 'sell', qty: 10, price: 150 }, // 1500 BRL
        ],
        SYMBOLS,
        RATE,
      );

      // 500 BRL of gain is 100 USD at 0.2. Adding the BRL figure unconverted
      // would overstate realized P/L five-fold.
      expect(out.totalUsd).toBeCloseTo(100);
      // ...while the per-trade figure stays in the symbol's own currency.
      expect(out.nativeByTradeId['s1']).toBeCloseTo(500);
    });

    test('a bond gain is NOT converted: its trades are already USD', () => {
      const out = computeRealizedFromSales(
        [
          { id: 'b1', symbol: 'BOVB11', side: 'buy', qty: 10, price: 0.5 }, // $5
          { id: 's1', symbol: 'BOVB11', side: 'sell', qty: 10, price: 0.7 }, // $7
        ],
        SYMBOLS,
        RATE,
      );

      expect(out.totalUsd).toBeCloseTo(2);
      expect(out.nativeByTradeId['s1']).toBeCloseTo(2);
    });

    test('a missing rate falls back to 1:1 rather than dropping the gain', () => {
      const out = computeRealizedFromSales(
        [
          { id: 'b1', symbol: 'BOVA11', side: 'buy', qty: 10, price: 100 },
          { id: 's1', symbol: 'BOVA11', side: 'sell', qty: 10, price: 150 },
        ],
        SYMBOLS,
        0,
      );

      // Same fallback `computeValuation` uses: a BRLUSD missing from the price
      // cache must not make a BRL gain disappear.
      expect(out.totalUsd).toBeCloseTo(500);
    });

    test('USD and BRL gains add into one USD total', () => {
      const out = computeRealizedFromSales(
        [
          { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
          { id: 's1', symbol: 'BTC', side: 'sell', qty: 1, price: 150 }, // +50 USD
          { id: 'b2', symbol: 'BOVA11', side: 'buy', qty: 10, price: 100 },
          { id: 's2', symbol: 'BOVA11', side: 'sell', qty: 10, price: 150 }, // +500 BRL = +100 USD
        ],
        SYMBOLS,
        RATE,
      );

      expect(out.totalUsd).toBeCloseTo(150);
    });
  });

  test('a trade with no price falls back to the supplied prices', () => {
    const out = computeRealizedFromSales(
      [
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 1 },
      ],
      SYMBOLS,
      RATE,
      { BTC: 400 },
    );

    expect(out.totalUsd).toBeCloseTo(300);
  });

  test('no trades means no realized P/L', () => {
    expect(computeRealizedFromSales([], SYMBOLS, RATE).totalUsd).toBe(0);
  });

  test('the walk is only correct on time-ordered input, which is why callers must sort', () => {
    // The two orders differ by a real amount, and neither raises: a FIFO walk on
    // unsorted trades is a plausible wrong number, not an error. This is why the
    // callers pass `ORDER BY time ASC` rather than whatever the driver returns.
    const ordered = computeRealizedFromSales(
      [
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
        { id: 'b2', symbol: 'BTC', side: 'buy', qty: 1, price: 200 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 1, price: 300 },
      ],
      SYMBOLS,
      RATE,
    );
    const shuffled = computeRealizedFromSales(
      [
        { id: 'b2', symbol: 'BTC', side: 'buy', qty: 1, price: 200 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 1, price: 300 },
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
      ],
      SYMBOLS,
      RATE,
    );

    expect(ordered.totalUsd).toBeCloseTo(200); // sold the 100 lot
    expect(shuffled.totalUsd).toBeCloseTo(100); // sold the 200 lot
  });

  test('a gain on one symbol is not netted against a loss on another by the FIFO order', () => {
    // Interleaved buys and sells, so the walk has to track lots per symbol
    // rather than one shared queue.
    const out = computeRealizedFromSales(
      [
        { id: 'b1', symbol: 'BTC', side: 'buy', qty: 1, price: 100 },
        { id: 'b2', symbol: 'BOVA11', side: 'buy', qty: 10, price: 100 },
        { id: 's1', symbol: 'BTC', side: 'sell', qty: 1, price: 90 }, // -10 USD
        { id: 's2', symbol: 'BOVA11', side: 'sell', qty: 10, price: 120 }, // +200 BRL = +40 USD
      ],
      SYMBOLS,
      RATE,
    );

    expect(out.totalUsd).toBeCloseTo(30);
  });
});
