import { computeProjection, PROJECTION_DAYS } from './projection';

const HOUR = 1000 * 60 * 60;
const DAY = 24 * HOUR;

/** A portfolio that gained $1000 a day, sampled every 12 hours. */
const rising = Array.from({ length: 20 }, (_, i) => ({ ts: i * 12 * HOUR, v: 10_000 + i * 500 }));

describe('computeProjection', () => {
  test('needs at least two samples to fit a line', () => {
    expect(computeProjection([])).toEqual([]);
    expect(computeProjection([{ ts: 0, v: 1 }])).toEqual([]);
  });

  test('extends the fitted line forward from the last sample', () => {
    const points = computeProjection(rising, { days: 10 });
    expect(points.length).toBeGreaterThan(0);
    // Ten days past the last point, a +1000/day fit is 10 days of gains away.
    const lastSample = rising[rising.length - 1];
    const tenDaysOut = points.find((p) => p.ts >= lastSample.ts + 10 * DAY);
    expect(tenDaysOut?.v).toBeCloseTo(lastSample.v + 10_000, 6);
  });

  test('spends the requested horizon, at a stable sampling density', () => {
    const points = computeProjection(rising, { days: 30 });
    const lastSample = rising[rising.length - 1].ts;
    const first = points[0].ts - lastSample;
    const final = points[points.length - 1].ts - lastSample;
    expect(first).toBeGreaterThan(0);
    expect(final).toBeCloseTo(30 * DAY, 3);
  });

  test('clamps to at most 200 points and at least 10', () => {
    const dense = Array.from({ length: 500 }, (_, i) => ({ ts: i * HOUR, v: 1000 + i }));
    expect(computeProjection(dense, { days: 182.5 }).length).toBe(200);
    const sparse = Array.from({ length: 2 }, (_, i) => ({ ts: i * 365 * DAY, v: 1000 * (i + 1) }));
    expect(computeProjection(sparse, { days: 1 }).length).toBeGreaterThanOrEqual(10);
  });

  test('a declining portfolio projects to zero rather than to negative money', () => {
    const falling = Array.from({ length: 20 }, (_, i) => ({ ts: i * DAY, v: 10_000 - i * 1_000 }));
    const points = computeProjection(falling, { days: 30 });
    expect(points.every((p) => p.v === 0)).toBe(true);
  });

  test('a flat portfolio projects a flat line', () => {
    const flat = Array.from({ length: 10 }, (_, i) => ({ ts: i * DAY, v: 5_000 }));
    const points = computeProjection(flat, { days: 10 });
    points.forEach((p) => expect(p.v).toBeCloseTo(5_000, 6));
  });

  test('samples with identical timestamps cannot be fitted', () => {
    const stacked = Array.from({ length: 5 }, (_, i) => ({ ts: 0, v: 1000 + i }));
    expect(computeProjection(stacked)).toEqual([]);
  });

  test('a missing ts or v is read as zero rather than as NaN', () => {
    const sparse = [
      { ts: 0, v: 1_000 },
      { ts: null, v: 2_000 },
      { ts: 2 * DAY, v: null },
    ];
    const points = computeProjection(sparse, { days: 5 });
    expect(points.length).toBeGreaterThan(0);
    points.forEach((p) => expect(Number.isFinite(p.v)).toBe(true));

    // A sample with no fields at all is the same as one that is all zeros, and a
    // final sample with no timestamp still yields a forward line.
    const missing = [{ v: 1_000 }, { ts: DAY, v: 2_000 }, {}] as Array<{ ts?: number; v?: number }>;
    const fromMissing = computeProjection(missing, { days: 5 });
    expect(fromMissing.length).toBeGreaterThan(0);
    fromMissing.forEach((p) => expect(Number.isFinite(p.v)).toBe(true));
    expect(fromMissing[0].ts).toBeGreaterThan(0);

    // Every sample at the same instant is not a line, so there is nothing to draw.
    expect(computeProjection([{ ts: null, v: null }, { ts: null, v: null }])).toEqual([]);
  });

  test('defaults to the half-year horizon the dashboard used', () => {
    const points = computeProjection(rising);
    const lastSample = rising[rising.length - 1].ts;
    expect(points[points.length - 1].ts - lastSample).toBeCloseTo(PROJECTION_DAYS * DAY, 3);
  });
});
