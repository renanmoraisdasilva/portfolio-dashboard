// ESM, not CommonJS: under Vitest 5 a require() of a workspace package is
// externalised, so this suite still passed while its coverage landed on
// packages/shared/dist instead of the source and money.ts read as untested.
import { formatMoney, parseMoney, brlToUSD, usdToBRL, createSymbolClassifier } from '@portfolio-dashboard/shared';

const KNOWN_SYMBOLS = {
  detailed: {
    BTC: { type: 'crypto' },
    ETH: { type: 'crypto' },
    SOL: { type: 'crypto' },
    SPY: { type: 'stock' },
    GLD: { type: 'stock' },
    IBIT: { type: 'stock' },
    BOVA11: { type: 'stock', denominatedInBRL: true },
    IVVB11: { type: 'stock', denominatedInBRL: true },
    RENDA2065: { type: 'bond', denominatedInBRL: true },
    BRLUSD: { type: 'currency' },
  },
};

const { isBRLAsset, isBRLNonBond, isBRLBond } = createSymbolClassifier(KNOWN_SYMBOLS.detailed);

function computeTotalUSD(positions, prices, brlUsdRate) {
  return Object.keys(positions)
    .filter((s) => s !== 'BRLUSD')
    .reduce((sum, s) => {
      const p = prices[s] || 0;
      return sum + (isBRLNonBond(s) ? positions[s] * p * brlUsdRate : positions[s] * p);
    }, 0);
}

function computeInvestedUSD(lots, brlUsdRate) {
  let invested = 0;
  for (const [s, assetLots] of Object.entries(lots)) {
    for (const lot of assetLots) {
      invested += isBRLNonBond(s) ? lot.qty * lot.price * brlUsdRate : lot.qty * lot.price;
    }
  }
  return invested;
}

function computeRealizedUSD(trades, brlUsdRate) {
  return trades
    .filter((t) => t.side === 'sell')
    .reduce((sum, t) => {
      const p = t.profit || 0;
      return sum + (isBRLNonBond(t.symbol) ? p * brlUsdRate : p);
    }, 0);
}

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

function computeAllocationValuesUSD(symbols, positions, prices, brlUsdRate) {
  return symbols.map((s) => {
    const p = prices[s] || 0;
    return isBRLNonBond(s) ? positions[s] * p * brlUsdRate : positions[s] * p;
  });
}

function computePositionDisplayBRL(symbol, qty, lots, currentPrice, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const cost = lots.reduce((s, l) => s + l.qty * l.price, 0);
    const cur = currentPrice;
    const value = qty * cur;
    const pl = value - cost;
    return { avgBRL: qty > 0 ? cost / qty : 0, curBRL: cur, valueBRL: value, plBRL: pl };
  }
  if (isBRLBond(symbol)) {
    const rate = brlUsdRate;
    const costBRL = lots.reduce((s, l) => s + l.qty * l.price, 0) / rate;
    const curBRL = currentPrice / rate;
    const valueBRL = qty * curBRL;
    const plBRL = valueBRL - costBRL;
    return { avgBRL: qty > 0 ? costBRL / qty : 0, curBRL, valueBRL, plBRL };
  }
  return null;
}

function computeQtyFromTotal(symbol, total, source, price, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const totalBRL = source === 'USD' ? total / brlUsdRate : total;
    return totalBRL / price;
  }
  const totalUSD = source === 'USD' ? total : total * brlUsdRate;
  return totalUSD / price;
}

function computeTotalFromQty(symbol, qty, price, source, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const brlTotal = qty * price;
    return source === 'BRL' ? brlTotal : brlTotal * brlUsdRate;
  }
  const usdTotal = qty * price;
  return source === 'USD' ? usdTotal : usdTotal / brlUsdRate;
}

function computeQtyFromPct(symbol, pct, price, simCashDollars, simCashReais, source, brlUsdRate) {
  if (isBRLNonBond(symbol)) {
    const availBRL = source === 'USD' ? simCashDollars / brlUsdRate : simCashReais;
    return (availBRL * pct) / 100 / price;
  }
  const availUSD = source === 'USD' ? simCashDollars : simCashReais * brlUsdRate;
  return (availUSD * pct) / 100 / price;
}

const RATE = 0.18;

const PRICES = {
  BOVA11: 50.0, // BRL (Yahoo .SA)
  IVVB11: 300.0, // BRL (Yahoo .SA)
  RENDA2065: 2.0, // USD (priceFetcher converts BRL→USD before storing)
  BTC: 60000.0, // USD
  ETH: 3000.0, // USD
  SPY: 500.0, // USD
};

