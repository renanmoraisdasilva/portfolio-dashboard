vi.mock('../db', () => ({
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
}));

import type { Mock } from 'vitest';
import * as db from '../db';
import { recomputeHistoryAt } from './historyManager';

const mockedDb = db as unknown as {
  run: Mock;
  get: Mock;
  all: Mock;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.run.mockResolvedValue(undefined);
  mockedDb.get.mockResolvedValue(undefined);
  mockedDb.all.mockResolvedValue([]);
});

const tick = (symbol: string, price: number) => ({ symbol, price });

describe('recomputeHistoryAt – error paths', () => {
  test('throws when price_ticks has no data at or before ts', async () => {
    const ts = Date.now();
    mockedDb.all.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([]);
      if (sql.includes('FROM price_ticks')) return Promise.resolve([]);
      if (sql.includes('FROM interest')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mockedDb.get.mockResolvedValue(undefined);

    await expect(recomputeHistoryAt(ts)).rejects.toThrow(/No price_ticks data/);
  });
});

describe('recomputeHistoryAt – cash resolution', () => {
  test('sums cash up to ts for BRL and USD', async () => {
    const ts = Date.now();
    const prices = { BTC: 50000, BRLUSD: 0.2 };

    mockedDb.all.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([]);
      if (sql.includes('FROM price_ticks')) return Promise.resolve(Object.entries(prices).map(([s, p]) => tick(s, p)));
      if (sql.includes('FROM interest')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mockedDb.get.mockImplementation((sql: string) => {
      if (sql.includes('FROM cash')) return Promise.resolve({ cashReais: 500, cashDollars: 100 });
      return Promise.resolve(undefined);
    });

    const result = await recomputeHistoryAt(ts);
    expect(result.v).toBeCloseTo(200);
  });

  test('returns zero cash when no cash rows exist before ts', async () => {
    const ts = Date.now();
    const prices = { BRLUSD: 0.2 };

    mockedDb.all.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([]);
      if (sql.includes('FROM price_ticks')) return Promise.resolve(Object.entries(prices).map(([s, p]) => tick(s, p)));
      if (sql.includes('FROM interest')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mockedDb.get.mockImplementation((sql: string) => {
      if (sql.includes('FROM cash')) return Promise.resolve({ cashReais: 0, cashDollars: 0 });
      return Promise.resolve(undefined);
    });

    const result = await recomputeHistoryAt(ts);
    expect(result.v).toBeCloseTo(0);
  });
});

describe('recomputeHistoryAt – result shape', () => {
  test('returns t (ISO string), ts, v, i, p, brlusd_rate', async () => {
    const ts = 1700000000000;
    const prices = { BRLUSD: 0.2 };

    mockedDb.all.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([]);
      if (sql.includes('FROM price_ticks')) return Promise.resolve(Object.entries(prices).map(([s, p]) => tick(s, p)));
      if (sql.includes('FROM interest')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mockedDb.get.mockResolvedValue(undefined);

    const result = await recomputeHistoryAt(ts);
    expect(result).toMatchObject({
      t: new Date(ts).toISOString(),
      ts,
      v: expect.any(Number),
      i: expect.any(Number),
      p: expect.any(Number),
      brlusd_rate: expect.any(Number),
    });
  });

  test('brlusd_rate in result matches BRLUSD tick price', async () => {
    const ts = Date.now();
    mockedDb.all.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([]);
      if (sql.includes('FROM price_ticks')) return Promise.resolve([tick('BRLUSD', 0.19)]);
      if (sql.includes('FROM interest')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mockedDb.get.mockResolvedValue(undefined);

    const result = await recomputeHistoryAt(ts);
    expect(result.brlusd_rate).toBeCloseTo(0.19);
  });

  test('interest amounts are summed per currency and reduce investedNet', async () => {
    const ts = Date.now();
    const brlusd = 0.2;

    mockedDb.all.mockImplementation((sql: string) => {
      if (sql.includes('FROM trades')) return Promise.resolve([]);
      if (sql.includes('FROM price_ticks')) return Promise.resolve([tick('BRLUSD', brlusd)]);
      if (sql.includes("currency = 'BRL'")) return Promise.resolve([{ amount: 1000 }, { amount: 500 }]);
      if (sql.includes("currency = 'USD'")) return Promise.resolve([{ amount: 200 }]);
      return Promise.resolve([]);
    });
    mockedDb.get.mockResolvedValue(undefined);

    const withInterest = await recomputeHistoryAt(ts);

    expect(withInterest.i).toBeCloseTo(-(1500 * brlusd + 200), 8);
  });
});

describe('recomputeHistoryAt – trade cutoff', () => {
  test('passes ISO cutoff to trades query', async () => {
    const ts = 1700000000000;
    const cutoff = new Date(ts).toISOString();

    mockedDb.all.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('FROM trades')) {
        expect(params).toContain(cutoff);
        return Promise.resolve([]);
      }
      if (sql.includes('FROM price_ticks')) return Promise.resolve([tick('BRLUSD', 0.2)]);
      if (sql.includes('FROM interest')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mockedDb.get.mockResolvedValue(undefined);

    await recomputeHistoryAt(ts);
  });
});
