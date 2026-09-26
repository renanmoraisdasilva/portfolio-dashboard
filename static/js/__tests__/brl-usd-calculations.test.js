'use strict';

/**
 * Unit tests for BRL/USD mixed-currency portfolio calculations.
 *
 * Covers the logic added to dashboard.js and simulation.js to handle:
 *   - BOVA11, IVVB11  — BRL non-bond: price stored in BRL (Yahoo .SA tickers)
 *   - RENDA2065       — BRL bond: price stored in USD (explicitly converted in priceFetcher)
 *   - BTC, ETH, SPY, etc. — USD assets (no conversion needed)
 *
 * All functions below mirror the production implementations so that tests
 * document the algorithm and act as regression guards.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Inline helpers — mirror lib/format.js
// ─────────────────────────────────────────────────────────────────────────────

function formatMoney(val, currency) {
  if (typeof val !== 'number') val = Number(val) || 0;
  if (currency === 'BRL')
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function parseMoney(str, currency) {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str).trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  if (cleaned === '') return 0;
  if (currency === 'BRL') {
    const normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    return parseFloat(normalized) || 0;
  }
  const normalized = cleaned.replace(/,/g, '');
  return parseFloat(normalized) || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbol configuration - mirrors apps/api/src/config/symbols.ts
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_SYMBOLS = {
  detailed: {
    BTC:       { type: 'crypto' },
    ETH:       { type: 'crypto' },
    SOL:       { type: 'crypto' },
    SPY:       { type: 'stock' },
    GLD:       { type: 'stock' },
    IBIT:      { type: 'stock' },
    BOVA11:    { type: 'stock',  denominatedInBRL: true },
    IVVB11:    { type: 'stock',  denominatedInBRL: true },
    RENDA2065: { type: 'bond',   denominatedInBRL: true },
    BRLUSD:    { type: 'currency' },
  },
};

// BRL helper functions — mirror dashboard.js / simulation.js
function isBRLAsset(s) {
  return !!(KNOWN_SYMBOLS.detailed[s] && KNOWN_SYMBOLS.detailed[s].denominatedInBRL);
}
function isBRLNonBond(s) {
  return isBRLAsset(s) && !(KNOWN_SYMBOLS.detailed[s] && KNOWN_SYMBOLS.detailed[s].type === 'bond');
}
function isBRLBond(s) {
  return isBRLAsset(s) && !!(KNOWN_SYMBOLS.detailed[s] && KNOWN_SYMBOLS.detailed[s].type === 'bond');
}

// ─────────────────────────────────────────────────────────────────────────────
// Core calculation functions — mirror dashboard.js / simulation.js logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Portfolio ticker value in USD.
 * BRL non-bond (BOVA11/IVVB11): price is BRL → multiply by rate.
 * BRL bond (RENDA2065): price is already USD → use directly.
 * USD assets: use price directly.
 */
function computeTotalUSD(positions, prices, brlUsdRate) {
  return Object.keys(positions)
    .filter(s => s !== 'BRLUSD')
    .reduce((sum, s) => {
      const p = prices[s] || 0;
      return sum + (isBRLNonBond(s) ? positions[s] * p * brlUsdRate : positions[s] * p);
    }, 0);
}

/**
 * Cost basis (invested) in USD from lot arrays.
 * BRL non-bond: lot.price is BRL → multiply by rate.
 * Others: lot.price is USD.
 */
function computeInvestedUSD(lots, brlUsdRate) {
  let invested = 0;
  for (const [s, assetLots] of Object.entries(lots)) {
    for (const lot of assetLots) {
      invested += isBRLNonBond(s) ? lot.qty * lot.price * brlUsdRate : lot.qty * lot.price;
    }
  }
  return invested;
}

/**
 * Realized P&L in USD from sell trades.
 * BRL non-bond: t.profit stored in BRL → multiply by rate.
 * Others: t.profit stored in USD.
 */
function computeRealizedUSD(trades, brlUsdRate) {
  return trades
    .filter(t => t.side === 'sell')
    .reduce((sum, t) => {
      const p = t.profit || 0;
      return sum + (isBRLNonBond(t.symbol) ? p * brlUsdRate : p);
    }, 0);
}

/**
 * Cash deduction amounts for a buy trade.
 * BRL non-bond: price in BRL → brlAmount = price×qty, usdAmount = brl×rate.
 * Others (including BRL bond whose price is already in USD): usdAmount = price×qty.
 */
