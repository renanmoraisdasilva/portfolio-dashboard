import { describe, expect, test } from 'vitest';
import { formatMoney, formatSigned } from './money';

describe('formatSigned', () => {
  test('adds an explicit + to a positive amount', () => {
    expect(formatSigned(1234.56, 'USD')).toBe(`+${formatMoney(1234.56, 'USD')}`);
  });

  test('keeps a single minus on a negative amount', () => {
    const out = formatSigned(-5, 'USD');
    expect(out).toBe(formatMoney(5, 'USD').replace(/^\$/, '-$'));
    expect(out.startsWith('+-')).toBe(false);
    expect(out.match(/-/g)).toHaveLength(1);
  });

  test('signs negative zero as positive rather than +-$0.00', () => {
    const out = formatSigned(-0, 'USD');
    expect(out).toBe(`+${formatMoney(0, 'USD')}`);
    expect(out).not.toContain('-');
  });

  test('signs zero as positive', () => {
    expect(formatSigned(0, 'BRL')).toBe(`+${formatMoney(0, 'BRL')}`);
  });

  test('handles BRL magnitudes', () => {
    expect(formatSigned(-1234.56, 'BRL')).toBe(`-${formatMoney(1234.56, 'BRL')}`);
  });

  test('honours maxFractionDigits', () => {
    expect(formatSigned(1234.56, 'USD', 0)).toBe(`+${formatMoney(1234.56, 'USD', 0)}`);
  });

  test('coerces null, undefined and unparseable strings to a signed zero', () => {
    for (const input of [null, undefined, 'abc']) {
      expect(formatSigned(input, 'USD')).toBe(`+${formatMoney(0, 'USD')}`);
    }
  });
});

describe('formatMoney memoisation', () => {
  test('repeated calls return identical output', () => {
    const first = formatMoney(1234.56, 'USD', 0);
    const second = formatMoney(9876.54, 'USD', 0);
    expect(first).toBe(formatMoney(1234.56, 'USD', 0));
    expect(second).toBe(formatMoney(9876.54, 'USD', 0));
    expect(first).not.toContain('.');
  });

  test('the 0-digit and default-digit variants do not share a formatter', () => {
    expect(formatMoney(1234.56, 'USD', 0)).not.toBe(formatMoney(1234.56, 'USD'));
    expect(formatMoney(1234.56, 'USD')).toContain('.56');
  });

  test('BRL and USD do not share a formatter', () => {
    expect(formatMoney(1234.56, 'BRL')).not.toBe(formatMoney(1234.56, 'USD'));
    expect(formatMoney(1234.56, 'BRL')).toContain(',56');
    expect(formatMoney(1234.56, 'USD')).toContain('.56');
  });
});
