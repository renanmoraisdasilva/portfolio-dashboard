import express from 'express';
import { get } from '../db';
import { healthRouter } from './health';

jest.mock('../db', () => ({ get: jest.fn() }));

const mockedGet = get as jest.MockedFunction<typeof get>;

async function requestHealth(): Promise<{ status: number; body: any }> {
  const app = express();
  app.use('/api/health', healthRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

describe('GET /api/health', () => {
  beforeEach(() => mockedGet.mockReset());

  test('reports the last price and asset-cache timestamps', async () => {
    mockedGet.mockResolvedValueOnce({ ts: 1000 } as never).mockResolvedValueOnce({ ts: 2000 } as never);
    const { status, body } = await requestHealth();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lastPriceFetch).toBe(1000);
    expect(body.lastAssetHistory).toBe(2000);
  });

  test('reports null when the cache tables are empty', async () => {
    mockedGet.mockResolvedValue(undefined as never);
    const { status, body } = await requestHealth();
    expect(status).toBe(200);
    expect(body.lastPriceFetch).toBeNull();
    expect(body.lastAssetHistory).toBeNull();
  });

  test('answers 503 with ok:false when the database read fails', async () => {
    mockedGet.mockRejectedValueOnce(new Error('database is locked'));
    const { status, body } = await requestHealth();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('database is locked');
  });
});