function computeTradeAmounts(symbol, price, qty, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const brlAmount = price * qty;
    const usdAmount = brlAmount * brlUsdRate;
    return { brlAmount, usdAmount };
  }
  const usdAmount = price * qty;
  const brlAmount = usdAmount / brlUsdRate;
  return { brlAmount, usdAmount };
}

/** Convert BRL price (form input) → USD price (stored in DB) for BRL bond. */
function brlToUSD(brlPrice, brlUsdRate) { return brlPrice * brlUsdRate; }

/** Convert USD price (DB) → BRL price (display) for BRL bond / general. */
function usdToBRL(usdPrice, brlUsdRate) { return usdPrice / brlUsdRate; }

/**
 * Per-asset allocation values in USD (for pie chart).
 * Mirrors the allocationValues computation in dashboard.js / simulation.js.
 */
function computeAllocationValuesUSD(symbols, positions, prices, brlUsdRate) {
  return symbols.map(s => {
    const p = prices[s] || 0;
    return isBRLNonBond(s) ? positions[s] * p * brlUsdRate : positions[s] * p;
  });
}

/**
 * BRL display values for a position (positions table).
 * Returns { avgBRL, curBRL, valueBRL, plBRL }.
 */
function computePositionDisplayBRL(symbol, qty, lots, currentPrice, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    // price stored in BRL; all arithmetic in BRL
    const cost = lots.reduce((s, l) => s + l.qty * l.price, 0);
    const cur = currentPrice;
    const value = qty * cur;
    const pl = value - cost;
    return { avgBRL: qty > 0 ? cost / qty : 0, curBRL: cur, valueBRL: value, plBRL: pl };
  }
  if (isBRLBond(symbol)) {
    // price stored in USD; divide by rate to get BRL
    const rate = brlUsdRate;
    const costBRL = lots.reduce((s, l) => s + l.qty * l.price, 0) / rate;
    const curBRL = currentPrice / rate;
    const valueBRL = qty * curBRL;
    const plBRL = valueBRL - costBRL;
    return { avgBRL: qty > 0 ? costBRL / qty : 0, curBRL, valueBRL, plBRL };
  }
  return null; // USD asset — no BRL display
}

/**
 * Qty from total input in a given cash source currency.
 * BRL non-bond: price is BRL; total in USD source → convert before dividing.
 */
function computeQtyFromTotal(symbol, total, source, price, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const totalBRL = source === 'USD' ? total / brlUsdRate : total;
    return totalBRL / price;
  }
  const totalUSD = source === 'USD' ? total : total * brlUsdRate;
  return totalUSD / price;
}

/**
 * Total from qty for display in the selected cash source currency.
 * BRL non-bond: price is BRL → total is first in BRL, then converted if source=USD.
 */
function computeTotalFromQty(symbol, qty, price, source, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const brlTotal = qty * price;
    return source === 'BRL' ? brlTotal : brlTotal * brlUsdRate;
  }
  const usdTotal = qty * price;
  return source === 'USD' ? usdTotal : usdTotal / brlUsdRate;
}

/**
 * Compute available qty from a % of available cash.
 * BRL non-bond: works entirely in BRL.
 */
function computeQtyFromPct(symbol, pct, price, simCashDollars, simCashReais, source, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const availBRL = source === 'USD' ? simCashDollars / brlUsdRate : simCashReais;
    return (availBRL * pct / 100) / price;
  }
  const availUSD = source === 'USD' ? simCashDollars : simCashReais * brlUsdRate;
  return (availUSD * pct / 100) / price;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

// 1 BRL = 0.18 USD  →  1 USD ≈ 5.5556 BRL
const RATE = 0.18;

// Prices as stored in the DB / prices object
const PRICES = {
  BOVA11:     50.00,   // BRL (Yahoo .SA)
  IVVB11:    300.00,   // BRL (Yahoo .SA)
  RENDA2065:   2.00,   // USD (priceFetcher converts BRL→USD before storing)
  BTC:     60000.00,   // USD
  ETH:      3000.00,   // USD
  SPY:       500.00,   // USD
};

// Holdings (current quantities)
const POSITIONS = {
  BOVA11:    100,
  IVVB11:     50,
  RENDA2065: 1000,
  BTC:         0.5,
  ETH:         2,
  SPY:         3,
};

// Lots (purchase cost basis)
const LOTS = {
  BOVA11:    [{ qty: 100,  price:  45.00  }],  // BRL avg cost
  IVVB11:    [{ qty:  50,  price: 280.00  }],  // BRL avg cost
  RENDA2065: [{ qty: 1000, price:   1.90  }],  // USD avg cost
  BTC:       [{ qty:   0.5, price: 55000  }],  // USD avg cost
  ETH:       [{ qty:   2,  price:  2500   }],  // USD avg cost
  SPY:       [{ qty:   3,  price:   480   }],  // USD avg cost
};

