// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { network, stubNetwork, valuationCalls, type StubRoute } from '../test/networkHarness';

const SYMBOLS = {
  BTC: { id: 'BTC', name: 'Bitcoin', type: 'crypto' },
  BOVA11: { id: 'BOVA11', name: 'Ibovespa', type: 'stock', denominatedInBRL: true },
  BRLUSD: { id: 'BRLUSD', name: 'BRL to USD', type: 'currency' },
};

const REAL_BTC_BUY = {
  id: 't1',
  symbol: 'BTC',
  side: 'buy',
  qty: 1,
  price: 10_000,
  time: '2026-01-01T00:00:00.000Z',
};

interface RouteOptions {
  trades?: unknown[];
  scenario?: unknown;
  scenarioStatus?: number;
}

function routes({ trades = [], scenario = {}, scenarioStatus = 200 }: RouteOptions = {}): StubRoute[] {
  return [
    {
      match: (p) => p === '/api/config/symbols',
      body: { all: Object.keys(SYMBOLS), detailed: SYMBOLS, currencies: ['BRLUSD'] },
    },
    {
      match: (p) => p === '/api/prices',
      body: { BTC: 60_000, BOVA11: 120, BRLUSD: 0.2, ts: 1_700_000_000_000, cacheTTLms: 4_800_000 },
    },
    { match: (p) => p === '/api/trades', body: trades },
    { match: (p) => p === '/api/cash', body: { cashReais: 10_000, cashDollars: 100_000 } },
    { match: (p) => p === '/api/scenarios', body: [] },
    { match: (p) => p === '/api/scenarios/{id}', body: scenario, status: scenarioStatus },
  ];
}