const POSITIONS = {
  BOVA11: 100,
  IVVB11: 50,
  RENDA2065: 1000,
  BTC: 0.5,
  ETH: 2,
  SPY: 3,
};

const LOTS = {
  BOVA11: [{ qty: 100, price: 45.0 }], // BRL avg cost
  IVVB11: [{ qty: 50, price: 280.0 }], // BRL avg cost
  RENDA2065: [{ qty: 1000, price: 1.9 }], // USD avg cost
  BTC: [{ qty: 0.5, price: 55000 }], // USD avg cost
  ETH: [{ qty: 2, price: 2500 }], // USD avg cost
  SPY: [{ qty: 3, price: 480 }], // USD avg cost
};

const SELL_TRADES = [
  { symbol: 'BOVA11', side: 'sell', profit: 500 }, // BRL profit
  { symbol: 'IVVB11', side: 'sell', profit: 1000 }, // BRL profit
  { symbol: 'BTC', side: 'sell', profit: 2000 }, // USD profit
  { symbol: 'ETH', side: 'sell', profit: -500 }, // USD loss
  { symbol: 'BOVA11', side: 'buy' }, // buy — ignored by realized calc
];

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
    expect(parseMoney('50,00', 'BRL')).toBeCloseTo(50.0, 6);
  });

  test('BRL: strips R$ prefix and non-breaking space', () => {
    expect(parseMoney('R$ 300,00', 'BRL')).toBeCloseTo(300.0, 6);
  });

  test('USD: comma-thousands, dot-decimal → number', () => {
    expect(parseMoney('1,234.56', 'USD')).toBeCloseTo(1234.56, 6);
  });

  test('USD: strips $ prefix', () => {
    expect(parseMoney('$50.00', 'USD')).toBeCloseTo(50.0, 6);
  });

  test('USD: no thousands separator', () => {
    expect(parseMoney('60000.00', 'USD')).toBeCloseTo(60000.0, 6);
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

  test('whitespace-only string → 0', () => {
    expect(parseMoney('   ', 'BRL')).toBe(0);
    expect(parseMoney('   ', 'USD')).toBe(0);
  });

  test('BRL: separator-only input falls back to 0', () => {
    expect(parseMoney(',', 'BRL')).toBe(0);
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

  test('brlToUSD(11.1111, 0.18) ≈ 2.00', () => {
    expect(brlToUSD(11.1111, RATE)).toBeCloseTo(2.0, 3);
  });

  test('usdToBRL(2.00, 0.18) ≈ 11.1111', () => {
    expect(usdToBRL(2.0, RATE)).toBeCloseTo(11.1111, 3);
  });

  test('round-trip: brlToUSD(usdToBRL(x)) ≈ x', () => {
    const original = 5.55;
    expect(brlToUSD(usdToBRL(original, RATE), RATE)).toBeCloseTo(original, 6);
  });

  test('round-trip: usdToBRL(brlToUSD(x)) ≈ x', () => {
    const original = 11.5;
    expect(usdToBRL(brlToUSD(original, RATE), RATE)).toBeCloseTo(original, 6);
  });
});

describe('computeTotalUSD — portfolio ticker value', () => {
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
    expect(total).toBeCloseTo(43100, 4);
  });

  test('BRL non-bond would be ~5.56× too large if rate is not applied', () => {
    // Demonstrates the original bug: treating BRL price as USD inflated the total
    const correct = computeTotalUSD({ BOVA11: 100 }, { BOVA11: 50 }, RATE);
    const inflated = 100 * 50;
    expect(inflated / correct).toBeCloseTo(1 / RATE, 2);
  });

  test('BRLUSD key is excluded from ticker value', () => {
    const total = computeTotalUSD({ BOVA11: 100, BRLUSD: 1 }, { BOVA11: 50, BRLUSD: 0.18 }, RATE);
    expect(total).toBeCloseTo(900, 6);
  });
});

describe('computeInvestedUSD — cost basis', () => {
  test('BOVA11 cost basis uses BRL lot price × rate', () => {
    const cost = computeInvestedUSD({ BOVA11: [{ qty: 100, price: 45 }] }, RATE);
    expect(cost).toBeCloseTo(810, 6);
  });

  test('IVVB11 cost basis uses BRL lot price × rate', () => {
    const cost = computeInvestedUSD({ IVVB11: [{ qty: 50, price: 280 }] }, RATE);
    expect(cost).toBeCloseTo(2520, 6);
  });

  test('RENDA2065 cost basis uses USD lot price directly', () => {
    const cost = computeInvestedUSD({ RENDA2065: [{ qty: 1000, price: 1.9 }] }, RATE);
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
    const cost = computeInvestedUSD(lots, RATE);
    expect(cost).toBeCloseTo(806.4, 4);
  });
});

