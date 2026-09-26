jest.mock('../db', () => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
}));

jest.mock('./homeAssistantService', () => ({
  sendAlertNotification: jest.fn(),
}));

import * as db from '../db';
import { refreshPrices, fetchAndCacheAssetHistory } from './priceFetcher';

const mockedDb = db as unknown as {
  run: jest.Mock;
  get: jest.Mock;
  all: jest.Mock;
};

// Helper: build a minimal Yahoo Finance history response
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
  jest.clearAllMocks();
  originalConsoleWarn = console.warn;
  console.warn = jest.fn();
  // Default fetch stub for all tests: no external requests by default.
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 } as any);
  // Reset module-level `running` flag between tests via force=true refresh
  // Default db stubs: empty prices table, no alerts
  mockedDb.all.mockResolvedValue([]);
  mockedDb.run.mockResolvedValue(undefined);
  mockedDb.get.mockResolvedValue(undefined);
});

afterEach(() => {
  console.warn = originalConsoleWarn;
});

// ─── fetchAndCacheAssetHistory ────────────────────────────────────────────────

describe('fetchAndCacheAssetHistory – regular stock symbol', () => {
  test('calls Yahoo Finance and returns price data', async () => {
    mockedDb.get.mockResolvedValue(undefined); // no cache
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeYahooHistoryResponse(),
    } as any);

    const result = await fetchAndCacheAssetHistory('SPY', 30);

    expect(result.labels.length).toBe(2);
    expect(result.prices).toEqual([10.5, 11.0]);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toMatch(/yahoo/i);
  });
});