const loadStore = async () => {
  const store = (await import('./simulation')).useSimulationStore();
  await store.load();
  return store;
};

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  stubNetwork(routes());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('simulation store — loading real state', () => {
  test('cache metadata never reaches the price map, and the prices seed the scenario', async () => {
    const store = await loadStore();

    expect(store.prices).toEqual({ BTC: 60_000, BOVA11: 120, BRLUSD: 0.2 });
    expect(store.simPrices).toEqual({ BTC: 60_000, BOVA11: 120, BRLUSD: 0.2 });
    expect(store.brlUsdRate).toBe(0.2);
    expect(store.loading).toBe(false);
  });

  test('currencies are not tradeable, and the first tradeable symbol is preselected', async () => {
    const store = await loadStore();

    expect(store.assetList).toEqual(['BTC', 'BOVA11']);
    expect(store.symbol).toBe('BTC');
    expect(store.priceInput).toBe('$60,000.00');
  });

  test('the scenario starts from the real cash balances', async () => {
    const store = await loadStore();

    expect(store.realCash).toEqual({ cashReais: 10_000, cashDollars: 100_000 });
    expect(store.simCashDollars).toBe(100_000);
    expect(store.simCashReais).toBe(10_000);
  });

  test('an offline load fails quietly instead of throwing out of the store', async () => {
    network.offline = true;
    const store = await loadStore();

    expect(store.loading).toBe(false);
    expect(store.simTrades).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('simulation store — hypothetical trades never leave the browser', () => {
  test('a buy moves cash into a position without asking the API for a valuation', async () => {
    const store = await loadStore();

    store.setPriceInput('60000');
    store.setQty('1');
    expect(store.addTrade()).toBeNull();

    expect(store.simTrades).toHaveLength(1);
    expect(store.simCashDollars).toBe(40_000);
    expect(store.portfolio.positions.BTC).toBe(1);
    expect(valuationCalls()).toEqual([]);
  });

  test('buying at the current price neither creates nor destroys value', async () => {
    const store = await loadStore();

    store.setPriceInput('60000');
    store.setQty('1');
    store.addTrade();

    expect(store.metrics.totalValue).toBeCloseTo(102_000, 6);
    expect(store.portfolio.invested).toBeCloseTo(102_000, 6);
    expect(store.metrics.unrealized).toBeCloseTo(0, 6);
    expect(valuationCalls()).toEqual([]);
  });

  test('repricing a held position revalues the portfolio on the spot', async () => {
    const store = await loadStore();
    store.setPriceInput('60000');
    store.setQty('1');
    store.addTrade();

    store.setPricePct('BTC', 50);

    expect(store.simPrices.BTC).toBe(90_000);
    expect(store.simPricePcts.BTC).toBe(50);
    expect(store.metrics.totalValue).toBeCloseTo(132_000, 6);
    expect(store.metrics.unrealized).toBeCloseTo(30_000, 6);
    expect(valuationCalls()).toEqual([]);
  });

  test('a sell realizes against the lot the real history opened', async () => {
    stubNetwork(routes({ trades: [REAL_BTC_BUY] }));
    const store = await loadStore();

    store.setSide('sell');
    store.setPriceInput('60000');
    store.setQty('1');
    expect(store.addTrade()).toBeNull();

    expect(store.metrics.realized).toBeCloseTo(50_000, 6);
    expect(store.metrics.salesCount).toBe(1);
    expect(store.portfolio.positions.BTC).toBe(0);
    expect(store.simCashDollars).toBe(160_000);
    expect(store.metrics.totalValue).toBeCloseTo(162_000, 6);
  });

  test('a buy larger than the scenario cash is refused, and nothing moves', async () => {
    const store = await loadStore();

    store.setPriceInput('60000');
    store.setQty('5');

    expect(store.addTrade()).toBe('Not enough USD cash in scenario');
    expect(store.simTrades).toEqual([]);
    expect(store.simCashDollars).toBe(100_000);
  });
});

describe('simulation store — the trade form', () => {
  test('every refusal reason that precedes a state change', async () => {
    const store = await loadStore();

    store.symbol = '';
    expect(store.addTrade()).toBe('Pick an asset first');

    store.symbol = 'BTC';
    store.qtyInput = '';
    store.totalInput = '';
    expect(store.addTrade()).toBe('Enter valid quantity or total');
    expect(store.simTrades).toEqual([]);
  });

  test('a BRL asset bought from USD cash is converted through the rate', async () => {
    const store = await loadStore();

    store.symbol = 'BOVA11';
    store.setPriceInput('120');
    store.setQty('10');
    expect(store.totalInput).toBe('$240.00');

    expect(store.addTrade()).toBeNull();

    expect(store.simCashDollars).toBe(99_760);
    expect(store.simTrades[0]).toMatchObject({ symbol: 'BOVA11', qty: 10, price: 120, total: 240, currency: 'USD' });
    expect(store.portfolio.positions.BOVA11).toBe(10);
    expect(store.metrics.totalValue).toBeCloseTo(102_000, 6);
  });

  test('a BRL price is recorded in reais, with its percentage against the base', async () => {
    const store = await loadStore();

    store.setPrice('BOVA11', '150');

    expect(store.simPrices.BOVA11).toBe(150);
    expect(store.simPricePcts.BOVA11).toBe(25);
    expect(store.displayPctText('BOVA11')).toBe('+25%');
  });

  test('the percentage slider sizes a buy from the available cash', async () => {
    const store = await loadStore();

    store.setQtyPct(50);

    expect(store.qtyInput).toBe('0.8333');
    expect(store.totalInput).toBe('$49,998.00');
  });

  test('the percentage slider sizes a sell from the open position, not from cash', async () => {
    const store = await loadStore();
    store.setSide('sell');

    store.setQtyPct(100);

    expect(store.qtyInput).toBe('0');
    expect(store.totalInput).toBe('');
  });
});

describe('simulation store — clearing the scenario', () => {
  const buyOneBtc = async () => {
    const store = await loadStore();
    store.setPriceInput('60000');
    store.setQty('1');
    store.addTrade();
    store.setPricePct('BTC', 50);
    return store;
  };

  test('clearTrades returns the cash but keeps the price overrides', async () => {
    const store = await buyOneBtc();

    store.clearTrades();

    expect(store.simTrades).toEqual([]);
    expect(store.simCashDollars).toBe(100_000);
    expect(store.simCashReais).toBe(10_000);
    expect(store.simPrices.BTC).toBe(90_000);
  });

  test('reset puts every knob back to the real portfolio', async () => {
    const store = await buyOneBtc();

    store.reset();

    expect(store.simTrades).toEqual([]);
    expect(store.simCashDollars).toBe(100_000);
    expect(store.simCashReais).toBe(10_000);
    expect(store.simPrices.BTC).toBe(60_000);
    expect(store.simPricePcts).toEqual({ BRLUSD: 0 });
    expect(store.brlUsdRate).toBe(0.2);
    expect(store.metrics.totalValue).toBeCloseTo(102_000, 6);
  });
});

describe('simulation store — scenarios', () => {
  test('a scenario cannot be saved without a name', async () => {
    const store = await loadStore();
    store.saveModalOpen = true;
    const callsBefore = network.calls.length;

    expect(await store.confirmSaveScenario()).toBe('Please enter a scenario name');
    expect(store.saveModalOpen).toBe(true);
    expect(network.calls.length).toBe(callsBefore);
  });

  test('saving posts the payload, refreshes the list and closes the modal', async () => {
    const store = await loadStore();
    store.saveModalOpen = true;
    store.scenarioName = 'Beach house';

    expect(await store.confirmSaveScenario()).toBe('Scenario saved');

    expect(network.calls).toContain('/api/scenarios');
    expect(store.scenarios).toEqual([]);
    expect(store.saveModalOpen).toBe(false);
  });

  test('loading a scenario applies its prices, trades, cash and FX rate', async () => {
    stubNetwork(
      routes({
        scenario: {
          name: 'Beach house',
          data: {
            version: 1,
            simPrices: { BTC: 45_000, BOVA11: 120, BRLUSD: 0.25 },
            simPricePcts: { BTC: -25 },
            simTrades: [{ symbol: 'BTC', side: 'buy', qty: 0.5, price: 45_000, time: '2026-01-02T00:00:00.000Z' }],
            simCashReais: 500,
            simCashDollars: 250,
          },
        },
      }),
    );
    const store = await loadStore();
    store.openModalOpen = true;

    expect(await store.loadScenario('s1')).toBeNull();

    expect(store.simPrices.BTC).toBe(45_000);
    expect(store.simPricePcts.BTC).toBe(-25);
    expect(store.brlUsdRate).toBe(0.25);
    expect(store.simTrades).toHaveLength(1);
    expect(store.simCashReais).toBe(500);
    expect(store.simCashDollars).toBe(250);
    expect(store.openModalOpen).toBe(false);
  });

  test('a scenario written by a newer version warns rather than failing to load', async () => {
    stubNetwork(routes({ scenario: { name: 'future', data: { version: 99, simCashDollars: 1 } } }));
    const store = await loadStore();

    const warning = await store.loadScenario('s1');

    expect(warning).toContain('newer version');
    expect(store.simCashDollars).toBe(1);
  });

  test('a rejected load reports an error string instead of throwing', async () => {
    stubNetwork(routes({ scenario: { error: 'nope' }, scenarioStatus: 500 }));
    const store = await loadStore();

    expect(await store.loadScenario('s1')).toBe('Failed to load scenario');
    expect(store.openModalOpen).toBe(false);
  });
});