// Sell trades (closed positions)
const SELL_TRADES = [
  { symbol: 'BOVA11',    side: 'sell', profit:   500 },  // BRL profit
  { symbol: 'IVVB11',    side: 'sell', profit:  1000 },  // BRL profit
  { symbol: 'BTC',       side: 'sell', profit:  2000 },  // USD profit
  { symbol: 'ETH',       side: 'sell', profit:  -500 },  // USD loss
  { symbol: 'BOVA11',    side: 'buy'  },                 // buy — ignored by realized calc
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatMoney', () => {
  test('BRL: uses dot as thousands separator and comma as decimal', () => {
    const s = formatMoney(1234.56, 'BRL');
    expect(s).toMatch(/R\$/);
    expect(s).toMatch(/1\.234/);
    expect(s).toMatch(/,56/);
  });

  test('USD: uses comma as thousands separator and dot as decimal', () => {
    const s = formatMoney(1234.56, 'USD');
    expect(s).toMatch(/\$/);
    expect(s).toMatch(/1,234/);
    expect(s).toMatch(/\.56/);
  });

  test('BRL zero', () => {
    const s = formatMoney(0, 'BRL');
    expect(s).toMatch(/R\$/);
    expect(s).toMatch(/0/);
  });

  test('USD zero', () => {
    const s = formatMoney(0, 'USD');
    expect(s).toMatch(/\$/);
    expect(s).toMatch(/0/);
  });

  test('coerces non-numeric input to 0', () => {
    const s = formatMoney('abc', 'USD');
    expect(parseMoney(s, 'USD')).toBeCloseTo(0, 6);
  });
});

describe('parseMoney', () => {
  test('BRL: dot-thousands, comma-decimal → number', () => {
    expect(parseMoney('1.234,56', 'BRL')).toBeCloseTo(1234.56, 6);
  });

  test('BRL: no thousands separator', () => {
    expect(parseMoney('50,00', 'BRL')).toBeCloseTo(50.00, 6);
  });

  test('BRL: strips R$ prefix and non-breaking space', () => {
    expect(parseMoney('R$ 300,00', 'BRL')).toBeCloseTo(300.00, 6);
  });

  test('USD: comma-thousands, dot-decimal → number', () => {
    expect(parseMoney('1,234.56', 'USD')).toBeCloseTo(1234.56, 6);
  });

  test('USD: strips $ prefix', () => {
    expect(parseMoney('$50.00', 'USD')).toBeCloseTo(50.00, 6);
  });

  test('USD: no thousands separator', () => {
    expect(parseMoney('60000.00', 'USD')).toBeCloseTo(60000.00, 6);
  });

  test('passthrough for plain numbers', () => {
    expect(parseMoney(1234.56, 'BRL')).toBeCloseTo(1234.56, 6);
    expect(parseMoney(1234.56, 'USD')).toBeCloseTo(1234.56, 6);
  });

  test('empty / null / undefined → 0', () => {
    expect(parseMoney('', 'BRL')).toBe(0);
    expect(parseMoney(null, 'BRL')).toBe(0);
    expect(parseMoney(undefined, 'USD')).toBe(0);
  });

  test('BRL round-trip: formatMoney → parseMoney is lossless', () => {
    expect(parseMoney(formatMoney(1234.56, 'BRL'), 'BRL')).toBeCloseTo(1234.56, 2);
  });

  test('USD round-trip: formatMoney → parseMoney is lossless', () => {
    expect(parseMoney(formatMoney(1234.56, 'USD'), 'USD')).toBeCloseTo(1234.56, 2);
  });

  test('large BRL amount round-trip', () => {
    expect(parseMoney(formatMoney(99999.99, 'BRL'), 'BRL')).toBeCloseTo(99999.99, 2);
  });
});

