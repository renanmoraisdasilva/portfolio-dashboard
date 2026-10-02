import express from 'express';
import { all, get, runSync, transaction } from '../db';
import { stateRouter } from './state';

/**
 * A restore is the one operation that is supposed to lose nothing. These tests
 * pin the columns that are easy to drop without noticing, because the symptom
 * shows up somewhere else entirely: `brlusd_rate` went missing from the import's
 * column list while the export still sent it, and the effect was not a broken
 * chart - it was the analytics converting BRL interest at today's exchange rate.
 *
 * The import writes through `runSync` inside `transaction()` now, so the fake
 * implements those. `transaction` snapshots every table and restores it if the
 * body throws, which is what makes "one bad row rolls the whole restore back"
 * testable rather than assumed.
 */
vi.mock('../db', () => ({
  all: vi.fn(),
  get: vi.fn(),
  runSync: vi.fn(),
  transaction: vi.fn(),
}));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;
const mockedGet = get as unknown as ReturnType<typeof vi.fn>;
const mockedRunSync = runSync as unknown as ReturnType<typeof vi.fn>;
const mockedTransaction = transaction as unknown as ReturnType<typeof vi.fn>;

/** Rows the mocked database holds, so a restore can be inspected afterwards. */
let snapshots: Record<string, unknown>[];
let trades: Record<string, unknown>[];
let priceCache: Record<string, unknown>[];
let assetChartCache: Record<string, unknown>[];
let analyticsSnapshots: Record<string, unknown>[];
let interest: Record<string, unknown>[];
/** Every `DELETE FROM <table>` the handler issued, so a restore can be audited. */
let deletedFrom: string[];

beforeEach(() => {
  snapshots = [];
  trades = [];
  priceCache = [];
  assetChartCache = [];
  analyticsSnapshots = [];
  interest = [];
  deletedFrom = [];
  mockedRunSync.mockReset();
  mockedTransaction.mockReset();
  mockedGet.mockReset();
  mockedAll.mockReset();

  // Real rollback: a throw inside the import body puts every table back. Without
  // this, "the restore is one transaction" is an assumption rather than something
  // the suite checks.
  mockedTransaction.mockImplementation((fn: () => unknown) => {
    const backup = {
      snapshots: [...snapshots],
      trades: [...trades],
      priceCache: [...priceCache],
      assetChartCache: [...assetChartCache],
      analyticsSnapshots: [...analyticsSnapshots],
      interest: [...interest],
      deletedFrom: [...deletedFrom],
    };
    try {
      return fn();
    } catch (err) {
      snapshots = backup.snapshots;
      trades = backup.trades;
      priceCache = backup.priceCache;
      assetChartCache = backup.assetChartCache;
      analyticsSnapshots = backup.analyticsSnapshots;
      interest = backup.interest;
      deletedFrom = backup.deletedFrom;
      throw err;
    }
  });

  mockedRunSync.mockImplementation((sql: string, params: unknown[] = []) => {
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
    if (/^INSERT INTO interest/.test(sql)) {
      interest.push({ month: p[0], currency: p[1], amount: p[2], created_at: p[3] });
    }
    // Record the table, and the WHERE clause if there is one: `DELETE FROM x` and
    // `DELETE FROM x WHERE currency = ?` are different contracts, and which one
    // the handler issues is exactly what the interest tests are about.
    const del = /^DELETE FROM (\w+)(.*)$/.exec(sql);
    if (del) {
      deletedFrom.push(`${del[1]}${del[2].trim()}`);
      if (del[1] === 'interest') interest = [];
    }
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
    mockedRunSync.mockClear();
    await restore({
      trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }],
      history: [historyRow()],
    });

    const deletes = mockedRunSync.mock.calls.map((c) => String(c[0])).filter((sql) => /^DELETE FROM/.test(sql));
    expect(deletes).toContain('DELETE FROM trades');
    expect(deletes).toContain('DELETE FROM portfolio_snapshots');
  });

  test('an absent key leaves its table alone, so a partial payload cannot empty it', async () => {
    mockedRunSync.mockClear();
    await restore({ history: [historyRow()] });

    const deletes = mockedRunSync.mock.calls.map((c) => String(c[0])).filter((sql) => /^DELETE FROM/.test(sql));
    expect(deletes).toContain('DELETE FROM portfolio_snapshots');
    expect(deletes).not.toContain('DELETE FROM trades');
    expect(deletes).not.toContain('DELETE FROM cash');
  });

  test('an empty array does clear the table - that is what replacing with nothing means', async () => {
    mockedRunSync.mockClear();
    await restore({ trades: [] });

    expect(mockedRunSync.mock.calls.map((c) => String(c[0]))).toContain('DELETE FROM trades');
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
    mockedRunSync.mockClear();
    await restore({ trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }] });

    const deletes = mockedRunSync.mock.calls.map((c) => String(c[0])).filter((sql) => /^DELETE FROM/.test(sql));
    expect(deletes).not.toContain('DELETE FROM price_cache');
    expect(deletes).not.toContain('DELETE FROM asset_chart_cache');
    expect(deletes).not.toContain('DELETE FROM analytics_snapshots');
  });
});

