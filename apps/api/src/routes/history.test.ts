import { sinceForRange, bucketRows, BUCKET_MS } from './history';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

describe('sinceForRange', () => {
  const now = 1_700_000_000_000;

  test.each([
    ['day', now - DAY_MS],
    ['week', now - 7 * DAY_MS],
    ['month', now - 30 * DAY_MS],
    ['6months', now - 180 * DAY_MS],
    ['year', now - 365 * DAY_MS],
  ])('range=%s returns correct cutoff', (range, expected) => {
    expect(sinceForRange(range, now)).toBe(expected);
  });

  test('unknown range returns 0', () => {
    expect(sinceForRange('all', 999)).toBe(0);
    expect(sinceForRange('', 999)).toBe(0);
    expect(sinceForRange('quarterly', 999)).toBe(0);
  });
});

describe('BUCKET_MS', () => {
  test('day bucket is 30 minutes', () => {
    expect(BUCKET_MS.day).toBe(30 * MIN_MS);
  });
  test('week bucket is 2 hours', () => {
    expect(BUCKET_MS.week).toBe(2 * HOUR_MS);
  });
  test('month bucket is 1 day', () => {
    expect(BUCKET_MS.month).toBe(DAY_MS);
  });
  test('6months bucket is 1 day', () => {
    expect(BUCKET_MS['6months']).toBe(DAY_MS);
  });
  test('year bucket is 7 days', () => {
    expect(BUCKET_MS.year).toBe(7 * DAY_MS);
  });
});

describe('bucketRows', () => {
  test('returns empty array for empty input', () => {
    expect(bucketRows([], DAY_MS)).toEqual([]);
  });

  test('returns single row unchanged', () => {
    const row = { id: 'a', ts: 1000, v: 42 };
    expect(bucketRows([row], DAY_MS)).toEqual([row]);
  });

  test('keeps the LAST row when two rows fall in the same bucket', () => {
    const base = Math.floor(1_700_000_000_000 / DAY_MS) * DAY_MS;
    const first = { id: '1', ts: base, v: 10 };
    const second = { id: '2', ts: base + HOUR_MS, v: 20 };
    const result = bucketRows([first, second], DAY_MS);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(second);
  });

  test('keeps both rows when they fall in different buckets', () => {
    const base = Math.floor(1_700_000_000_000 / DAY_MS) * DAY_MS;
    const day1 = { id: '1', ts: base, v: 10 };
    const day2 = { id: '2', ts: base + DAY_MS, v: 20 };
    const result = bucketRows([day1, day2], DAY_MS);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(day1);
    expect(result[1]).toBe(day2);
  });

  test('month scenario: many intra-day 30-min snapshots collapse to 1 point per day', () => {
    const base = Math.floor(1_700_000_000_000 / DAY_MS) * DAY_MS;

    const d1 = [0, HOUR_MS * 8, HOUR_MS * 16].map((offset, i) => ({
      id: `d1-${i}`,
      ts: base + offset,
      v: i,
    }));
    const d2 = [0, HOUR_MS * 8, HOUR_MS * 16].map((offset, i) => ({
      id: `d2-${i}`,
      ts: base + DAY_MS + offset,
      v: i + 10,
    }));

    const rows = [...d1, ...d2];
    const result = bucketRows(rows, DAY_MS);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('d1-2');
    expect(result[1].id).toBe('d2-2');
  });

  test('preserves ASC order of buckets in output', () => {
    const base = 1_700_000_000_000;
    const rows = [0, DAY_MS, 2 * DAY_MS, 3 * DAY_MS].map((offset, i) => ({
      id: `r${i}`,
      ts: base + offset,
      v: i,
    }));
    const result = bucketRows(rows, DAY_MS);
    expect(result).toHaveLength(4);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].ts).toBeGreaterThan(result[i - 1].ts);
    }
  });

  test('30-min bucket for day range: two snapshots 31 min apart land in different buckets', () => {
    const base = 1_700_000_000_000;
    const r1 = { id: '1', ts: base, v: 1 };
    const r2 = { id: '2', ts: base + 31 * MIN_MS, v: 2 };
    const result = bucketRows([r1, r2], BUCKET_MS.day);
    expect(result).toHaveLength(2);
  });

  test('30-min bucket for day range: two snapshots 10 min apart stay in same bucket', () => {
    const base = 1_700_000_000_000;
    const r1 = { id: '1', ts: base, v: 1 };
    const r2 = { id: '2', ts: base + 10 * MIN_MS, v: 2 };
    const result = bucketRows([r1, r2], BUCKET_MS.day);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });
});
