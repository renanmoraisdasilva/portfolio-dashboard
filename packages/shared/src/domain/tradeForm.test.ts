import { describe, expect, test } from 'vitest';
import { createSymbolClassifier, formatMoney, parseMoney, type SymbolMap } from './money';
import {
  computePctFromQty,
  computeQtyFromPct,
  computeQtyFromTotal,
  computeTotal,
  computeTradeAmounts,
  conversionNeedsRate,
  convertCashInput,
  displayCurrencyOf,
  displayPriceFromSpot,
  formatDisplayPrice,
  parseDisplayPrice,
  type TradeFormContext,
  type TradePriceMetaMap,
} from './tradeForm';

const SYMBOLS: SymbolMap = {
  BTC: { type: 'crypto' },
  SPY: { type: 'stock' },
  BOVA11: { type: 'stock', denominatedInBRL: true },
  LTN27: { type: 'bond', denominatedInBRL: true },
};

const classifier = createSymbolClassifier(SYMBOLS);
const RATE = 0.2;

function ctx(overrides: Partial<TradeFormContext> = {}): TradeFormContext {
  return {
    symbol: 'BTC',
    side: 'buy',
    cashSource: 'USD',
    classifier,
    brlUsdRate: RATE,
    cashUsd: 1_000,
    cashBrl: 5_000,
    positionQty: 0,
    ...overrides,
  };
}

describe('the display currency', () => {
  test('is USD for a USD symbol and BRL for a BRL one, bond or not', () => {
    expect(displayCurrencyOf('BTC', classifier)).toBe('USD');
    expect(displayCurrencyOf('SPY', classifier)).toBe('USD');
    expect(displayCurrencyOf('BOVA11', classifier)).toBe('BRL');
    expect(displayCurrencyOf('LTN27', classifier)).toBe('BRL');
  });

  test('a spot quote is already the display price unless the symbol is a bond', () => {
    expect(displayPriceFromSpot(64_000, 'BTC', classifier, RATE)).toBe(64_000);
    expect(displayPriceFromSpot(169.27, 'BOVA11', classifier, RATE)).toBe(169.27);
    // A bond's spot is USD and its row is reported in BRL: 0.50 USD at 0.2 → R$2.50.
    expect(displayPriceFromSpot(0.5, 'LTN27', classifier, RATE)).toBeCloseTo(2.5, 10);
  });

  test("the server's own BRL quote wins over converting the spot", () => {
    const priceMeta: TradePriceMetaMap = { LTN27: { priceBRL: 3 } };
    expect(displayPriceFromSpot(0.5, 'LTN27', classifier, RATE, priceMeta)).toBe(3);
    expect(displayPriceFromSpot(0.5, 'SPY', classifier, RATE, priceMeta)).toBe(0.5);
  });

  test('a bond with no rate has no BRL quote rather than a converted one', () => {
    expect(displayPriceFromSpot(0.5, 'LTN27', classifier, 0)).toBeNull();
  });

  test('a formatted display price parses back to the same number', () => {
    for (const [symbol, price] of [
      ['BTC', 64_002],
      ['BOVA11', 169.27],
      ['BOVA11', 1_234.56],
    ] as const) {
      const text = formatDisplayPrice(price, symbol, classifier);
      expect(parseDisplayPrice(text, symbol, classifier)).toBeCloseTo(price, 6);
    }
  });

  test('formatting a BRL price as USD and reading it back as BRL inflates it 100x', () => {
    // What `syncPriceToSymbol` in the simulator did before this module existed:
    // 169.27 was written as $169.27 and parsed as pt-BR, so the dots came out as
    // thousands separators and the price became R$16.927,00.
    expect(parseMoney(formatMoney(169.27, 'USD'), 'BRL')).toBeCloseTo(16_927, 6);
    expect(parseDisplayPrice(formatDisplayPrice(169.27, 'BOVA11', classifier), 'BOVA11', classifier)).toBeCloseTo(169.27, 6);
  });
});

describe('conversionNeedsRate', () => {
  test('is false only when the cash source already matches the price field', () => {
    expect(conversionNeedsRate(ctx({ symbol: 'BTC', cashSource: 'USD' }))).toBe(false);
    expect(conversionNeedsRate(ctx({ symbol: 'BOVA11', cashSource: 'BRL' }))).toBe(false);
    expect(conversionNeedsRate(ctx({ symbol: 'BOVA11', cashSource: 'USD' }))).toBe(true);
    expect(conversionNeedsRate(ctx({ symbol: 'BTC', cashSource: 'BRL' }))).toBe(true);
  });
});