describe('POST /api/state/import — interest', () => {
  const month = (m: string) => ({ month: m, amount: 100 });

  test('clears the whole table, not one currency at a time', async () => {
    // `DELETE ... WHERE currency = 'BRL'` then `... 'USD'` replaced those two and
    // left every other currency in place, so a row in a third currency survived
    // every restore - silently, and in contradiction of the endpoint's own
    // documented contract. A wholesale DELETE is what "replaces" means.
    const { status } = await restore({ interestReaisMonths: [month('2026-01')], interestDollarsMonths: [month('2026-02')] });

    expect(status).toBe(200);
    expect(deletedFrom).toContain('interest');
    // Exactly one delete, and it is unqualified.
    expect(deletedFrom.filter((d) => d.startsWith('interest'))).toEqual(['interest']);
  });

  test('restores both currencies from one payload', async () => {
    await restore({ interestReaisMonths: [month('2026-01')], interestDollarsMonths: [month('2026-02')] });

    expect(interest).toHaveLength(2);
    expect(interest.map((r) => r.currency).sort()).toEqual(['BRL', 'USD']);
  });

  test('a BRL-only payload still clears the table', async () => {
    // The two keys are halves of one table. Clearing conditionally per currency
    // would let a payload carrying only BRL months leave USD rows behind, which
    // is the same class of silent survivor as the third-currency case.
    await restore({ interestReaisMonths: [month('2026-01')] });

    expect(deletedFrom).toContain('interest');
    expect(interest).toHaveLength(1);
    expect(interest[0].currency).toBe('BRL');
  });

  test('a payload with neither key leaves interest alone', async () => {
    await restore({ trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }] });

    expect(deletedFrom.filter((d) => d.startsWith('interest'))).toEqual([]);
  });

  test('every restored month shares one created_at', async () => {
    // Read once per restore rather than per row: a per-row Date.now() drifts by a
    // millisecond each iteration, which makes the rows' provenance unorderable.
    await restore({ interestReaisMonths: [month('2026-01'), month('2026-02'), month('2026-03')] });

    expect(new Set(interest.map((r) => r.created_at)).size).toBe(1);
  });

  test('an empty array clears the table, which is what restoring nothing means', async () => {
    const { status } = await restore({ interestReaisMonths: [], interestDollarsMonths: [] });

    expect(status).toBe(200);
    expect(deletedFrom).toContain('interest');
    expect(interest).toHaveLength(0);
  });
});

describe('POST /api/state/import — atomicity', () => {
  test('one failing row rolls the entire restore back', async () => {
    // The point of the transaction. A restore is the operation that must not
    // half-apply: a partial import leaves the database holding some tables from
    // the backup and others from before it, which is a state no export can
    // reproduce and no user can reason about.
    //
    // `transaction` here snapshots and restores, so this asserts a real rollback.
    // The old fake ignored `ROLLBACK` and never undid anything, which is what
    // made this untestable against it.
    mockedRunSync.mockImplementationOnce(() => {
      throw new Error('trades table locked');
    });

    const { status } = await restore({
      trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }],
      history: [historyRow()],
      interestReaisMonths: [{ month: '2026-01', amount: 100 }],
    });

    expect(status).toBe(500);
    expect(trades).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
    expect(interest).toHaveLength(0);
    // Even the deletes are undone: the snapshot is taken before the first one.
    expect(deletedFrom).toEqual([]);
  });

  test('the whole restore is a single transaction', async () => {
    await restore({ trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }] });

    // Not one transaction per table: one for the restore. Nine separate ones
    // would each be atomic alone, and the restore would not be.
    expect(mockedTransaction).toHaveBeenCalledTimes(1);
  });

  test('the error that caused a rollback is the one that surfaces', async () => {
    // The hand-rolled version had `await run('ROLLBACK')` inside the catch, so a
    // failure *of the rollback* replaced the original error - and the log then
    // described a transaction problem instead of the actual cause. `transaction()`
    // rolls back through the driver and rethrows what the body threw.
    mockedRunSync.mockImplementationOnce(() => {
      throw new Error('the real cause');
    });

    const { status } = await restore({
      trades: [{ id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' }],
    });

    expect(status).toBe(500);
    expect(trades).toHaveLength(0);
  });
});

