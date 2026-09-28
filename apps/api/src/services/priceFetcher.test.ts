vi.mock('../db', () => ({
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
}));

vi.mock('./homeAssistantService', () => ({
  sendAlertNotification: vi.fn(),
}));

import type { Mock } from 'vitest';
import * as db from '../db';
import { fetchAndCacheAssetHistory } from './priceFetcher';

const mockedDb = db as unknown as {
  run: Mock;
  get: Mock;
  all: Mock;
};

function makeYahooHistoryResponse() {
  return {
    chart: {
      result: [
        {
          timestamp: [1700000000, 1700086400],
          indicators: { quote: [{ close: [10.5, 11.0] }] },
        },
      ],
    },
  };
}

let originalConsoleWarn: typeof console.warn;

beforeEach(() => {
  vi.clearAllMocks();
  originalConsoleWarn = console.warn;
  console.warn = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as any);
  mockedDb.all.mockResolvedValue([]);
  mockedDb.run.mockResolvedValue(undefined);
  mockedDb.get.mockResolvedValue(undefined);
});

afterEach(() => {
  console.warn = originalConsoleWarn;
});

describe('fetchAndCacheAssetHistory – regular stock symbol', () => {
  test('calls Yahoo Finance and returns price data', async () => {
    mockedDb.get.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeYahooHistoryResponse(),
    } as any);

    const result = await fetchAndCacheAssetHistory('SPY', 30);

    expect(result.labels.length).toBe(2);
    expect(result.prices).toEqual([10.5, 11.0]);
    expect((global.fetch as Mock).mock.calls[0][0]).toMatch(/yahoo/i);
  });
});