describe('isBRLAsset / isBRLNonBond / isBRLBond', () => {
  test('BOVA11 is a BRL asset', () => expect(isBRLAsset('BOVA11')).toBe(true));
  test('IVVB11 is a BRL asset', () => expect(isBRLAsset('IVVB11')).toBe(true));
  test('RENDA2065 is a BRL asset', () => expect(isBRLAsset('RENDA2065')).toBe(true));
  test('BTC is NOT a BRL asset', () => expect(isBRLAsset('BTC')).toBe(false));
  test('ETH is NOT a BRL asset', () => expect(isBRLAsset('ETH')).toBe(false));
  test('SPY is NOT a BRL asset', () => expect(isBRLAsset('SPY')).toBe(false));
  test('BRLUSD is NOT a BRL asset', () => expect(isBRLAsset('BRLUSD')).toBe(false));

  test('BOVA11 is BRL non-bond', () => expect(isBRLNonBond('BOVA11')).toBe(true));
  test('IVVB11 is BRL non-bond', () => expect(isBRLNonBond('IVVB11')).toBe(true));
  test('RENDA2065 is NOT BRL non-bond (it is a bond)', () => expect(isBRLNonBond('RENDA2065')).toBe(false));
  test('BTC is NOT BRL non-bond', () => expect(isBRLNonBond('BTC')).toBe(false));

  test('RENDA2065 is BRL bond', () => expect(isBRLBond('RENDA2065')).toBe(true));
  test('BOVA11 is NOT BRL bond', () => expect(isBRLBond('BOVA11')).toBe(false));
  test('IVVB11 is NOT BRL bond', () => expect(isBRLBond('IVVB11')).toBe(false));
  test('BTC is NOT BRL bond', () => expect(isBRLBond('BTC')).toBe(false));
});

describe('brlToUSD / usdToBRL (BRL bond price conversion)', () => {
  // RENDA2065: form shows BRL, DB stores USD.
  // rate = 0.18 → 1 BRL = 0.18 USD → 1 USD = 5.5556 BRL

  test('brlToUSD(11.1111, 0.18) ≈ 2.00', () => {
    expect(brlToUSD(11.1111, RATE)).toBeCloseTo(2.00, 3);
  });

  test('usdToBRL(2.00, 0.18) ≈ 11.1111', () => {
    expect(usdToBRL(2.00, RATE)).toBeCloseTo(11.1111, 3);
  });

  test('round-trip: brlToUSD(usdToBRL(x)) ≈ x', () => {
    const original = 5.55;
    expect(brlToUSD(usdToBRL(original, RATE), RATE)).toBeCloseTo(original, 6);
  });

  test('round-trip: usdToBRL(brlToUSD(x)) ≈ x', () => {
    const original = 11.50;
    expect(usdToBRL(brlToUSD(original, RATE), RATE)).toBeCloseTo(original, 6);
  });
});

describe('computeTotalUSD — portfolio ticker value', () => {
  // Expected:
  //   BOVA11:    100 × R$50    × 0.18 = $900
  //   IVVB11:     50 × R$300   × 0.18 = $2 700
  //   RENDA2065: 1000 × $2           = $2 000  (USD already — no conversion)
  //   BTC:        0.5 × $60 000      = $30 000
  //   ETH:          2 × $3 000       = $6 000
  //   SPY:          3 × $500         = $1 500
  //                                  = $43 100

  test('BOVA11 contributes BRL price × rate to USD total', () => {
    const total = computeTotalUSD({ BOVA11: 100 }, { BOVA11: 50 }, RATE);
    expect(total).toBeCloseTo(900, 6);
  });

  test('IVVB11 contributes BRL price × rate to USD total', () => {
    const total = computeTotalUSD({ IVVB11: 50 }, { IVVB11: 300 }, RATE);
    expect(total).toBeCloseTo(2700, 6);
  });

  test('RENDA2065 (bond stored in USD) contributes price directly', () => {
    const total = computeTotalUSD({ RENDA2065: 1000 }, { RENDA2065: 2 }, RATE);
    expect(total).toBeCloseTo(2000, 6);
  });

  test('BTC contributes price directly in USD', () => {
    const total = computeTotalUSD({ BTC: 0.5 }, { BTC: 60000 }, RATE);
    expect(total).toBeCloseTo(30000, 6);
  });

  test('full mixed-asset portfolio total', () => {
    const total = computeTotalUSD(POSITIONS, PRICES, RATE);
    // 900 + 2700 + 2000 + 30000 + 6000 + 1500 = 43100
    expect(total).toBeCloseTo(43100, 4);
  });

  test('BRL non-bond would be ~5.56× too large if rate is not applied', () => {
    // Demonstrates the original bug: treating BRL price as USD inflated the total
    const correct = computeTotalUSD({ BOVA11: 100 }, { BOVA11: 50 }, RATE);
    const inflated = 100 * 50; // wrong: price treated as USD
    expect(inflated / correct).toBeCloseTo(1 / RATE, 2); // ~5.56× too large
  });

  test('BRLUSD key is excluded from ticker value', () => {
    const total = computeTotalUSD({ BOVA11: 100, BRLUSD: 1 }, { BOVA11: 50, BRLUSD: 0.18 }, RATE);
    expect(total).toBeCloseTo(900, 6); // BRLUSD position not counted
  });
});