describe('computeRealizedUSD — realized P&L', () => {
  test('BRL non-bond profit is converted to USD', () => {
    const realized = computeRealizedUSD([{ symbol: 'BOVA11', side: 'sell', profit: 500 }], RATE);
    expect(realized).toBeCloseTo(90, 6);
  });

  test('BRL non-bond loss is converted to USD', () => {
    const realized = computeRealizedUSD([{ symbol: 'IVVB11', side: 'sell', profit: -200 }], RATE);
    expect(realized).toBeCloseTo(-36, 6);
  });

  test('USD asset profit is used directly', () => {
    const realized = computeRealizedUSD([{ symbol: 'BTC', side: 'sell', profit: 2000 }], RATE);
    expect(realized).toBeCloseTo(2000, 6);
  });

  test('USD asset loss is used directly', () => {
    const realized = computeRealizedUSD([{ symbol: 'ETH', side: 'sell', profit: -500 }], RATE);
    expect(realized).toBeCloseTo(-500, 6);
  });

  test('buy-side trades are excluded', () => {
    const realized = computeRealizedUSD([{ symbol: 'BOVA11', side: 'buy', profit: 9999 }], RATE);
    expect(realized).toBeCloseTo(0, 6);
  });

  test('RENDA2065 (bond stored USD) profit is used directly', () => {
    const realized = computeRealizedUSD([{ symbol: 'RENDA2065', side: 'sell', profit: 100 }], RATE);
    expect(realized).toBeCloseTo(100, 6);
  });

  test('full mixed realized P&L', () => {
    const realized = computeRealizedUSD(SELL_TRADES, RATE);
    expect(realized).toBeCloseTo(1770, 4);
  });

  test('BRL non-bond profit NOT converted would be ~5.56× wrong', () => {
    const correct = computeRealizedUSD([{ symbol: 'BOVA11', side: 'sell', profit: 500 }], RATE);
    const wrong = 500;
    expect(wrong / correct).toBeCloseTo(1 / RATE, 2);
  });
});