describe('computeTotal', () => {
  test('a USD asset in USD', () => {
    expect(computeTotal(2, 100, ctx())).toBe(formatMoney(200, 'USD'));
  });

  test('a USD asset paid from BRL divides at the rate', () => {
    expect(computeTotal(2, 100, ctx({ cashSource: 'BRL' }))).toBe(formatMoney(1_000, 'BRL'));
  });

  test('a BRL asset in BRL', () => {
    expect(computeTotal(10, 100, ctx({ symbol: 'BOVA11', cashSource: 'BRL' }))).toBe(formatMoney(1_000, 'BRL'));
  });

  test('a BRL asset paid from USD multiplies at the rate', () => {
    expect(computeTotal(10, 100, ctx({ symbol: 'BOVA11', cashSource: 'USD' }))).toBe(formatMoney(200, 'USD'));
  });

  test('no quantity, no price, or no rate means no total rather than a wrong one', () => {
    expect(computeTotal(0, 100, ctx())).toBe('');
    expect(computeTotal(2, 0, ctx())).toBe('');
    expect(computeTotal(2, -1, ctx())).toBe('');
    expect(computeTotal(2, 100, ctx({ cashSource: 'BRL', brlUsdRate: 0 }))).toBe('');
    // Same currency needs no rate, so it still totals.
    expect(computeTotal(2, 100, ctx({ brlUsdRate: 0 }))).toBe(formatMoney(200, 'USD'));
  });

  test('the conversion happens before any rounding, not after', () => {
    // 0.5 × 0.25 = 0.125 USD = R$0.625 → R$0,63. Rounding the USD product to
    // two decimals first, as the simulator's copy of this did, gives 0.13 →
    // R$0,65 — a total two centavos away from the real one.
    const text = computeTotal(0.5, 0.25, ctx({ cashSource: 'BRL' }));
    expect(text).toBe(formatMoney(0.625, 'BRL'));
    expect(text).not.toBe(formatMoney(0.65, 'BRL'));
  });
});

describe('computeQtyFromTotal', () => {
  test('is the inverse of computeTotal in every currency combination', () => {
    const cases: TradeFormContext[] = [
      ctx(),
      ctx({ cashSource: 'BRL' }),
      ctx({ symbol: 'BOVA11', cashSource: 'BRL' }),
      ctx({ symbol: 'BOVA11', cashSource: 'USD' }),
    ];
    for (const c of cases) {
      for (const [qty, price] of [
        [2, 100],
        [0.125, 64_000],
        [10, 169.27],
      ] as const) {
        const total = computeTotal(qty, price, c);
        expect(parseFloat(computeQtyFromTotal(total, price, c))).toBeCloseTo(qty, 3);
      }
    }
  });

  test('reads formatted money the way the field shows it', () => {
    expect(computeQtyFromTotal(formatMoney(1_000, 'BRL'), 100, ctx({ symbol: 'BOVA11', cashSource: 'BRL' }))).toBe('10');
    expect(computeQtyFromTotal('1000', 100, ctx())).toBe('10');
  });

  test('a total that cannot be read or converted yields no quantity', () => {
    expect(computeQtyFromTotal('abc', 100, ctx())).toBe('');
    expect(computeQtyFromTotal('', 100, ctx())).toBe('');
    expect(computeQtyFromTotal('1000', 0, ctx())).toBe('');
    expect(computeQtyFromTotal('1000', 100, ctx({ cashSource: 'BRL', brlUsdRate: 0 }))).toBe('');
  });
});

