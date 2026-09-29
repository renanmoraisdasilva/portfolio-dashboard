// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { network, stubNetwork, valuationCalls, type StubRoute } from '../test/networkHarness';

/**
 * The dashboard store, driven against a stubbed API.
 *
 * Before Vitest there was no way to test this file at all: no runner could
 * import a Pinia store, let alone create one. What is worth asserting is the
 * part that is easy to get wrong — which endpoints a refresh depends on, how the
 * server's rows are formatted, and what happens when a call fails. The numbers
 * themselves are the server's job now, so there is nothing to re-derive here
 * and nothing to assert twice.
 */
const SYMBOLS = {
  BTC: { id: 'BTC', name: 'Bitcoin', type: 'crypto' },
  SPY: { id: 'SPY', name: 'S&P 500 ETF', type: 'stock' },
  BRLUSD: { id: 'BRLUSD', name: 'BRL to USD', type: 'currency' },
  BOVA11: { id: 'BOVA11', name: 'Ibovespa', type: 'stock', denominatedInBRL: true },
};

/** The valuation payload `GET /api/portfolio/valuation` returns, trimmed. */
const VALUATION = {
  total: 42_635.13,
  invested: 42_507.89,
  investedNet: 38_548.88,
  realized: 3_959.01,
  unrealized: 127.25,
  unrealizedPct: 0.3,
  tickerValue: 20_283.13,
  investedPct: 47.57,
  breakEven: false,
  salesCount: 0,
  brlUsdRate: 0.196,
  lots: {},
  positions: { BTC: 0.05 },
  rows: [
    {
      symbol: 'BTC',
      kind: 'position',
      qty: 0.05,
      avgCost: 31_428,
      currentPrice: 64_002,
      value: 3_200.1,
      pl: 1_628.1,
      plPct: 103.6,
      valueCurrency: 'USD',
      plCurrency: 'USD',
    },
    {
      symbol: 'BRL (100% CDI)',
      kind: 'brl-cash',
      qty: 12_000,
      avgCost: 0.196,
      currentPrice: 0.196,
      value: 2_352,
      pl: 19_943.92,
      plPct: 166.2,
      valueCurrency: 'USD',
      plCurrency: 'BRL',
    },
  ],
  allocation: [{ label: 'BTC', value: 3_200.1, pct: 100 }],
  plByAsset: [{ symbol: 'BTC', pl: 1_628.1 }],
};

/** A healthy server. A test overrides the one route it cares about. */
function defaultRoutes(): StubRoute[] {
  return [
    {
      match: (p) => p === '/api/config/symbols',
      body: { all: Object.keys(SYMBOLS), detailed: SYMBOLS, currencies: ['BRLUSD'] },
    },
    { match: (p) => p === '/api/prices', body: { BTC: 64_002, SPY: 500, BOVA11: 169.27, BRLUSD: 0.196 } },
    { match: (p) => p === '/api/portfolio/valuation', body: VALUATION },
    { match: (p) => p === '/api/trades', body: [] },
    {
      match: (p) => p === '/api/cash',
      body: { cashReais: 12_000, cashDollars: 20_000, interestReais: 19_943.92, interestDollars: 50 },
    },
    { match: (p) => p === '/api/interest/months', body: [] },
    { match: (p) => p === '/api/history', body: [] },
    { match: (p) => p === '/api/history/ohlc', body: [] },
    { match: (p) => p === '/api/alerts', body: [] },
    { match: (p) => p === '/api/cash/entries', body: [] },
  ];
}