describe('computeInvestedUSD — cost basis', () => {
  // Expected:
  //   BOVA11:    100 × R$45    × 0.18 = $810
  //   IVVB11:     50 × R$280   × 0.18 = $2 520
  //   RENDA2065: 1000 × $1.90         = $1 900
  //   BTC:        0.5 × $55 000       = $27 500
  //   ETH:          2 × $2 500        = $5 000
  //   SPY:          3 × $480          = $1 440
  //                                   = $39 170

  test('BOVA11 cost basis uses BRL lot price × rate', () => {
    const cost = computeInvestedUSD({ BOVA11: [{ qty: 100, price: 45 }] }, RATE);
    expect(cost).toBeCloseTo(810, 6);
  });

  test('IVVB11 cost basis uses BRL lot price × rate', () => {
    const cost = computeInvestedUSD({ IVVB11: [{ qty: 50, price: 280 }] }, RATE);
    expect(cost).toBeCloseTo(2520, 6);
  });

  test('RENDA2065 cost basis uses USD lot price directly', () => {
    const cost = computeInvestedUSD({ RENDA2065: [{ qty: 1000, price: 1.90 }] }, RATE);
    expect(cost).toBeCloseTo(1900, 6);
  });

  test('BTC cost basis uses USD lot price directly', () => {
    const cost = computeInvestedUSD({ BTC: [{ qty: 0.5, price: 55000 }] }, RATE);
    expect(cost).toBeCloseTo(27500, 6);
  });

  test('full portfolio cost basis', () => {
    const cost = computeInvestedUSD(LOTS, RATE);
    expect(cost).toBeCloseTo(39170, 4);
  });

  test('multiple lots per asset are summed correctly', () => {
    const lots = {
      BOVA11: [
        { qty: 60, price: 40 }, // BRL
        { qty: 40, price: 52 }, // BRL
      ],
    };
    // 60×40 + 40×52 = 2400+2080 = 4480 BRL × 0.18 = $806.40
    const cost = computeInvestedUSD(lots, RATE);
    expect(cost).toBeCloseTo(806.40, 4);
  });
});

describe('computeRealizedUSD — realized P&L', () => {
  // Expected:
  //   BOVA11 profit 500 BRL × 0.18 = $90
  //   IVVB11 profit 1000 BRL × 0.18 = $180
  //   BTC profit $2000             = $2 000
  //   ETH loss  -$500              = -$500
  //   Buy trades are ignored
  //                                = $1 770

  test('BRL non-bond profit is converted to USD', () => {
    const realized = computeRealizedUSD(
      [{ symbol: 'BOVA11', side: 'sell', profit: 500 }], RATE
    );
    expect(realized).toBeCloseTo(90, 6);
  });

  test('BRL non-bond loss is converted to USD', () => {
    const realized = computeRealizedUSD(
      [{ symbol: 'IVVB11', side: 'sell', profit: -200 }], RATE
    );
    expect(realized).toBeCloseTo(-36, 6);
  });

  test('USD asset profit is used directly', () => {
    const realized = computeRealizedUSD(
      [{ symbol: 'BTC', side: 'sell', profit: 2000 }], RATE
    );
    expect(realized).toBeCloseTo(2000, 6);
  });

  test('USD asset loss is used directly', () => {
    const realized = computeRealizedUSD(
      [{ symbol: 'ETH', side: 'sell', profit: -500 }], RATE
    );
    expect(realized).toBeCloseTo(-500, 6);
  });

  test('buy-side trades are excluded', () => {
    const realized = computeRealizedUSD(
      [{ symbol: 'BOVA11', side: 'buy', profit: 9999 }], RATE
    );
    expect(realized).toBeCloseTo(0, 6);
  });

  test('RENDA2065 (bond stored USD) profit is used directly', () => {
    const realized = computeRealizedUSD(
      [{ symbol: 'RENDA2065', side: 'sell', profit: 100 }], RATE
    );
    expect(realized).toBeCloseTo(100, 6);
  });

  test('full mixed realized P&L', () => {
    const realized = computeRealizedUSD(SELL_TRADES, RATE);
    // 90 + 180 + 2000 - 500 = 1770
    expect(realized).toBeCloseTo(1770, 4);
  });

  test('BRL non-bond profit NOT converted would be ~5.56× wrong', () => {
    const correct = computeRealizedUSD(
      [{ symbol: 'BOVA11', side: 'sell', profit: 500 }], RATE
    );
    const wrong = 500; // treating BRL profit as USD
    expect(wrong / correct).toBeCloseTo(1 / RATE, 2);
  });
});

