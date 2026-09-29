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

beforeEach(() => {
  snapshots = [];
  trades = [];
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
    if (/^DELETE FROM (cash|interest|trades)/.test(sql)) return Promise.resolve({ changes: 0 });
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
