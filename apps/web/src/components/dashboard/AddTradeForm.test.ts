// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { formatMoney } from '@portfolio-dashboard/shared';
import { useToast } from '../../composables/useToast';
import { network, stubNetwork, type StubRoute } from '../../test/networkHarness';

/**
 * Component tests for the real-money trade form.
 *
 * The store suite already covers the arithmetic (and, through
 * `packages/shared/domain/tradeForm`, the currency rules in detail); what only
 * a mounted component can catch is the wiring: which field a label promises,
 * which currency a handler parses in, and whether the DOM reflects the store
 * after a click. Each regression below shipped from exactly that gap.
 */

const SYMBOLS = {
  BTC: { id: 'BTC', name: 'Bitcoin', type: 'crypto' },
  SPY: { id: 'SPY', name: 'S&P 500 ETF', type: 'stock' },
  BRLUSD: { id: 'BRLUSD', name: 'BRL to USD', type: 'currency' },
  BOVA11: { id: 'BOVA11', name: 'Ibovespa', type: 'stock', denominatedInBRL: true },
};

function routes(): StubRoute[] {
  return [
    {
      match: (p) => p === '/api/config/symbols',
      body: { all: Object.keys(SYMBOLS), detailed: SYMBOLS, currencies: ['BRLUSD'] },
    },
    { match: (p) => p === '/api/prices', body: { BTC: 64_002, SPY: 500, BOVA11: 169.27, BRLUSD: 0.196 } },
    {
      match: (p) => p === '/api/portfolio/valuation',
      body: {
        total: 42_635.13,
        invested: 42_507.89,
        investedNet: 38_548.88,
        realized: 3_959.01,
        unrealized: 127.25,
        brlUsdRate: 0.196,
        positions: { BTC: 0.05 },
        rows: [],
        allocation: [],
        plByAsset: [],
      },
    },
    { match: (p) => p === '/api/trades', body: [] },
    {
      match: (p) => p === '/api/cash',
      body: { cashReais: 12_000, cashDollars: 20_000, interestReais: 19_943.92, interestDollars: 50 },
    },
    { match: (p) => p === '/api/interest/months', body: [] },
    { match: (p) => p === '/api/history', body: [] },
    { match: (p) => p === '/api/history/ohlc', body: [] },
    { match: (p) => p === '/api/alerts', body: [] },
    { match: (p) => p === '/api/alerts/triggered', body: [] },
    { match: (p) => p === '/api/cash/entries', body: [] },
  ];
}

async function mountForm() {
  const { useDashboardStore } = await import('../../stores/dashboard');
  const store = useDashboardStore();
  await store.load();
  const AddTradeForm = (await import('./AddTradeForm.vue')).default;
  const wrapper = mount(AddTradeForm);
  return { store, wrapper };
}

function findChip(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const chip = wrapper.findAll('button.chip').find((b) => b.text() === text);
  if (!chip) throw new Error(`no chip labelled ${text}`);
  return chip;
}

function priceLabel(wrapper: VueWrapper): string {
  const label = wrapper.findAll('label').find((l) => l.text().startsWith('Price'));
  return label ? label.text() : '<missing>';
}

