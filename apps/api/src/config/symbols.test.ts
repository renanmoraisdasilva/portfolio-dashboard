import { getCryptoSymbols, getStockSymbols, getCurrencySymbols, SYMBOL_IDS, SYMBOLS } from './symbols';

describe('symbols config helpers', () => {
  test('group functions return arrays and include expected ids', () => {
    const crypto = getCryptoSymbols();
    const stocks = getStockSymbols();
    const currencies = getCurrencySymbols();

    expect(Array.isArray(crypto)).toBe(true);
    expect(crypto).toContain('BTC');

    expect(Array.isArray(stocks)).toBe(true);
    expect(stocks).toContain('SPY');

    expect(Array.isArray(currencies)).toBe(true);
    expect(currencies).toContain('BRLUSD');

    expect(Array.isArray(SYMBOL_IDS)).toBe(true);
    expect(SYMBOL_IDS.length).toBeGreaterThan(0);
  });
});
