import express from 'express';
import { all } from '../db';
import { pricesRouter } from './prices';
import { STALE_AFTER_MS, CACHE_TTL } from '../config/priceFreshness';

vi.mock('../db', () => ({ all: vi.fn() }));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedAll.mockReset();
  mockedAll.mockResolvedValue([]);
});

async function getPrices() {
  const app = express();
  app.use('/api/prices', pricesRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/prices`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe('GET /api/prices — the staleness threshold', () => {
  test('sends exactly the constant the fetcher uses', async () => {
    const { status, body } = await getPrices();

    expect(status).toBe(200);
    expect(body.cacheTTLms).toBe(STALE_AFTER_MS);
  });

  test('is never the fetch cache TTL, which is the bug this endpoint had', async () => {
    const { body } = await getPrices();

    expect(body.cacheTTLms).not.toBe(CACHE_TTL);
    expect(STALE_AFTER_MS).toBeGreaterThan(CACHE_TTL);
  });

  test('is present even with no cached prices at all', async () => {
    const { body } = await getPrices();

    expect(Object.keys(body)).toContain('cacheTTLms');
    expect(body.cacheTTLms).toBe(STALE_AFTER_MS);
  });
});

describe('GET /api/prices — the payload', () => {
  test('one flat entry per cached symbol, with its timestamp and parsed meta', async () => {
    mockedAll.mockResolvedValue([
      { symbol: 'BTC', price: 64_002, ts: 1780147023633, meta: '{"source":"coingecko"}' },
      { symbol: 'SPY', price: 500, ts: 1780147023633, meta: null },
    ]);

    const { body } = await getPrices();

    expect(body.BTC).toBe(64_002);
    expect(body.BTC_ts).toBe(1780147023633);
    expect(body.BTC_meta).toEqual({ source: 'coingecko' });
    expect(body.SPY).toBe(500);
    expect(body).not.toHaveProperty('SPY_meta');
  });

  test('malformed meta is skipped, not fatal', async () => {
    mockedAll.mockResolvedValue([
      { symbol: 'BTC', price: 1, ts: 2, meta: '{not json' },
      { symbol: 'SPY', price: 3, ts: 4, meta: null },
    ]);

    const { status, body } = await getPrices();

    expect(status).toBe(200);
    expect(body).not.toHaveProperty('BTC_meta');
    expect(body.BTC).toBe(1);
    expect(body.SPY).toBe(3);
  });

  test('a database failure is a 500 that names the endpoint', async () => {
    mockedAll.mockRejectedValue(new Error('database is locked'));

    const { status, body } = await getPrices();

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch prices');
  });
});
