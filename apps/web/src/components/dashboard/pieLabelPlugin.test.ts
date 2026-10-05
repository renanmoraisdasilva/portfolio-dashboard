// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { labelText } from './pieLabelPlugin';

describe('labelText', () => {
  test('passes a string through unchanged', () => {
    expect(labelText('BTC')).toBe('BTC');
    expect(labelText('')).toBe('');
  });

  test('renders a primitive number or boolean rather than stringifying blindly', () => {
    expect(labelText(42)).toBe('42');
    expect(labelText(0)).toBe('0');
    expect(labelText(true)).toBe('true');
  });

  test('never produces "[object Object]"', () => {
    const out = labelText({ name: 'BTC' });
    expect(out).toBe('');
    expect(out).not.toContain('[object Object]');
  });

  test('renders a Date as a date, since that is a legitimate slice name', () => {
    const out = labelText(new Date('2026-08-10T22:22:08.000Z'));
    expect(out).not.toBe('');
    expect(out).not.toContain('[object');
  });

  test('absent values are empty rather than "undefined" or "null"', () => {
    expect(labelText(undefined)).toBe('');
    expect(labelText(null)).toBe('');
    expect(labelText([])).toBe('');
  });
});