describe('computeTradeAmounts — add trade cash deduction', () => {
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
    const disp = computePositionDisplayBRL('BOVA11', 100, [{ qty: 100, price: 45 }], 50, RATE);
    expect(disp.avgBRL).toBeCloseTo(45.0, 4);
    expect(disp.curBRL).toBeCloseTo(50.0, 4);
    expect(disp.valueBRL).toBeCloseTo(5000.0, 4);
    expect(disp.plBRL).toBeCloseTo(500.0, 4);
  });

  test('IVVB11: avg, current, value, P&L all in BRL', () => {
    const disp = computePositionDisplayBRL('IVVB11', 50, [{ qty: 50, price: 280 }], 300, RATE);
    expect(disp.avgBRL).toBeCloseTo(280.0, 4);
    expect(disp.curBRL).toBeCloseTo(300.0, 4);
    expect(disp.valueBRL).toBeCloseTo(15000.0, 4);
    expect(disp.plBRL).toBeCloseTo(1000.0, 4);
  });

  test('BOVA11 multiple lots: avg is weighted average', () => {
    const disp = computePositionDisplayBRL(
      'BOVA11',
      150,
      [
        { qty: 100, price: 40 },
        { qty: 50, price: 55 },
      ],
      50,
      RATE,
    );
    expect(disp.avgBRL).toBeCloseTo(45.0, 4);
    expect(disp.valueBRL).toBeCloseTo(7500, 4);
    expect(disp.plBRL).toBeCloseTo(750, 4);
  });

  test('RENDA2065 (bond): displays as BRL, divides USD price by rate', () => {
    const disp = computePositionDisplayBRL('RENDA2065', 1000, [{ qty: 1000, price: 1.9 }], 2.0, RATE);
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
    expect(vals[idx]).toBeCloseTo(100 * 50 * RATE, 4);
  });

  test('each BRL bond value is price×qty (USD already)', () => {
    const vals = computeAllocationValuesUSD(syms, POSITIONS, PRICES, RATE);
    const idx = syms.indexOf('RENDA2065');
    expect(vals[idx]).toBeCloseTo(1000 * 2, 4);
  });

  test('each USD asset value is price×qty', () => {
    const vals = computeAllocationValuesUSD(syms, POSITIONS, PRICES, RATE);
    const idx = syms.indexOf('BTC');
    expect(vals[idx]).toBeCloseTo(0.5 * 60000, 4);
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
    const qty = computeQtyFromTotal('BOVA11', 5000, 'BRL', 50, RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('BRL non-bond, source=USD: total in USD → convert to BRL first', () => {
    const qty = computeQtyFromTotal('BOVA11', 900, 'USD', 50, RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('USD asset, source=USD: total in USD ÷ USD price', () => {
    const qty = computeQtyFromTotal('BTC', 30000, 'USD', 60000, RATE);
    expect(qty).toBeCloseTo(0.5, 4);
  });

  test('USD asset, source=BRL: total in BRL → convert to USD', () => {
    const qty = computeQtyFromTotal('SPY', 5000, 'BRL', 500, RATE);
    expect(qty).toBeCloseTo(1.8, 4);
  });

  test('RENDA2065 (bond, USD stored), source=USD', () => {
    const qty = computeQtyFromTotal('RENDA2065', 2000, 'USD', 2, RATE);
    expect(qty).toBeCloseTo(1000, 4);
  });
});

describe('computeTotalFromQty — add-trade form: total from qty', () => {
  test('BRL non-bond, source=BRL: qty × BRL price → BRL total', () => {
    const total = computeTotalFromQty('BOVA11', 100, 50, 'BRL', RATE);
    expect(total).toBeCloseTo(5000, 4);
  });

  test('BRL non-bond, source=USD: qty × BRL price → USD total', () => {
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
    const qty = computeQtyFromPct('BOVA11', 50, 50, cashUSD, cashBRL, 'BRL', RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('BRL non-bond, source=USD: 50% of USD cash converted to BRL / price', () => {
    const qty = computeQtyFromPct('BOVA11', 50, 50, cashUSD, cashBRL, 'USD', RATE);
    expect(qty).toBeCloseTo(100, 4);
  });

  test('BRL non-bond, source=BRL, 100% of cash', () => {
    const qty = computeQtyFromPct('IVVB11', 100, 300, cashUSD, cashBRL, 'BRL', RATE);
    expect(qty).toBeCloseTo(33.3333, 3);
  });

  test('USD asset, source=USD: 25% of USD cash / USD price', () => {
    const qty = computeQtyFromPct('BTC', 25, 60000, cashUSD, cashBRL, 'USD', RATE);
    expect(qty).toBeCloseTo(0.0075, 6);
  });

  test('USD asset, source=BRL: BRL cash converted to USD', () => {
    const qty = computeQtyFromPct('SPY', 50, 500, cashUSD, cashBRL, 'BRL', RATE);
    expect(qty).toBeCloseTo(1.8, 4);
  });
});

describe('portfolio sums: consistency across BRL and USD', () => {
  test('unrealized P&L = total value - invested', () => {
    const total = computeTotalUSD(POSITIONS, PRICES, RATE);
    const invested = computeInvestedUSD(LOTS, RATE);
    const unrealized = total - invested;
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
    const rate2 = 0.2;
    const total1 = computeTotalUSD({ BOVA11: 100 }, { BOVA11: 50 }, rate1);
    const total2 = computeTotalUSD({ BOVA11: 100 }, { BOVA11: 50 }, rate2);
    expect(total2 / total1).toBeCloseTo(rate2 / rate1, 6);
  });

  test('changing brlUsdRate does NOT affect USD-asset totals', () => {
    const rate1 = 0.18;
    const rate2 = 0.2;
    const total1 = computeTotalUSD({ BTC: 0.5 }, { BTC: 60000 }, rate1);
    const total2 = computeTotalUSD({ BTC: 0.5 }, { BTC: 60000 }, rate2);
    expect(total1).toBeCloseTo(total2, 6);
  });

  test('BRL bond position total is rate-independent (stored in USD)', () => {
    const total1 = computeTotalUSD({ RENDA2065: 1000 }, { RENDA2065: 2 }, 0.18);
    const total2 = computeTotalUSD({ RENDA2065: 1000 }, { RENDA2065: 2 }, 0.2);
    expect(total1).toBeCloseTo(total2, 6);
  });

  test('qty-from-total and total-from-qty are inverse operations (BRL non-bond)', () => {
    const price = 50;
    const origQty = 100;
    const total = computeTotalFromQty('BOVA11', origQty, price, 'BRL', RATE);
    const recoveredQty = computeQtyFromTotal('BOVA11', total, 'BRL', price, RATE);
    expect(recoveredQty).toBeCloseTo(origQty, 6);
  });

  test('qty-from-total and total-from-qty are inverse operations (USD asset)', () => {
    const price = 60000;
    const origQty = 0.5;
    const total = computeTotalFromQty('BTC', origQty, price, 'USD', RATE);
    const recoveredQty = computeQtyFromTotal('BTC', total, 'USD', price, RATE);
    expect(recoveredQty).toBeCloseTo(origQty, 6);
  });
});