describe('computeTradeAmounts — add trade cash deduction', () => {
  // Buying 100 BOVA11 @ R$50:
  //   brlAmount = 100 × 50 = R$5 000
  //   usdAmount = 5000 × 0.18 = $900

  test('BRL non-bond buy: computes correct brlAmount and usdAmount', () => {
    const { brlAmount, usdAmount } = computeTradeAmounts('BOVA11', 50, 100, RATE);
    expect(brlAmount).toBeCloseTo(5000, 4);
    expect(usdAmount).toBeCloseTo(900, 4);
  });

  test('BRL non-bond buy: small lot', () => {
    const { brlAmount, usdAmount } = computeTradeAmounts('IVVB11', 300, 10, RATE);
    expect(brlAmount).toBeCloseTo(3000, 4);
    expect(usdAmount).toBeCloseTo(540, 4);
  });

  // BRL bond: form shows BRL but price was already converted to USD before calling this fn
  test('BRL bond buy: price is USD, deducts USD directly', () => {
    const { brlAmount, usdAmount } = computeTradeAmounts('RENDA2065', 2, 1000, RATE);
    expect(usdAmount).toBeCloseTo(2000, 4);
    expect(brlAmount).toBeCloseTo(2000 / RATE, 4);
  });

  test('BTC buy: standard USD deduction', () => {
    const { brlAmount, usdAmount } = computeTradeAmounts('BTC', 60000, 0.5, RATE);
    expect(usdAmount).toBeCloseTo(30000, 4);
    expect(brlAmount).toBeCloseTo(30000 / RATE, 4);
  });
});

describe('computePositionDisplayBRL — BRL values for positions table', () => {
  test('BOVA11: avg, current, value, P&L all in BRL', () => {
    const disp = computePositionDisplayBRL(
      'BOVA11', 100, [{ qty: 100, price: 45 }], 50, RATE
    );
    expect(disp.avgBRL).toBeCloseTo(45.00, 4);    // R$45 avg cost
    expect(disp.curBRL).toBeCloseTo(50.00, 4);    // R$50 current
    expect(disp.valueBRL).toBeCloseTo(5000.00, 4); // 100 × R$50
    expect(disp.plBRL).toBeCloseTo(500.00, 4);    // R$5000 - R$4500
  });

  test('IVVB11: avg, current, value, P&L all in BRL', () => {
    const disp = computePositionDisplayBRL(
      'IVVB11', 50, [{ qty: 50, price: 280 }], 300, RATE
    );
    expect(disp.avgBRL).toBeCloseTo(280.00, 4);
    expect(disp.curBRL).toBeCloseTo(300.00, 4);
    expect(disp.valueBRL).toBeCloseTo(15000.00, 4);
    expect(disp.plBRL).toBeCloseTo(1000.00, 4);
  });

  test('BOVA11 multiple lots: avg is weighted average', () => {
    const disp = computePositionDisplayBRL(
      'BOVA11', 150,
      [{ qty: 100, price: 40 }, { qty: 50, price: 55 }],
      50, RATE
    );
    // avg = (100×40 + 50×55) / 150 = (4000+2750)/150 = 6750/150 = 45
    expect(disp.avgBRL).toBeCloseTo(45.00, 4);
    expect(disp.valueBRL).toBeCloseTo(7500, 4); // 150 × 50
    expect(disp.plBRL).toBeCloseTo(750, 4);     // 7500 - 6750
  });

  test('RENDA2065 (bond): displays as BRL, divides USD price by rate', () => {
    // DB price $2.00; lot cost $1.90/unit
    // curBRL = 2.00 / 0.18 ≈ 11.1111
    // avgBRL = 1.90 / 0.18 ≈ 10.5556
    // valueBRL = 1000 × curBRL ≈ 11111.11
    // plBRL = 11111.11 - (1000 × 10.5556) ≈ 555.56
    const disp = computePositionDisplayBRL(
      'RENDA2065', 1000, [{ qty: 1000, price: 1.90 }], 2.00, RATE
    );
    expect(disp.curBRL).toBeCloseTo(11.1111, 3);
    expect(disp.avgBRL).toBeCloseTo(10.5556, 3);
    expect(disp.valueBRL).toBeCloseTo(11111.11, 1);
    expect(disp.plBRL).toBeCloseTo(555.56, 1);
  });

  test('USD asset returns null (no BRL display)', () => {
    const disp = computePositionDisplayBRL('BTC', 0.5, [{ qty: 0.5, price: 55000 }], 60000, RATE);
    expect(disp).toBeNull();
  });
});

