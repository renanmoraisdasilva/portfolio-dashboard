import express from 'express';
import { all, get, run } from '../db';
import { stateRouter } from './state';

/**
 * A restore is the one operation that is supposed to lose nothing. These tests
 * pin the columns that are easy to drop without noticing, because the symptom
 * shows up somewhere else entirely: `brlusd_rate` went missing from the import's
 * column list while the export still sent it, and the effect was not a broken
 * chart - it was the analytics converting BRL interest at today's exchange rate.
 */
vi.mock('../db', () => ({ all: vi.fn(), get: vi.fn(), run: vi.fn() }));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;
const mockedGet = get as unknown as ReturnType<typeof vi.fn>;
const mockedRun = run as unknown as ReturnType<typeof vi.fn>;

/** Rows the mocked database holds, so a restore can be inspected afterwards. */
let snapshots: Record<string, unknown>[];
let trades: Record<string, unknown>[];
let priceCache: Record<string, unknown>[];
let assetChartCache: Record<string, unknown>[];
let analyticsSnapshots: Record<string, unknown>[];

beforeEach(() => {
  snapshots = [];
  trades = [];
  priceCache = [];
  assetChartCache = [];
  analyticsSnapshots = [];
  mockedRun.mockReset();
  mockedGet.mockReset();
  mockedAll.mockReset();

  mockedRun.mockImplementation((sql: string, params: unknown[] = []) => {
    const p = params as Array<string | number | null>;
    if (/^INSERT OR REPLACE INTO portfolio_snapshots/.test(sql)) {
      snapshots.push({ id: p[0], t: p[1], ts: p[2], v: p[3], i: p[4], p: p[5], manual: p[6], note: p[7], brlusd_rate: p[8] });
    }
    if (/^INSERT OR REPLACE INTO trades/.test(sql)) {
      trades.push({ id: p[0], symbol: p[1], side: p[2], qty: p[3], price: p[4], time: p[5], cash_entry_id: p[6] });
    }
    if (/^INSERT OR REPLACE INTO price_cache/.test(sql)) {
      priceCache.push({ symbol: p[0], price: p[1], ts: p[2], meta: p[3] });
    }
    if (/^INSERT OR REPLACE INTO asset_chart_cache/.test(sql)) {
      assetChartCache.push({ symbol: p[0], days: p[1], interval: p[2], ts: p[3], data: p[4] });
    }
    if (/^INSERT OR REPLACE INTO analytics_snapshots/.test(sql)) {
      analyticsSnapshots.push({ id: p[0], computed_at: p[1], period: p[2], return_pct: p[3], sharpe_ratio: p[7] });
    }
    return Promise.resolve({ changes: 0 });
  });
  mockedGet.mockResolvedValue({ cashReais: 0, cashDollars: 0 });
  mockedAll.mockResolvedValue([]);
});

async function restore(payload: unknown) {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use('/api/state', stateRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/state/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

const historyRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'snap-1',
  t: '2026-08-10T22:22:08.000Z',
  ts: 1780147023633,
  v: 42_000,
  i: 40_000,
  p: 2_000,
  manual: 0,
  note: 'scheduled',
  brlusd_rate: 0.196,
  ...over,
});

describe('POST /api/state/import — history', () => {
  test('preserves brlusd_rate on every snapshot', async () => {
    const { status } = await restore({ history: [historyRow(), historyRow({ id: 'snap-2', brlusd_rate: 0.1812 })] });

    expect(status).toBe(200);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].brlusd_rate).toBe(0.196);
    expect(snapshots[1].brlusd_rate).toBe(0.1812);
    // The failure this guards against: a null here reads as "use today's rate".
    expect(snapshots.every((s) => s.brlusd_rate != null)).toBe(true);
  });

  test('accepts a backup from before the column existed', async () => {
    const legacy = historyRow();
    delete legacy.brlusd_rate;

    const { status } = await restore({ history: [legacy] });

    expect(status).toBe(200);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].brlusd_rate).toBeNull();
  });

  test('keeps every other history column too', async () => {
    await restore({ history: [historyRow({ manual: 1, note: 'manual-entry', v: 1, i: 2, p: 3 })] });

    expect(snapshots[0]).toMatchObject({
      id: 'snap-1',
      t: '2026-08-10T22:22:08.000Z',
      ts: 1780147023633,
      v: 1,
      i: 2,
      p: 3,
      manual: 1,
      note: 'manual-entry',
    });
  });
});

