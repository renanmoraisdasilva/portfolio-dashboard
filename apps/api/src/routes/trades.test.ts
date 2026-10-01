import express from 'express';
import { all, get, run } from '../db';
import { tradesRouter } from './trades';

/**
 * `POST /api/trades` writes a cash movement for every trade. `DELETE` used to
 * remove only the trade, so a deleted trade's proceeds stayed in the balance
 * forever — cash, `invested` and `total` were each inflated by the sale amount
 * and never came back down. `trades.cash_entry_id` closes that; these tests pin
 * the behaviour, because a regression here is silent and permanent: the numbers
 * are wrong, and nothing throws.
 */
vi.mock('../db', () => ({ all: vi.fn(), get: vi.fn(), run: vi.fn() }));
vi.mock('../services/historyManager', () => ({ computeAndInsertHistoryPoint: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/priceFetcher', () => ({ refreshPrices: vi.fn().mockResolvedValue(undefined) }));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;
const mockedGet = get as unknown as ReturnType<typeof vi.fn>;
const mockedRun = run as unknown as ReturnType<typeof vi.fn>;

interface StubCashRow {
  id: string;
  currency: string;
  amount: number;
  description: string;
  ts: number;
}

interface StubTradeRow {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  price: number | null;
  time: string;
  cash_entry_id: string | null;
}

/** The rows the mocked `db` pretends to hold, keyed by table. */
let tables: { trades: StubTradeRow[]; cash: StubCashRow[] };

/**
 * A SQL bind parameter. Narrowed once here rather than as `any`, so the stub
 * spends none of the repository's `no-explicit-any` budget.
 */
type Bind = string | number | null;
const binds = (params: unknown[]): Bind[] => params as Bind[];

/**
 * Reads the bind parameter at `index` as the column's type. SQLite's driver
 * hands these over untyped, so the cast happens once, here, instead of at every
 * use and without falling back to `any`.
 */
const at = <T>(params: Bind[], index: number): T => params[index] as T;

/** A tiny in-memory stand-in for the four statements these routes issue. */
function implementDb(): void {
  mockedRun.mockImplementation((sql: string, rawParams: unknown[] = []) => {
    const params = binds(rawParams);
    if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) return Promise.resolve({ changes: 0 });

    const cashInsert = /^INSERT INTO cash/.exec(sql);
    if (cashInsert) {
      tables.cash.push({
        id: at<string>(params, 0),
        currency: at<string>(params, 1),
        amount: at<number>(params, 2),
        description: at<string>(params, 3),
        ts: at<number>(params, 4),
      });
      return Promise.resolve({ changes: 1 });
    }
    const cashDelete = /^DELETE FROM cash/.exec(sql);
    if (cashDelete) {
      const before = tables.cash.length;
      tables.cash = tables.cash.filter((c) => c.id !== at<string>(params, 0));
      return Promise.resolve({ changes: before - tables.cash.length });
    }
    const tradeInsert = /^INSERT INTO trades/.exec(sql);
    if (tradeInsert) {
      tables.trades.push({
        id: at<string>(params, 0),
        symbol: at<string>(params, 1),
        side: at<string>(params, 2),
        qty: at<number>(params, 3),
        price: at<number | null>(params, 4),
        time: at<string>(params, 5),
        cash_entry_id: at<string | null>(params, 6) ?? null,
      });
      return Promise.resolve({ changes: 1 });
    }
    const tradeDelete = /^DELETE FROM trades/.exec(sql);
    if (tradeDelete) {
      const before = tables.trades.length;
      tables.trades = tables.trades.filter((t) => t.id !== at<string>(params, 0));
      return Promise.resolve({ changes: before - tables.trades.length });
    }
    throw new Error(`unhandled SQL in the stub: ${sql}`);
  });

  mockedGet.mockImplementation((sql: string, rawParams: unknown[] = []) => {
    const params = binds(rawParams);
    const id = at<string>(params, 0);
    const byId = /^SELECT \* FROM cash WHERE id/.exec(sql);
    if (byId) return Promise.resolve(tables.cash.find((c) => c.id === id));
    const link = /^SELECT cash_entry_id FROM trades/.exec(sql);
    if (link) return Promise.resolve(tables.trades.find((t) => t.id === id) ?? undefined);
    const trade = /^SELECT \* FROM trades WHERE id/.exec(sql);
    if (trade) return Promise.resolve(tables.trades.find((t) => t.id === id));
    return Promise.resolve(undefined);
  });

  mockedAll.mockImplementation((sql: string) => {
    if (sql.includes('FROM trades')) return Promise.resolve([...tables.trades].sort((a, b) => a.time.localeCompare(b.time)));
    if (sql.includes('FROM price_cache')) return Promise.resolve([{ symbol: 'BTC', price: 60_000 }]);
    return Promise.resolve([]);
  });
}

const cashTotal = (currency: string): number =>
  tables.cash.filter((c) => c.currency === currency).reduce((sum, c) => sum + c.amount, 0);

async function call(method: 'post' | 'delete', path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/trades', tradesRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/trades${path}`, {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  tables = {
    trades: [],
    cash: [{ id: 'manual-1', currency: 'USD', amount: 5_000, description: 'Opening balance', ts: 1 }],
  };
  mockedRun.mockReset();
  mockedGet.mockReset();
  mockedAll.mockReset();
  implementDb();
});