describe('computeAllocationValuesUSD — pie-chart allocation', () => {
  const syms = ['BOVA11', 'IVVB11', 'RENDA2065', 'BTC', 'ETH', 'SPY'];

  test('each BRL non-bond value is price×qty×rate', () => {
    const vals = computeAllocationValuesUSD(syms, POSITIONS, PRICES, RATE);
    const idx = syms.indexOf('BOVA11');
    expect(vals[idx]).toBeCloseTo(100 * 50 * RATE, 4); // $900
  });

  test('each BRL bond value is price×qty (USD already)', () => {
    const vals = computeAllocationValuesUSD(syms, POSITIONS, PRICES, RATE);
    const idx = syms.indexOf('RENDA2065');
    expect(vals[idx]).toBeCloseTo(1000 * 2, 4); // $2000
  });

  test('each USD asset value is price×qty', () => {
    const vals = computeAllocationValuesUSD(syms, POSITIONS, PRICES, RATE);
    const idx = syms.indexOf('BTC');
    expect(vals[idx]).toBeCloseTo(0.5 * 60000, 4); // $30000
  });

  test('sum of all allocations equals portfolio total', () => {
    const vals = computeAllocationValuesUSD(syms, POSITIONS, PRICES, RATE);
    const sum = vals.reduce((a, b) => a + b, 0);
    const expected = computeTotalUSD(POSITIONS, PRICES, RATE);
    expect(sum).toBeCloseTo(expected, 4);
  });
});

