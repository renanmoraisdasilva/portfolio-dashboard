import { describe, expect, test } from 'vitest';
import { formatMoney, formatSigned } from './money';

/**
 * `formatSigned`, and the display bugs it removes.
 *
 * Both Vue stores built a signed amount by prepending `` `${n >= 0 ? '+' : ''}` ``
 * onto a magnitude that some paths rendered through `Intl` and some through a
 * hand-rolled `` `$${x.toFixed(2)}` ``. Two defects came out of that split:
 *
 * - **negative zero.** `-0 >= 0` is `true`, so it took the `+` branch and then
 *   formatted `-0`, which `Intl` renders as `-$0.00` — giving `+$-0.00`, two signs.
 * - **sign order.** The hand-rolled paths emitted the symbol before the minus
 *   (`$-1,234.56`, `R$-19943.92`); only the `Intl` ones were right, which is why
 *   the same column disagreed with itself by currency.
 *
 * `formatSigned` formats the magnitude and supplies the sign itself, so both are
 * impossible to get wrong by accident.
 *
 * `formatMoney` is also memoised now (it runs inside computed properties on every
 * reactive tick), so the cache is exercised here rather than trusted.
 */
describe('formatSigned', () => {
  test('adds an explicit + to a positive amount', () => {
    expect(formatSigned(1234.56, 'USD')).toBe(`+${formatMoney(1234.56, 'USD')}`);
  });

  test('keeps a single minus on a negative amount', () => {
    // An ordinary negative was already right in the old `signedUsd`
    // (`` `${n >= 0 ? '+' : ''}${usd(n)}` `` renders `-$5.00`), so this pins the
    // sign *order* rather than a fix — and order is what the hand-rolled
    // `$${x.toFixed(2)}` paths in `dashboard.ts` got wrong (`$-1,234.56`).
    const out = formatSigned(-5, 'USD');
    expect(out).toBe(formatMoney(5, 'USD').replace(/^\$/, '-$'));
    expect(out.startsWith('+-')).toBe(false);
    expect(out.match(/-/g)).toHaveLength(1);
  });

  test('signs negative zero as positive rather than +-$0.00', () => {
    // `-0 >= 0` is true in JavaScript, so the old `` `${n >= 0 ? '+' : ''}${usd(n)}` ``
    // took the `+` branch and then formatted `-0`, which `Intl` renders as `-$0.00`.
    // The result was two signs: `+$-0.00`. Taking the magnitude first collapses it.
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
    // The cache is keyed by locale + currency + maximumFractionDigits. If the key
    // missed an option, a 0-digit call could be served by the 2-digit formatter,
    // and a BRL call by the USD one — both of which would still "work" and just
    // print the wrong thing.
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
    // The decimal separator is the observable difference: pt-BR uses a comma.
    expect(formatMoney(1234.56, 'BRL')).toContain(',56');
    expect(formatMoney(1234.56, 'USD')).toContain('.56');
  });
});