describe('POST /api/state/import — replace, not merge', () => {
  test('clears trades and history before writing, so a restore can remove a row', async () => {
    // It used to insert row by row without clearing, so anything in the
    // database that the backup did not contain survived - a tool labelled
    // "restore" that could not undo a mistake. `cash` and `interest` were
    // already cleared, which is what made the behaviour inconsistent.
    mockedRun.mockClear();
    await restore({
      trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }],
      history: [historyRow()],
    });

    const deletes = mockedRun.mock.calls.map((c) => String(c[0])).filter((sql) => /^DELETE FROM/.test(sql));
    expect(deletes).toContain('DELETE FROM trades');
    expect(deletes).toContain('DELETE FROM portfolio_snapshots');
  });

  test('an absent key leaves its table alone, so a partial payload cannot empty it', async () => {
    mockedRun.mockClear();
    await restore({ history: [historyRow()] });

    const deletes = mockedRun.mock.calls.map((c) => String(c[0])).filter((sql) => /^DELETE FROM/.test(sql));
    expect(deletes).toContain('DELETE FROM portfolio_snapshots');
    expect(deletes).not.toContain('DELETE FROM trades');
    expect(deletes).not.toContain('DELETE FROM cash');
  });

  test('an empty array does clear the table - that is what replacing with nothing means', async () => {
    mockedRun.mockClear();
    await restore({ trades: [] });

    expect(mockedRun.mock.calls.map((c) => String(c[0]))).toContain('DELETE FROM trades');
  });
});

describe('POST /api/state/import — the tables added to the export in version 2', () => {
  test('restores price_cache, so a restore does not value every position at zero', async () => {
    await restore({ priceCache: [{ symbol: 'BTC', price: 60_000, ts: 1, meta: null }] });

    expect(priceCache).toEqual([{ symbol: 'BTC', price: 60_000, ts: 1, meta: null }]);
  });

  test('restores asset_chart_cache, so the charts are not empty until the next refetch', async () => {
    await restore({ assetChartCache: [{ symbol: 'BTC', days: 1825, interval: '1d', ts: 2, data: '[{"t":1}]' }] });

    expect(assetChartCache).toHaveLength(1);
    expect(assetChartCache[0]).toMatchObject({ symbol: 'BTC', days: 1825, interval: '1d' });
  });

  test('restores analytics_snapshots, so the analytics page is not blank until the daily job', async () => {
    await restore({ analyticsSnapshots: [{ id: 'a-1', computed_at: 5, period: '1M', return_pct: 0.1, sharpe_ratio: 2 }] });

    expect(analyticsSnapshots).toHaveLength(1);
    expect(analyticsSnapshots[0]).toMatchObject({ period: '1M', return_pct: 0.1, sharpe_ratio: 2 });
  });

  test('a version 1 backup without those keys leaves the tables untouched', async () => {
    mockedRun.mockClear();
    await restore({ trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }] });

    const deletes = mockedRun.mock.calls.map((c) => String(c[0])).filter((sql) => /^DELETE FROM/.test(sql));
    expect(deletes).not.toContain('DELETE FROM price_cache');
    expect(deletes).not.toContain('DELETE FROM asset_chart_cache');
    expect(deletes).not.toContain('DELETE FROM analytics_snapshots');
  });
});

describe('POST /api/state/import — the columns a restore must not drop', () => {
  test('carries trades.cash_entry_id, so a restored trade still reverses its cash', async () => {
    // Without this, a trade restored from a backup has no link to the cash
    // movement it created and deleting it strands that cash permanently.
    await restore({
      trades: [
        { id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 100, time: '2026-01-01T00:00:00.000Z', cash_entry_id: 'c-1' },
      ],
    });

    expect(trades[0].cash_entry_id).toBe('c-1');
  });

  test('an empty payload is a no-op, not a wipe', async () => {
    const { status } = await restore({});

    expect(status).toBe(200);
    expect(snapshots).toHaveLength(0);
  });
});