describe('computeQtyFromTotal — add-trade form: qty from total', () => {
  test('BRL non-bond, source=BRL: total in BRL ÷ BRL price', () => {
    // R$5000 / R$50 = 100 units
    const qty = computeQtyFromTotal('BOVA11', 5000, 'BRL', 50, RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('BRL non-bond, source=USD: total in USD → convert to BRL first', () => {
    // $900 / rate = R$5000 BRL; R$5000 / R$50 = 100 units
    const qty = computeQtyFromTotal('BOVA11', 900, 'USD', 50, RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('USD asset, source=USD: total in USD ÷ USD price', () => {
    const qty = computeQtyFromTotal('BTC', 30000, 'USD', 60000, RATE);
    expect(qty).toBeCloseTo(0.5, 4);
  });

  test('USD asset, source=BRL: total in BRL → convert to USD', () => {
    // R$5000 × 0.18 = $900; $900 / $500 = 1.8 units of SPY
    const qty = computeQtyFromTotal('SPY', 5000, 'BRL', 500, RATE);
    expect(qty).toBeCloseTo(1.8, 4);
  });

  test('RENDA2065 (bond, USD stored), source=USD', () => {
    // $2000 / $2 = 1000 units
    const qty = computeQtyFromTotal('RENDA2065', 2000, 'USD', 2, RATE);
    expect(qty).toBeCloseTo(1000, 4);
  });
});

describe('computeTotalFromQty — add-trade form: total from qty', () => {
  test('BRL non-bond, source=BRL: qty × BRL price → BRL total', () => {
    // 100 × R$50 = R$5000
    const total = computeTotalFromQty('BOVA11', 100, 50, 'BRL', RATE);
    expect(total).toBeCloseTo(5000, 4);
  });

  test('BRL non-bond, source=USD: qty × BRL price → USD total', () => {
    // 100 × R$50 = R$5000 × 0.18 = $900
    const total = computeTotalFromQty('BOVA11', 100, 50, 'USD', RATE);
    expect(total).toBeCloseTo(900, 4);
  });

  test('USD asset, source=USD: qty × USD price → USD total', () => {
    const total = computeTotalFromQty('BTC', 0.5, 60000, 'USD', RATE);
    expect(total).toBeCloseTo(30000, 4);
  });

  test('USD asset, source=BRL: qty × USD price ÷ rate → BRL total', () => {
    const total = computeTotalFromQty('SPY', 3, 500, 'BRL', RATE);
    expect(total).toBeCloseTo(1500 / RATE, 4);
  });

  test('BRL non-bond: source-BRL and source-USD totals are consistent', () => {
    const brlTotal = computeTotalFromQty('IVVB11', 10, 300, 'BRL', RATE);
    const usdTotal = computeTotalFromQty('IVVB11', 10, 300, 'USD', RATE);
    expect(usdTotal).toBeCloseTo(brlTotal * RATE, 4);
  });
});

describe('computeQtyFromPct — add-trade form: qty from % of available cash', () => {
  const cashUSD = 1800;
  const cashBRL = 10000;

  test('BRL non-bond, source=BRL: 50% of BRL cash / price', () => {
    // 50% of R$10000 = R$5000; R$5000 / R$50 = 100 units
    const qty = computeQtyFromPct('BOVA11', 50, 50, cashUSD, cashBRL, 'BRL', RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('BRL non-bond, source=USD: 50% of USD cash converted to BRL / price', () => {
    // $1800 / 0.18 = R$10000; 50% = R$5000; R$5000 / R$50 = 100 units
    const qty = computeQtyFromPct('BOVA11', 50, 50, cashUSD, cashBRL, 'USD', RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('BRL non-bond, source=BRL, 100% of cash', () => {
    // R$10000 / R$300 ≈ 33.33 units of IVVB11
    const qty = computeQtyFromPct('IVVB11', 100, 300, cashUSD, cashBRL, 'BRL', RATE);
    expect(qty).toBeCloseTo(33.3333, 3);
  });

  test('USD asset, source=USD: 25% of USD cash / USD price', () => {
    // 25% of $1800 = $450; $450 / $60000 = 0.0075 BTC
    const qty = computeQtyFromPct('BTC', 25, 60000, cashUSD, cashBRL, 'USD', RATE);
    expect(qty).toBeCloseTo(0.0075, 6);
  });

  test('USD asset, source=BRL: BRL cash converted to USD', () => {
    // R$10000 × 0.18 = $1800; 50% = $900; $900 / $500 = 1.8 SPY
    const qty = computeQtyFromPct('SPY', 50, 500, cashUSD, cashBRL, 'BRL', RATE);
    expect(qty).toBeCloseTo(1.8, 4);
  });
});

describe('portfolio sums: consistency across BRL and USD', () => {
  test('unrealized P&L = total value - invested', () => {
    const total = computeTotalUSD(POSITIONS, PRICES, RATE);
    const invested = computeInvestedUSD(LOTS, RATE);
    const unrealized = total - invested;
    // 43100 - 39170 = 3930
    expect(unrealized).toBeCloseTo(3930, 2);
  });

  test('allocation sum equals portfolio total', () => {
    const syms = Object.keys(POSITIONS);
    const vals = computeAllocationValuesUSD(syms, POSITIONS, PRICES, RATE);
    const sum = vals.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(computeTotalUSD(POSITIONS, PRICES, RATE), 4);
  });

  test('changing brlUsdRate changes BRL-asset totals proportionally', () => {
    const rate1 = 0.18;
    const rate2 = 0.20; // BRL strengthened vs USD
    const total1 = computeTotalUSD({ BOVA11: 100 }, { BOVA11: 50 }, rate1); // $900
    const total2 = computeTotalUSD({ BOVA11: 100 }, { BOVA11: 50 }, rate2); // $1000
    expect(total2 / total1).toBeCloseTo(rate2 / rate1, 6);
  });

  test('changing brlUsdRate does NOT affect USD-asset totals', () => {
    const rate1 = 0.18;
    const rate2 = 0.20;
    const total1 = computeTotalUSD({ BTC: 0.5 }, { BTC: 60000 }, rate1);
    const total2 = computeTotalUSD({ BTC: 0.5 }, { BTC: 60000 }, rate2);
    expect(total1).toBeCloseTo(total2, 6);
  });

  test('BRL bond position total is rate-independent (stored in USD)', () => {
    const total1 = computeTotalUSD({ RENDA2065: 1000 }, { RENDA2065: 2 }, 0.18);
    const total2 = computeTotalUSD({ RENDA2065: 1000 }, { RENDA2065: 2 }, 0.20);
    expect(total1).toBeCloseTo(total2, 6);
  });

  test('qty-from-total and total-from-qty are inverse operations (BRL non-bond)', () => {
    const price = 50;  // BRL
    const origQty = 100;
    const total = computeTotalFromQty('BOVA11', origQty, price, 'BRL', RATE);
    const recoveredQty = computeQtyFromTotal('BOVA11', total, 'BRL', price, RATE);
    expect(recoveredQty).toBeCloseTo(origQty, 6);
  });

  test('qty-from-total and total-from-qty are inverse operations (USD asset)', () => {
    const price = 60000; // USD
    const origQty = 0.5;
    const total = computeTotalFromQty('BTC', origQty, price, 'USD', RATE);
    const recoveredQty = computeQtyFromTotal('BTC', total, 'USD', price, RATE);
    expect(recoveredQty).toBeCloseTo(origQty, 6);
  });
});
