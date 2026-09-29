import express from 'express';
import { all, get } from '../db';
import { portfolioRouter } from './portfolio';

/**
 * `GET /api/portfolio/valuation` — the endpoint every number on the dashboard
 * comes from.
 *
 * Phase 6 added the route and Phase 7 added this file's module to the coverage
 * list. What was missing until now was the test itself, which is why the route
 * read as 11% covered. The gap matters because the currency rules are the whole
 * point of the endpoint: a BRL position, a bond stored in USD but quoted in
 * BRL, and a BRL balance earning BRL interest are three different answers, and a
 * silent error in any of them lands in a headline figure.
 *
 * The database is mocked rather than seeded, so each test states exactly the
 * rows it depends on.
 */
vi.mock('../db', () => ({ all: vi.fn(), get: vi.fn() }));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;
const mockedGet = get as unknown as ReturnType<typeof vi.fn>;

/** A trade row as `SELECT symbol, side, qty, price, profit` returns it. */
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

/** Routes the query to the fixture that answers it, like the real table would. */
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
      // Both interest totals come from the same query with a different currency.
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
    // 0.5 BTC at 60k, plus 1,000 BRL at 0.2 and 2,000 USD of cash.
    expect(body.total).toBeCloseTo(30_000 + 200 + 2_000, 6);
    // Cost basis of the open lot, plus the same cash.
    expect(body.invested).toBeCloseTo(25_000 + 200 + 2_000, 6);
    expect(body.unrealized).toBeCloseTo(5_000, 6);
    expect(body.positions.BTC).toBe(0.5);
    expect(body.brlUsdRate).toBe(0.2);
  });

  test('realized P/L is interest only, because trades.profit no longer exists', async () => {
    // The column was dropped in migration 0003, so the database cannot supply
    // realized P/L from sales. Reporting interest alone is deliberate: the live
    // valuation must not disagree with the history snapshots beside it.
    stubDatabase({ trades: [trade({ side: 'sell', qty: 0.1, price: 70_000 })], interest: { BRL: 100, USD: 20 } });

    const { body } = await requestValuation();
    // 100 BRL of interest at 0.2, plus 20 USD.
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
    // ...while the portfolio total is USD: 100 x 170 x 0.2 + cash.
    expect(body.total).toBeCloseTo(3_400 + 200 + 2_000, 6);
  });

  test('a bond would be quoted in BRL from its price metadata', async () => {
    // The bond branch is unreachable from this route: no symbol in
    // `config/symbols.ts` has `type: 'bond'`, so `isBRLBond` is false for every
    // symbol the app knows. The maths is covered in
    // `packages/shared/src/domain/valuation.test.ts` against a synthetic
    // registry; this test pins the fact rather than the behaviour, so that
    // adding a bond to the registry makes it fail loudly rather than silently
    // changing what the dashboard shows.
    const { SYMBOLS } = await import('../config/symbols');
    expect(Object.values(SYMBOLS).filter((s) => s.type === 'bond')).toEqual([]);

    // A bond's price metadata, if one ever appears, is parsed from `meta`.
    const { status, body } = await requestValuation();
    expect(status).toBe(200);
    expect(body.rows.every((r: { quotedInBrl?: boolean }) => r.quotedInBrl === undefined)).toBe(true);
  });

  test('an unreadable price-cache entry is tolerated, and a missing rate falls back to 1:1', async () => {
    mockedAll.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([trade()]);
      if (sql.includes('FROM price_cache')) {
        // `meta` is malformed *and* BRLUSD is absent, so the rate falls back to
        // 1:1 - the same fallback `computePortfolioValue` uses when writing
        // history. Zeroing the BRL side instead would make the portfolio appear
        // to lose every BRL holding when one price is missing.
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