function toasts() {
  return useToast().toasts;
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  stubNetwork(routes());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('AddTradeForm — the price field', () => {
  test('the label follows the asset currency, and switching symbols re-quotes the field', async () => {
    const { wrapper } = await mountForm();
    expect(priceLabel(wrapper)).toBe('Price (USD)');

    await wrapper.find('select').setValue('BOVA11');
    expect(priceLabel(wrapper)).toBe('Price (R$)');
    expect(wrapper.find<HTMLInputElement>('input[placeholder="0.00"]').element.value).toBe('169.27');

    // Regression: a USD asset used to leave the previous symbol's quote in
    // the field, so every total below it was computed from the wrong price.
    await wrapper.find('select').setValue('SPY');
    expect(priceLabel(wrapper)).toBe('Price (USD)');
    expect(wrapper.find<HTMLInputElement>('input[placeholder="0.00"]').element.value).toBe('500.00');
  });

  test('the stepper edits the quoted price in its own units', async () => {
    const { store, wrapper } = await mountForm();
    await wrapper.find('select').setValue('BOVA11');

    // The two steppers are quantity then price.
    const priceStepper = wrapper.findAll('.stepper')[1];
    await priceStepper.findAll('button')[1].trigger('click');

    expect(store.priceInput).toBe('170.27');
  });
});

describe('AddTradeForm — cash source', () => {
  test('the total placeholder follows the source, and toggling converts what is typed', async () => {
    const { store, wrapper } = await mountForm();
    const total = wrapper.find('input[type="text"]');
    expect(total.attributes('placeholder')).toBe('enter total in USD');

    await total.setValue('1000');
    expect(store.totalInput).toBe(formatMoney(1_000, 'USD'));
    expect(store.qtyInput).toBe(String(+(1_000 / 64_002).toFixed(4)));

    await findChip(wrapper, 'BRL').trigger('click');
    expect(total.attributes('placeholder')).toBe('enter total in BRL');
    expect(store.totalInput).toBe(formatMoney(1_000 / 0.196, 'BRL'));
    expect(store.qtyInput).toBe(String(+(1_000 / 64_002).toFixed(4)));
    expect(findChip(wrapper, 'BRL').classes()).toContain('active');
    expect(findChip(wrapper, 'USD').classes()).not.toContain('active');
  });

  test('available cash is shown per currency, and the side chips are state', async () => {
    const { store, wrapper } = await mountForm();

    expect(wrapper.findAll('b').map((b) => b.text())).toEqual([formatMoney(20_000, 'USD'), formatMoney(12_000, 'BRL')]);

    await findChip(wrapper, 'Sell').trigger('click');
    expect(store.formSide).toBe('sell');
    expect(findChip(wrapper, 'Sell').classes()).toContain('active');
    expect(findChip(wrapper, 'Buy').classes()).not.toContain('active');
  });

  test('the slider and the quantity field are inverses on a BRL asset', async () => {
    const { store, wrapper } = await mountForm();
    await wrapper.find('select').setValue('BOVA11');
    await findChip(wrapper, 'BRL').trigger('click');

    const slider = wrapper.find<HTMLInputElement>('input[type="range"]');
    await slider.setValue('50');
    expect(store.qtyPct).toBe(50);
    expect(store.qtyInput).toBe(String(+(6_000 / 169.27).toFixed(4)));
    expect(store.totalInput).toBe(formatMoney(6_000, 'BRL'));

    // Regression: `pctFromQty` divided a BRL amount by a USD balance, so
    // reading this quantity back as a percentage gave 255 — clamped to 100,
    // and the slider stuck itself at Max on every recomputation.
    await wrapper.find('input[placeholder="0.0000"]').setValue('10');
    expect(store.qtyPct).toBe(14);
    expect(slider.element.value).toBe('14');
    expect(wrapper.text()).toContain('14%');
  });
});

describe('AddTradeForm — submitting', () => {
  test('records the trade, resets the form, and confirms with a toast', async () => {
    const { store, wrapper } = await mountForm();
    await wrapper.find('input[placeholder="0.0000"]').setValue('1');

    await wrapper.find('button.trade-add-btn').trigger('click');
    await flushPromises();

    expect(store.trades).toHaveLength(1);
    expect(store.trades[0]).toMatchObject({ symbol: 'BTC', side: 'buy', qty: 1, price: 64_002 });
    expect(store.qtyInput).toBe('');
    expect(store.totalInput).toBe('');
    expect(store.qtyPct).toBe(0);
    expect(wrapper.find<HTMLInputElement>('input[placeholder="0.00"]').element.value).toBe('');
    expect(toasts().value.some((t) => t.text === 'Trade recorded' && t.kind === 'success')).toBe(true);
  });

  test('an unreachable server surfaces as an error toast instead of silence', async () => {
    const { wrapper } = await mountForm();
    await wrapper.find('input[placeholder="0.0000"]').setValue('1');

    network.offline = true;
    await wrapper.find('button.trade-add-btn').trigger('click');
    await flushPromises();

    // `request()` wraps the network failure in an ApiError, so the form shows
    // the API-shaped message rather than a raw `Error:` string.
    expect(toasts().value.some((t) => t.kind === 'error' && t.text.startsWith('POST /trades failed'))).toBe(true);
  });
});
