import { formatMoney, parseMoney } from '@portfolio-dashboard/shared';

describe('formatMoney', () => {
  test('formats BRL with pt-BR locale', () => {
    const result = formatMoney(1234.56, 'BRL');
    expect(result).toMatch(/R\$/);
    expect(result).toMatch(/1[.,]234/);
  });

  test('formats USD with en-US locale', () => {
    const result = formatMoney(1234.56, 'USD');
    expect(result).toMatch(/\$/);
    expect(result).toMatch(/1,234/);
  });

  test('formats zero correctly', () => {
    expect(formatMoney(0, 'BRL')).toMatch(/R\$/);
    expect(formatMoney(0, 'USD')).toMatch(/\$/);
  });

  test('coerces non-number to number', () => {
    const result = formatMoney('500', 'USD');
    expect(result).toMatch(/500/);
  });

  test('coerces null/undefined to 0', () => {
    expect(formatMoney(null, 'USD')).toMatch(/0/);
    expect(formatMoney(undefined, 'USD')).toMatch(/0/);
  });

  test('handles negative values', () => {
    const result = formatMoney(-100, 'USD');
    expect(result).toMatch(/-/);
    expect(result).toMatch(/100/);
  });
});

describe('parseMoney', () => {
  test('parses BRL formatted string', () => {
    expect(parseMoney('R$\u00a01.234,56', 'BRL')).toBeCloseTo(1234.56, 2);
  });

  test('parses USD formatted string', () => {
    expect(parseMoney('$1,234.56', 'USD')).toBeCloseTo(1234.56, 2);
  });

  test('returns 0 for empty string', () => {
    expect(parseMoney('', 'USD')).toBe(0);
  });

  test('returns 0 for null', () => {
    expect(parseMoney(null, 'USD')).toBe(0);
  });

  test('returns 0 for undefined', () => {
    expect(parseMoney(undefined, 'USD')).toBe(0);
  });

  test('returns numeric input unchanged', () => {
    expect(parseMoney(42.5, 'USD')).toBe(42.5);
  });

  test('returns 0 for numeric 0', () => {
    expect(parseMoney(0, 'USD')).toBe(0);
  });

  test('parses plain number string (USD)', () => {
    expect(parseMoney('1234.56', 'USD')).toBeCloseTo(1234.56, 2);
  });

  test('parses plain number string (BRL with comma decimal)', () => {
    expect(parseMoney('1234,56', 'BRL')).toBeCloseTo(1234.56, 2);
  });

  test('strips whitespace before parsing', () => {
    expect(parseMoney('  500.00  ', 'USD')).toBeCloseTo(500, 2);
  });
});