describe('POST /api/trades', () => {
  test('records the cash entry it created on the trade', async () => {
    const { status, body } = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    expect(status).toBe(201);
    expect(body.cashEntry).toBeTruthy();
    expect(body.trade.cash_entry_id).toBe(body.cashEntry.id);
    expect(cashTotal('USD')).toBe(5_000 - 5_000);
  });

  test('a BRL-denominated buy draws down the BRL balance, not the USD one', async () => {
    await call('post', '/', { symbol: 'BOVA11', side: 'buy', qty: 10, price: 178.78, cashSource: 'BRL' });

    expect(cashTotal('BRL')).toBe(-1_787.8);
    expect(cashTotal('USD')).toBe(5_000);
  });

  test('rejects a sell with no price, and writes nothing', async () => {
    const { status } = await call('post', '/', { symbol: 'BTC', side: 'sell', qty: 0.1 });

    expect(status).toBe(400);
    expect(tables.trades).toHaveLength(0);
    expect(tables.cash).toHaveLength(1);
    // Validation runs before BEGIN, so a rejected request must not open one.
    const statements = mockedRun.mock.calls.map((c) => String(c[0]));
    expect(statements).not.toContain('BEGIN TRANSACTION');
  });

  test('a currency mismatch is a 409, which is what the client is documented to handle', async () => {
    // This was `error.includes('currency') ? 409 : 400`, and the message is
    // "Asset BOVA11 uses BRL, but USD selected as cash source" - no "currency"
    // in it, so the 409 could never fire and `ApiError.isConflict` was dead.
    const { status, body } = await call('post', '/', {
      symbol: 'BOVA11',
      side: 'buy',
      qty: 1,
      price: 100,
      cashSource: 'USD',
    });

    expect(status).toBe(409);
    expect(body.error).toContain('uses BRL');
    expect(tables.trades).toHaveLength(0);
    expect(tables.cash).toHaveLength(1);
  });

  test('a failing trade INSERT leaves no cash row behind', async () => {
    // The POST handler had no transaction while DELETE had one, so a throw from
    // the `trades` INSERT - and every one of its NOT NULL columns can throw -
    // stranded the cash entry the handler had already written. Same defect class
    // as the deleted-trade leak, and permanent: nothing reverses it.
    mockedRun.mockImplementationOnce(() => Promise.reject(new Error('trades table locked')));

    const { status } = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    expect(status).toBe(500);
    expect(tables.trades).toHaveLength(0);
    // Only the opening balance is left; the trade's own movement is not.
    expect(tables.cash).toHaveLength(1);
    expect(cashTotal('USD')).toBe(5_000);
  });

  test('both writes sit between one BEGIN and one COMMIT', async () => {
    // The failure test above proves the rollback happens; this pins *where* the
    // transaction opens, which is the other half. A BEGIN issued after the cash
    // INSERT — or a missing one — leaves the same stranded row while still
    // passing any test that only checks the error path.
    await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    const statements = mockedRun.mock.calls.map((c) => String(c[0]));
    const begin = statements.indexOf('BEGIN TRANSACTION');
    const cash = statements.findIndex((s) => /^INSERT INTO cash/.test(s));
    const trade = statements.findIndex((s) => /^INSERT INTO trades/.test(s));
    const commit = statements.indexOf('COMMIT');

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(cash);
    expect(cash).toBeLessThan(trade);
    expect(trade).toBeLessThan(commit);
    expect(statements).not.toContain('ROLLBACK');
  });

  test('a failed trade INSERT rolls back rather than committing', async () => {
    // Paired with the ordering test: it is not enough for the statements to be
    // bracketed, the COMMIT must not run when the trade INSERT throws.
    mockedRun.mockImplementationOnce(() => Promise.resolve({ changes: 1 })); // BEGIN
    mockedRun.mockImplementationOnce(() => Promise.resolve({ changes: 1 })); // cash INSERT
    mockedRun.mockImplementationOnce(() => Promise.reject(new Error('trades table locked'))); // trade INSERT

    const { status } = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    expect(status).toBe(500);
    const statements = mockedRun.mock.calls.map((c) => String(c[0]));
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });
});