describe('POST /api/state/import — a malformed payload is refused, not attempted', () => {
  const goodTrade = { id: 't-1', symbol: 'BTC', side: 'buy', qty: 1, price: 1, time: '2026-01-01T00:00:00.000Z' };

  test('a bad row answers 400 naming the table, the index and the field', async () => {
    // This used to be a 500 with the body `{ error: "Failed to import state" }`:
    // the file was the problem, and a client cannot tell that apart from a broken
    // server. It also named nothing, so restoring a backup — a recovery
    // operation — produced one useless message per attempt.
    const { status, body } = await restore({ trades: [{ ...goodTrade, id: 't-1', qty: undefined }] });

    expect(status).toBe(400);
    expect(body.error).toBe('Import payload is not a valid backup');
    expect(body.problems).toEqual([{ table: 'trades', index: 0, reason: '`qty` must be a finite number' }]);
    expect(body.omitted).toBe(0);
  });

  test('nothing is written and no table is deleted: validation runs before the transaction', async () => {
    // The order is the assertion. Validating inside the transaction would still
    // roll back, but it would open one to find out — and the guard that matters is
    // that `mockedTransaction` was never called at all.
    await restore({ trades: [{ ...goodTrade, id: 't-1', symbol: undefined }] });

    expect(mockedTransaction).not.toHaveBeenCalled();
    expect(mockedRunSync).not.toHaveBeenCalled();
    expect(deletedFrom).toEqual([]);
  });

  test('every bad row is reported in one response, not just the first', async () => {
    const { status, body } = await restore({
      trades: [
        { ...goodTrade, id: 't-1', qty: undefined },
        { ...goodTrade, id: 't-2', symbol: undefined },
      ],
      priceCache: [{ symbol: 'BTC', price: null }],
    });

    expect(status).toBe(400);
    expect((body.problems as Array<{ table: string; index: number }>).map((p) => `${p.table}[${p.index}]`)).toEqual([
      'trades[0]',
      'trades[1]',
      'priceCache[0]',
    ]);
  });

  test('a key that is present but not an array is refused rather than silently ignored', async () => {
    // Every table is guarded by `Array.isArray(payload[key])` and left untouched
    // otherwise — right for a partial backup, wrong for a typo. `{"trades": {}}`
    // used to restore everything except the trades and report success.
    const { status, body } = await restore({ trades: {}, history: [historyRow()] });

    expect(status).toBe(400);
    expect(body.problems).toEqual([{ table: 'trades', index: null, reason: 'must be an array' }]);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  test('a body that is not an object is refused', async () => {
    const { status, body } = await restore(['not', 'a', 'backup']);

    expect(status).toBe(400);
    expect(body.problems).toEqual([{ table: '(payload)', index: null, reason: 'must be a JSON object' }]);
  });

  test('the overflow count is reported so a capped list never reads as complete', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...goodTrade, id: `t-${i}`, qty: undefined }));
    const { status, body } = await restore({ trades: rows });

    expect(status).toBe(400);
    expect(body.problems).toHaveLength(20);
    expect(body.omitted).toBe(20);
  });

  test('a row that would restore silently wrong is refused, not written', async () => {
    // A null `price_cache.price` is accepted by the database and leaves the symbol
    // valuing at zero until the worker's next fetch, with nothing to indicate a
    // restore caused it. This is the class that reported success.
    const { status, body } = await restore({ priceCache: [{ symbol: 'BTC', price: null, ts: 1 }] });

    expect(status).toBe(400);
    expect(body.problems).toEqual([{ table: 'priceCache', index: 0, reason: '`price` must be a finite number' }]);
    expect(mockedRunSync).not.toHaveBeenCalled();
  });

  test('a duplicate month is refused: `INSERT OR REPLACE` would drop a month of income', async () => {
    // `idx_interest_month_currency` is unique, and the write replaces rather than
    // errors — so the constraint never fires and the second row silently
    // overwrites the first.
    const { status, body } = await restore({
      interestReaisMonths: [
        { month: '2026-01', amount: 100 },
        { month: '2026-01', amount: 250 },
      ],
    });

    expect(status).toBe(400);
    expect(body.problems[0].table).toBe('interestReaisMonths');
    expect(body.problems[0].index).toBe(1);
    expect(interest).toHaveLength(0);
  });

  test('a well-formed payload is still a 200', async () => {
    // The guard against over-rejecting: a file the exporter itself produced has to
    // keep importing, or the validation has broken the only backup path there is.
    const { status, body } = await restore({
      trades: [goodTrade],
      history: [historyRow()],
      interestReaisMonths: [{ month: '2026-01', amount: 100 }],
      interestDollarsMonths: [{ month: '2026-01', amount: 5 }],
      cashEntries: [{ id: 'c-1', currency: 'USD', amount: 10, description: '', ts: 1 }],
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(trades).toHaveLength(1);
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