describe('the percentage slider', () => {
  test('round-trips through the quantity for a USD asset', () => {
    const c = ctx({ cashUsd: 1_000 });
    const qty = computeQtyFromPct(50, 100, c);
    expect(qty).toBe(5);
    expect(computePctFromQty(qty, 100, c)).toBe(50);
  });

  test('round-trips through the quantity for a BRL asset paid from BRL', () => {
    // The bug this replaces: pctFromQty divided a BRL amount by a USD balance,
    // so at 0.2 BRLUSD this slider came back at 250% and clamped to 100.
    const c = ctx({ symbol: 'BOVA11', cashSource: 'BRL', cashBrl: 5_000 });
    const qty = computeQtyFromPct(50, 100, c);
    expect(qty).toBe(25);
    expect(computePctFromQty(qty, 100, c)).toBe(50);
  });

  test('round-trips through the quantity for a BRL asset paid from USD', () => {
    // The forward direction converts the USD balance to BRL, so the reverse has
    // to compare against that same BRL balance: 1000 USD at 0.2 is 5000 BRL.
    const c = ctx({ symbol: 'BOVA11', cashSource: 'USD', cashUsd: 1_000 });
    const qty = computeQtyFromPct(50, 100, c);
    expect(qty).toBe(25);
    expect(computePctFromQty(qty, 100, c)).toBe(50);
  });

  test('round-trips for a USD asset paid from BRL', () => {
    const c = ctx({ cashSource: 'BRL', cashBrl: 5_000 });
    const qty = computeQtyFromPct(50, 100, c);
    expect(qty).toBe(5);
    expect(computePctFromQty(qty, 100, c)).toBe(50);
  });

  test('a sell is a share of the position, not of the cash', () => {
    const c = ctx({ side: 'sell', positionQty: 10 });
    expect(computeQtyFromPct(40, 100, c)).toBe(4);
    expect(computePctFromQty(4, 100, c)).toBe(40);
    expect(computePctFromQty(40, 100, c)).toBe(100);
    expect(computePctFromQty(0, 100, c)).toBe(0);
  });

  test('no position, no percentage', () => {
    expect(computePctFromQty(4, 100, ctx({ side: 'sell', positionQty: 0 }))).toBe(0);
    expect(computeQtyFromPct(40, 100, ctx({ side: 'sell', positionQty: 0 }))).toBe(0);
  });

  test('no price, no percentage', () => {
    expect(computeQtyFromPct(50, 0, ctx())).toBe(0);
    expect(computePctFromQty(5, 0, ctx())).toBe(0);
  });

  test('an unknown rate cannot be divided at parity', () => {
    const c = ctx({ cashSource: 'BRL', brlUsdRate: 0 });
    expect(computeQtyFromPct(50, 100, c)).toBe(0);
    expect(computePctFromQty(5, 100, c)).toBe(0);
  });

  test('zero percent is zero quantity, and the percentage never leaves 0..100', () => {
    expect(computeQtyFromPct(0, 100, ctx())).toBe(0);
    expect(computePctFromQty(10_000, 100, ctx())).toBe(100);
    expect(computeQtyFromPct(150, 100, ctx({ side: 'sell', positionQty: 10 }))).toBe(15);
  });
});

describe('computeTradeAmounts', () => {
  test('a USD asset is its own USD value', () => {
    expect(computeTradeAmounts(2, 100, ctx())).toEqual({ usd: 200, brl: 1_000 });
  });

  test('a BRL asset is its own BRL value', () => {
    expect(computeTradeAmounts(2, 100, ctx({ symbol: 'BOVA11' }))).toEqual({ usd: 40, brl: 200 });
  });

  test('an unknown rate reports zero rather than converting at parity', () => {
    expect(computeTradeAmounts(2, 100, ctx({ brlUsdRate: 0 }))).toEqual({ usd: 200, brl: 0 });
    expect(computeTradeAmounts(2, 100, ctx({ symbol: 'BOVA11', brlUsdRate: 0 }))).toEqual({ usd: 0, brl: 200 });
  });
});

describe('convertCashInput', () => {
  test('converts when the cash source toggles', () => {
    expect(convertCashInput('100', 'USD', 'BRL', RATE)).toBe(formatMoney(500, 'BRL'));
    expect(convertCashInput(formatMoney(500, 'BRL'), 'BRL', 'USD', RATE)).toBe(formatMoney(100, 'USD'));
  });

  test('normalises the text when the currency does not change', () => {
    expect(convertCashInput('100', 'USD', 'USD', RATE)).toBe(formatMoney(100, 'USD'));
  });

  test('leaves anything it cannot honestly convert exactly as it found it', () => {
    expect(convertCashInput('abc', 'USD', 'BRL', RATE)).toBe('abc');
    expect(convertCashInput('0', 'USD', 'BRL', RATE)).toBe('0');
    expect(convertCashInput('100', 'USD', 'BRL', 0)).toBe('100');
  });
});
