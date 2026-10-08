// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { formatMoney } from '@portfolio-dashboard/shared';
import { stubNetwork, type StubRoute } from '../../test/networkHarness';

/**
 * Component tests for the simulator's trade form.
 *
 * The arithmetic lives in `packages/shared/domain/tradeForm` and is tested
 * there; these tests cover what only a mounted component can see: that a
 * handler parses in the currency its field displays, that the emitted events
 * fire, and that a rejected trade reaches the user as an alert.
 */

const SYMBOLS = {
  BTC: { id: 'BTC', name: 'Bitcoin', type: 'crypto' },
  BOVA11: { id: 'BOVA11', name: 'Ibovespa', type: 'stock', denominatedInBRL: true },
  BRLUSD: { id: 'BRLUSD', name: 'BRL to USD', type: 'currency' },
};

function routes(): StubRoute[] {
  return [
    {
      match: (p) => p === '/api/config/symbols',
      body: { all: Object.keys(SYMBOLS), detailed: SYMBOLS, currencies: ['BRLUSD'] },
    },
    {
      match: (p) => p === '/api/prices',
      body: { BTC: 60_000, BOVA11: 120, BRLUSD: 0.2, ts: 1_700_000_000_000, cacheTTLms: 4_800_000 },
    },
    { match: (p) => p === '/api/trades', body: [] },
    { match: (p) => p === '/api/cash', body: { cashReais: 10_000, cashDollars: 100_000 } },
    { match: (p) => p === '/api/scenarios', body: [] },
    { match: (p) => p === '/api/scenarios/{id}', body: {} },
  ];
}

async function mountForm() {
  const { useSimulationStore } = await import('../../stores/simulation');
  const store = useSimulationStore();
  await store.load();
  const TradeForm = (await import('./TradeForm.vue')).default;
  const wrapper = mount(TradeForm);
  return { store, wrapper };
}

function findChip(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const chip = wrapper.findAll('button.chip').find((b) => b.text() === text);
  if (!chip) throw new Error(`no chip labelled ${text}`);
  return chip;
}

function findButton(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((b) => b.text() === text);
  if (!button) throw new Error(`no button labelled ${text}`);
  return button;
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  stubNetwork(routes());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TradeForm — prices are read in the currency they show', () => {
  test('a BRL asset is quoted and stepped in reais, not dollars', async () => {
    const { store, wrapper } = await mountForm();
    expect(store.priceInput).toBe(formatMoney(60_000, 'USD'));

    await wrapper.find('select').setValue('BOVA11');
    // Regression: this formatted the quote as dollars and read it back as
    // pt-BR, so one press of + turned R$120,00 into R$12.001,00.
    expect(store.priceInput).toBe(formatMoney(120, 'BRL'));

    // The two steppers are quantity then price.
    const priceStepper = wrapper.findAll('.stepper')[1];
    await priceStepper.findAll('button')[1].trigger('click');

    expect(store.priceInput).toBe(formatMoney(121, 'BRL'));
  });

  test('the cash source toggle re-expresses the typed total', async () => {
    const { store, wrapper } = await mountForm();
    await wrapper.find('input[placeholder="USD"]').setValue('1,000.00');
    expect(store.qtyInput).toBe(String(+(1_000 / 60_000).toFixed(4)));

    await findChip(wrapper, 'BRL').trigger('click');

    expect(store.totalInput).toBe(formatMoney(5_000, 'BRL')); // 1000 USD at 0.2
    expect(store.qtyInput).toBe(String(+(1_000 / 60_000).toFixed(4)));
    expect(wrapper.find('input[placeholder="BRL"]').attributes('placeholder')).toBe('BRL');
    expect(findChip(wrapper, 'BRL').classes()).toContain('active');
    expect(findChip(wrapper, 'USD').classes()).not.toContain('active');
  });
});

describe('TradeForm — submitting a simulated trade', () => {
  test('a typed total becomes the quantity the trade records', async () => {
    const { store, wrapper } = await mountForm();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await wrapper.find('input[placeholder="USD"]').setValue('1,234.56');
    // Regression: the form used to leave the quantity empty and let
    // `addTrade` read this field with `parseFloat`, which stopped at the
    // comma and priced the trade on 1.
    expect(store.qtyInput).toBe(String(+(1_234.56 / 60_000).toFixed(4)));

    await findButton(wrapper, 'Simulate Trade').trigger('click');

    expect(wrapper.emitted('add')).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
    expect(store.simTrades).toHaveLength(1);
    expect(store.simTrades[0]).toMatchObject({ symbol: 'BTC', side: 'buy', qty: 0.0206, price: 60_000 });
    expect(store.simCashDollars).toBe(98_764); // 100000 − 0.0206 × 60000, rounded to cents
  });

  test('a total with no quantity is parsed as money by addTrade itself', async () => {
    const { store, wrapper } = await mountForm();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});

    // Skip `setTotal`'s derivation — it normally runs the moment the field
    // is left — so this exercises `addTrade`'s own read of the field, which
    // used to be a `parseFloat` that turned '1,234.56' into 1 and then
    // rejected the whole trade as un-priceable.
    store.totalInput = '1,234.56';

    await findButton(wrapper, 'Simulate Trade').trigger('click');

    expect(alert).not.toHaveBeenCalled();
    expect(wrapper.emitted('add')).toHaveLength(1);
    expect(store.simTrades).toHaveLength(1);
    expect(store.simTrades[0].qty).toBe(0.0206);
  });

  test('a trade the scenario cannot afford alerts instead of recording', async () => {
    const { store, wrapper } = await mountForm();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await wrapper.find('input[placeholder="0.0000"]').setValue('10');
    await findButton(wrapper, 'Simulate Trade').trigger('click');

    expect(alert).toHaveBeenCalledWith('Not enough USD cash in scenario');
    expect(wrapper.emitted('add')).toBeUndefined();
    expect(store.simTrades).toHaveLength(0);
  });

  test('the history table starts empty and prints a BRL trade in reais', async () => {
    const { wrapper } = await mountForm();
    expect(wrapper.text()).toContain('No simulated trades');

    await wrapper.find('select').setValue('BOVA11');
    await wrapper.find('input[placeholder="0.0000"]').setValue('1');
    await findButton(wrapper, 'Simulate Trade').trigger('click');

    const cells = wrapper.findAll('tbody tr td');
    expect(cells[1].text()).toBe('BOVA11');
    expect(cells[2].text()).toBe('BUY');
    // Regression: the price column formatted every trade as dollars.
    expect(cells[4].text()).toBe(formatMoney(120, 'BRL'));
    expect(cells[5].text()).toBe(formatMoney(24, 'USD')); // R$120 at 0.2

    await findButton(wrapper, 'Clear Sim Trades').trigger('click');
    expect(wrapper.emitted('clear')).toHaveLength(1);
  });
});
