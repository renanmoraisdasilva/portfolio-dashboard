import express from 'express';
import { all, get } from '../db';
import { portfolioRouter } from './portfolio';

vi.mock('../db', () => ({ all: vi.fn(), get: vi.fn() }));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;
const mockedGet = get as unknown as ReturnType<typeof vi.fn>;

const trade = (
  over: Partial<{ symbol: string; side: string; qty: number; price: number | null; profit: number | null }> = {},
) => ({
  symbol: 'BTC',
  side: 'buy',
  qty: 0.5,
  price: 50_000,
  profit: null,
  ...over,
});

const PRICE_ROWS = [
  { symbol: 'BTC', price: 60_000, meta: null },
  { symbol: 'BOVA11', price: 170, meta: null },
  { symbol: 'BOVB11', price: 0.6, meta: JSON.stringify({ priceBRL: 2.5 }) },
  { symbol: 'BRLUSD', price: 0.2, meta: null },
];

function stubDatabase(overrides: { trades?: unknown[]; cash?: unknown; interest?: Record<string, number> } = {}): void {
  mockedAll.mockImplementation((sql: string) => {
    if (sql.includes('FROM trades')) return Promise.resolve(overrides.trades ?? [trade()]);
    if (sql.includes('FROM price_cache')) return Promise.resolve(PRICE_ROWS);
    return Promise.resolve([]);
  });
  mockedGet.mockImplementation((sql: string) => {
    if (sql.includes('FROM cash')) {
      return Promise.resolve(overrides.cash ?? { cashReais: 1_000, cashDollars: 2_000 });
    }
    if (sql.includes('currency = ?')) {
      const currency = mockedGet.mock.calls.at(-1)?.[1]?.[0] as string | undefined;
      return Promise.resolve({ total: overrides.interest?.[currency ?? 'BRL'] ?? 0 });
    }
    return Promise.resolve(undefined);
  });
}

async function requestValuation(query = ''): Promise<{ status: number; body: any }> {
  const app = express();
  app.use('/api/portfolio', portfolioRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/portfolio/valuation${query}`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  mockedAll.mockReset();
  mockedGet.mockReset();
  stubDatabase();
});

describe('GET /api/portfolio/valuation', () => {
  test('values the holdings and reports the totals the dashboard renders', async () => {
    const { status, body } = await requestValuation();

    expect(status).toBe(200);
    expect(body.total).toBeCloseTo(30_000 + 200 + 2_000, 6);
    expect(body.invested).toBeCloseTo(25_000 + 200 + 2_000, 6);
    expect(body.unrealized).toBeCloseTo(5_000, 6);
    expect(body.positions.BTC).toBe(0.5);
    expect(body.brlUsdRate).toBe(0.2);
  });

  test('realized P/L is interest only, because trades.profit no longer exists', async () => {
    stubDatabase({ trades: [trade({ side: 'sell', qty: 0.1, price: 70_000 })], interest: { BRL: 100, USD: 20 } });

    const { body } = await requestValuation();
    expect(body.realized).toBeCloseTo(40, 6);
    expect(body.salesCount).toBe(1);
  });

  test('a BRL position is converted once, and its row is reported in BRL', async () => {
    stubDatabase({ trades: [trade({ symbol: 'BOVA11', qty: 100, price: 150 })] });

    const { body } = await requestValuation();
    const row = body.rows.find((r: { symbol: string }) => r.symbol === 'BOVA11');

    expect(row.valueCurrency).toBe('BRL');
    expect(row.value).toBeCloseTo(17_000, 6);
    expect(row.pl).toBeCloseTo(2_000, 6);
    expect(body.total).toBeCloseTo(3_400 + 200 + 2_000, 6);
  });

  test('a bond would be quoted in BRL from its price metadata', async () => {
    const { SYMBOLS } = await import('../config/symbols');
    expect(Object.values(SYMBOLS).filter((s) => s.type === 'bond')).toEqual([]);

    const { status, body } = await requestValuation();
    expect(status).toBe(200);
    expect(body.rows.every((r: { quotedInBrl?: boolean }) => r.quotedInBrl === undefined)).toBe(true);
  });

  test('an unreadable price-cache entry is tolerated, and a missing rate falls back to 1:1', async () => {
    mockedAll.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([trade()]);
      if (sql.includes('FROM price_cache')) {
        return Promise.resolve([{ symbol: 'BTC', price: 60_000, meta: 'not json at all' }]);
      }
      return Promise.resolve([]);
    });

    const { status, body } = await requestValuation();
    expect(status).toBe(200);
    expect(body.brlUsdRate).toBe(1);
    expect(body.total).toBeCloseTo(30_000 + 1_000 + 2_000, 6);
  });

  test('the BRL cash row is valued in USD but reports its P/L in BRL', async () => {
    stubDatabase({ interest: { BRL: 500, USD: 25 } });

    const { body } = await requestValuation();
    const row = body.rows.find((r: { kind: string }) => r.kind === 'brl-cash');

    expect(row.symbol).toBe('BRL (100% CDI)');
    expect(row.valueCurrency).toBe('USD');
    expect(row.value).toBeCloseTo(200, 6);
    expect(row.plCurrency).toBe('BRL');
    expect(row.pl).toBeCloseTo(500, 6);
  });

  test('cash joins the allocation split only when it is asked for', async () => {
    const without = await requestValuation('?cash=investments');
    const with_ = await requestValuation('?cash=with-cash');

    expect(without.body.allocation.map((s: { label: string }) => s.label)).toEqual(['BTC']);
    expect(with_.body.allocation.map((s: { label: string }) => s.label)).toEqual(['BTC', 'BRL', 'Dollar']);
  });

  test('an unreadable price-cache entry does not fail the request', async () => {
    mockedAll.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([trade()]);
      if (sql.includes('FROM price_cache')) {
        return Promise.resolve([
          { symbol: 'BTC', price: 60_000, meta: 'not json at all' },
          { symbol: 'BRLUSD', price: 0.2, meta: null },
        ]);
      }
      return Promise.resolve([]);
    });

    const { status, body } = await requestValuation();
    expect(status).toBe(200);
    expect(body.total).toBeCloseTo(30_000 + 200 + 2_000, 6);
  });

  test('a database failure answers 500 rather than a wrong number', async () => {
    mockedAll.mockRejectedValue(new Error('database is locked'));

    const { status, body } = await requestValuation();
    expect(status).toBe(500);
    expect(body.error).toBe('Failed to compute portfolio valuation');
  });
});
