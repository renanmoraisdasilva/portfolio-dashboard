import express from 'express';
import { all, get, runSync, getSync, transaction } from '../db';
import { tradesRouter } from './trades';

vi.mock('../db', () => ({
  all: vi.fn(),
  get: vi.fn(),
  runSync: vi.fn(),
  getSync: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../services/historyManager', () => ({ computeAndInsertHistoryPoint: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/priceFetcher', () => ({ refreshPrices: vi.fn().mockResolvedValue(undefined) }));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;
const mockedGet = get as unknown as ReturnType<typeof vi.fn>;
const mockedRunSync = runSync as unknown as ReturnType<typeof vi.fn>;
const mockedGetSync = getSync as unknown as ReturnType<typeof vi.fn>;
const mockedTransaction = transaction as unknown as ReturnType<typeof vi.fn>;

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

let tables: { trades: StubTradeRow[]; cash: StubCashRow[] };

type Bind = string | number | null;
const binds = (params: unknown[]): Bind[] => params as Bind[];

const at = <T>(params: Bind[], index: number): T => params[index] as T;

function implementDb(): void {
  mockedTransaction.mockImplementation((fn: () => unknown) => {
    const backup = { trades: [...tables.trades], cash: [...tables.cash] };
    try {
      return fn();
    } catch (err) {
      tables = backup;
      throw err;
    }
  });

  mockedRunSync.mockImplementation((sql: string, rawParams: unknown[] = []) => {
    const params = binds(rawParams);

    const cashInsert = /^INSERT INTO cash/.exec(sql);
    if (cashInsert) {
      tables.cash.push({
        id: at<string>(params, 0),
        currency: at<string>(params, 1),
        amount: at<number>(params, 2),
        description: at<string>(params, 3),
        ts: at<number>(params, 4),
      });
      return;
    }
    const cashDelete = /^DELETE FROM cash/.exec(sql);
    if (cashDelete) {
      tables.cash = tables.cash.filter((c) => c.id !== at<string>(params, 0));
      return;
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
      return;
    }
    const tradeDelete = /^DELETE FROM trades/.exec(sql);
    if (tradeDelete) {
      tables.trades = tables.trades.filter((t) => t.id !== at<string>(params, 0));
      return;
    }
    throw new Error(`unhandled SQL in the stub: ${sql}`);
  });

  mockedGetSync.mockImplementation((sql: string, rawParams: unknown[] = []) => {
    const params = binds(rawParams);
    const id = at<string>(params, 0);
    const byId = /^SELECT \* FROM cash WHERE id/.exec(sql);
    if (byId) return tables.cash.find((c) => c.id === id);
    const link = /^SELECT cash_entry_id FROM trades/.exec(sql);
    if (link) return tables.trades.find((t) => t.id === id);
    const trade = /^SELECT \* FROM trades WHERE id/.exec(sql);
    if (trade) return tables.trades.find((t) => t.id === id);
    return undefined;
  });

  mockedGet.mockImplementation((sql: string, rawParams: unknown[] = []) => {
    const params = binds(rawParams);
    const id = at<string>(params, 0);
    if (/^SELECT \* FROM cash WHERE id/.exec(sql)) return Promise.resolve(tables.cash.find((c) => c.id === id));
    if (/^SELECT \* FROM trades WHERE id/.exec(sql)) return Promise.resolve(tables.trades.find((t) => t.id === id));
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
  mockedRunSync.mockReset();
  mockedGetSync.mockReset();
  mockedTransaction.mockReset();
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
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  test('a currency mismatch is a 409, which is what the client is documented to handle', async () => {
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
    mockedRunSync.mockImplementationOnce(() => undefined); // the cash INSERT
    mockedRunSync.mockImplementationOnce(() => {
      throw new Error('trades table locked');
    });

    const { status } = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    expect(status).toBe(500);
    expect(tables.trades).toHaveLength(0);
    expect(tables.cash).toHaveLength(1);
    expect(cashTotal('USD')).toBe(5_000);
  });

  test('both writes happen inside one transaction', async () => {
    await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    expect(mockedTransaction).toHaveBeenCalledTimes(1);

    const written = mockedRunSync.mock.calls.map((c) => String(c[0]));
    expect(written.some((s) => /^INSERT INTO cash/.test(s))).toBe(true);
    expect(written.some((s) => /^INSERT INTO trades/.test(s))).toBe(true);
    expect(mockedGetSync.mock.calls.some((c) => /^SELECT \* FROM trades WHERE id/.test(String(c[0])))).toBe(true);
  });

  test('a failed trade INSERT rolls back rather than committing', async () => {
    mockedRunSync.mockImplementationOnce(() => undefined); // the cash INSERT
    mockedRunSync.mockImplementationOnce(() => {
      throw new Error('trades table locked');
    });

    const { status } = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });

    expect(status).toBe(500);
    expect(tables.trades).toHaveLength(0);
    expect(tables.cash).toHaveLength(1);
  });
});

describe('DELETE /api/trades/:id', () => {
  test('reverses the cash movement the trade created', async () => {
    const created = await call('post', '/', { symbol: 'BTC', side: 'buy', qty: 0.1, price: 50_000 });
    expect(cashTotal('USD')).toBe(0); // 5,000 opening less 5,000 for the trade

    const { status } = await call('delete', `/${created.body.trade.id}`);

    expect(status).toBe(204);
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
    mockedRunSync.mockImplementationOnce(() => undefined); // DELETE FROM trades
    mockedRunSync.mockImplementationOnce(() => {
      throw new Error('cash table locked');
    });

    const { status } = await call('delete', `/${created.body.trade.id}`);

    expect(status).toBe(500);
    expect(tables.trades).toHaveLength(1);
    expect(cashTotal('USD')).toBe(0); // the buy's -5,000 is still applied
  });
});
