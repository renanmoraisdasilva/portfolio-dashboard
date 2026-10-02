// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { labelText } from './pieLabelPlugin';

/**
 * `labelText` — what a doughnut slice is allowed to be called.
 *
 * This exists because `String(chart.data.labels?.[i] ?? '')` was wrong for
 * anything that is not already a string: Chart.js types `labels` as an array of
 * arbitrary values, so `String()` on a structured label produces `[object Object]`
 * — drawn onto the canvas, in a chart whose labels are asset symbols.
 * `no-base-to-string` found it. This test pins the behaviour so it cannot go
 * back to a blanket `String()`.
 */
describe('labelText', () => {
  test('passes a string through unchanged', () => {
    expect(labelText('BTC')).toBe('BTC');
    // Empty is a legitimate label, and must not become the fallback for "absent".
    expect(labelText('')).toBe('');
  });

  test('renders a primitive number or boolean rather than stringifying blindly', () => {
    // Chart.js accepts numeric labels, and `String(1)` is the right answer here —
    // it is only the *object* case that has no sensible answer.
    expect(labelText(42)).toBe('42');
    expect(labelText(0)).toBe('0');
    expect(labelText(true)).toBe('true');
  });

  test('never produces "[object Object]"', () => {
    // The whole point. A structured label gets no chip at all rather than a lie.
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
    // The old `?? ''` handled null and undefined; `labelText(undefined)` has to
    // keep that, and `String(null)` would render the word "null" on the chart.
    expect(labelText(undefined)).toBe('');
    expect(labelText(null)).toBe('');
    expect(labelText([])).toBe('');
  });
});