const loadStore = async () => (await import('./dashboard')).useDashboardStore();

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  stubNetwork(defaultRoutes());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('dashboard store — a healthy server', () => {
  test('renders the server-owned valuation rather than deriving it', async () => {
    const store = await loadStore();
    await store.load();

    expect(store.metrics.total).toBe(42_635.13);
    expect(store.metrics.investedNet).toBe(38_548.88);
    expect(store.metrics.realized).toBe(3_959.01);
    expect(store.metrics.salesCount).toBe(0);
    // "Total Invested" is the cost basis, and it has to sit above "Net invested"
    // by exactly the realized figure. It used to render `tickerValue` here, which
    // made the card read $20,283.13 beside a "Net invested" of $38,548.88 - a net
    // figure 190% of the gross one, which cannot both be true.
    expect(store.metrics.invested).toBe(42_507.89);
    expect(store.metrics.invested - store.metrics.investedNet).toBeCloseTo(store.metrics.realized, 6);
    expect(store.metrics.investedShareOfTotal).toBeCloseTo((42_507.89 / 42_635.13) * 100, 6);
    // ...and it is not the server's `investedPct`, which is the share at risk in
    // tickers: a different quantity, separately tested in the shared package.
    expect(store.metrics.investedPct).toBe(47.57);
    expect(store.metrics.investedShareOfTotal).not.toBeCloseTo(store.metrics.investedPct, 1);
    // The legacy table printed position amounts without a thousands separator —
    // `formatMoney` is for the metric cards. What matters here is the sign and
    // the two decimals, so the exact string is pinned to that behaviour.
    expect(store.positionRows).toEqual([
      expect.objectContaining({ symbol: 'BTC', value: '$3200.10', pl: '+$1628.10', plPct: '+103.60%' }),
    ]);
  });

  test('formats the BRL cash row in USD but its P/L in BRL', async () => {
    const store = await loadStore();
    await store.load();

    const row = store.cashPositionRows[0];
    expect(row.symbol).toBe('BRL (100% CDI)');
    // The balance is part of a USD-valued portfolio...
    expect(row.value).toBe('$2352.00');
    expect(row.avg).toBe('$0.1960');
    // ...but the interest earned on it is a BRL amount.
    expect(row.pl).toBe('+R$19943.92');
  });

  test('positions and cash rows are separate lists, as the table renders them', async () => {
    const store = await loadStore();
    await store.load();
    expect(store.positionRows.map((r) => r.symbol)).toEqual(['BTC']);
    expect(store.cashPositionRows.map((r) => r.symbol)).toEqual(['BRL (100% CDI)']);
  });

  test('the allocation slices carry the server percentages, not a local share', async () => {
    const store = await loadStore();
    await store.load();
    expect(store.allocation.labels).toEqual(['BTC']);
    expect(store.allocation.pcts).toEqual([100]);
    // The palette is presentation, so the store still assigns it.
    expect(store.allocation.colors).toHaveLength(1);
  });

  test('asks for the allocation variant the toggle is set to', async () => {
    const store = await loadStore();
    await store.load();
    expect(valuationCalls()[0]).toContain('cash=with-cash');

    store.setAllocationMode('investments');
    await vi.waitFor(() => expect(valuationCalls()).toHaveLength(2));
    expect(valuationCalls()[1]).toContain('cash=investments');
  });

  test('a second click on the same mode does not refetch', async () => {
    const store = await loadStore();
    await store.load();

    store.setAllocationMode('withCash');
    await new Promise((r) => setTimeout(r, 50));

    expect(valuationCalls()).toHaveLength(1);
  });
});

describe('dashboard store — a failing server', () => {
  test('keeps whatever loaded and names the endpoint that failed', async () => {
    stubNetwork(
      defaultRoutes().map((r) =>
        r.match('/api/prices') ? { ...r, status: 500, body: { error: 'price cache unavailable' } } : r,
      ),
    );

    const store = await loadStore();
    await store.load();

    // The valuation is fetched after prices, so it never ran: the page is empty
    // rather than showing a wrong number, and the failure is not swallowed.
    expect(store.priceError).toContain('GET /prices');
    expect(valuationCalls()).toHaveLength(0);
  });

  test('a rejected request (server down) is an ApiError naming the path', async () => {
    network.offline = true;

    const store = await loadStore();
    await store.load();

    // Status 0 means "no response at all", and the message says which call.
    expect(store.priceError).toMatch(/\/(config\/symbols|trades|cash|prices)/);
  });
});