describe('DELETE /api/trades/:id', () => {
  test('reverses the cash movement the trade created', async () => {
    const created = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });
    expect(cashTotal('USD')).toBe(0); // 5,000 opening less 5,000 for the trade

    const { status } = await call('delete', `/${created.body.trade.id}`);

    expect(status).toBe(204);
    // The bug this closes: the -5,000 stayed behind and the balance read 0 forever.
    expect(cashTotal('USD')).toBe(5_000);
    expect(tables.cash.filter((c) => c.id === created.body.cashEntry.id)).toHaveLength(0);
  });

  test('a sale returns its proceeds instead of stranding them', async () => {
    await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 1, price: 10_000 });
    const sale = await call('post', '/', { symbol: 'BTC', side: 'sell', qty: 1, price: 12_000 });
    expect(cashTotal('USD')).toBe(7_000); // 5,000 - 10,000 + 12,000

    await call('delete', `/${sale.body.trade.id}`);

    expect(cashTotal('USD')).toBe(-5_000);
  });

  test('deleting both legs of a buy and a sale returns the balance to where it started', async () => {
    const start = cashTotal('USD');
    const buy = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 1, price: 10_000 });
    const sale = await call('post', '/', { symbol: 'BTC', side: 'sell', qty: 1, price: 12_000 });

    await call('delete', `/${sale.body.trade.id}`);
    await call('delete', `/${buy.body.trade.id}`);

    expect(cashTotal('USD')).toBe(start);
    expect(tables.cash).toHaveLength(1);
  });

  test('leaves hand-entered cash alone', async () => {
    const created = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    await call('delete', `/${created.body.trade.id}`);

    expect(tables.cash.some((c) => c.id === 'manual-1')).toBe(true);
  });

  test('a trade with no cash entry of its own deletes cleanly and reverses nothing', async () => {
    // The shape the fixture import and pre-column backups produce.
    tables.trades.push({
      id: 'imported-1',
      symbol: 'BTC',
      side: 'buy',
      qty: 1,
      price: 100,
      time: '2026-01-01T00:00:00.000Z',
      cash_entry_id: null,
    });

    const { status } = await call('delete', '/imported-1');

    expect(status).toBe(204);
    expect(tables.trades).toHaveLength(0);
    expect(cashTotal('USD')).toBe(5_000); // untouched
  });

  test('deleting an id that does not exist is a no-op, not a 500', async () => {
    const { status } = await call('delete', '/no-such-trade');
    expect(status).toBe(204);
  });

  test('the whole reversal is one transaction, so a failure cannot half-apply it', async () => {
    const created = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });
    mockedRun.mockImplementationOnce(() => Promise.reject(new Error('cash table locked')));

    const { status } = await call('delete', `/${created.body.trade.id}`);

    expect(status).toBe(500);
    // The trade delete is rolled back with it: the trade and its cash entry must
    // never disagree about whether the money moved.
    expect(tables.trades).toHaveLength(1);
  });
});
