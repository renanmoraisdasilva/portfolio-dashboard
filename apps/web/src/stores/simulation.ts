import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import {
  computeValuation,
  createPortfolioCalculator,
  createSymbolClassifier,
  formatMoney,
  formatSigned,
  parseMoney,
  type Currency,
  type SymbolMap,
} from '@portfolio-dashboard/shared';
import { useApi, request } from '../composables/useApi';

export type Trade = components['schemas']['Trade'];
export type ScenarioSummary = components['schemas']['ScenarioSummary'];

export type Side = 'buy' | 'sell';
export type CashSource = 'USD' | 'BRL';

/** A trade the user planned in the simulator. Never written to the database. */
export interface SimTrade {
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  total?: number;
  currency?: CashSource;
  time: string;
}

/**
 * The blob stored under a scenario name. A type alias, not an interface, so it
 * satisfies the spec's open `data` object. Version guard matches the legacy page.
 */
export type ScenarioData = {
  version?: number;
  simPrices?: Record<string, number>;
  simPricePcts?: Record<string, number>;
  simTrades?: SimTrade[];
  simCashReais?: number;
  simCashDollars?: number;
};

/** Doughnut colors, unchanged from the legacy page. */
export const ALLOC_PALETTE = ['#00d9ff', '#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#22c55e'];

// These four were byte-identical to the copy in `dashboard.ts`, and between them
// they had two defects: `signedBrl` was never called at all, and `signedUsd`'s
// `${n >= 0 ? '+' : ''}` put two signs on negative zero (`+$-0.00`), because `-0 >=
// 0` is true. `formatMoney` / `formatSigned` in `packages/shared` are the single
// implementation now, and this store already imported `formatMoney` from there
// while still keeping its own.
//
// They stay as store members because `SimulationMetrics.vue` reaches them as
// `store.usd(...)` / `store.signedUsd(...)`; the point is one implementation, not
// churn in every template. `signedBrl` had no call sites and is gone.
const usd = (n: number): string => formatMoney(n, 'USD');
const brl = (n: number): string => formatMoney(n, 'BRL');
const signedUsd = (n: number): string => formatSigned(n, 'USD');

/**
 * Portfolio Simulation state.
 *
 * The vanilla page kept ~15 module-level `let` variables and re-read the DOM
 * on every recalculation; here the same values are reactive state and the
 * derived numbers are computed properties, so a slider move updates the
 * metrics, the allocation chart and both tables in one pass.
 *
 * Arithmetic is deliberately unchanged — the FIFO walk is `replayTradesWithRealized`
 * from `packages/shared` and the valuation below is the legacy line for line.
 */
export const useSimulationStore = defineStore(
  'simulation',
  () => {
    const api = useApi();

    // Real portfolio (read-only inputs).
    const prices = ref<Record<string, number>>({});
    const realTrades = ref<Trade[]>([]);
    const realCash = ref({ cashReais: 0, cashDollars: 0 });
    const symbols = ref<SymbolMap>({});
    const assetList = ref<string[]>([]);

    // Scenario overrides.
    const simPrices = ref<Record<string, number>>({});
    const simPricePcts = ref<Record<string, number>>({});
    const simTrades = ref<SimTrade[]>([]);
    const simCashReais = ref(0);
    const simCashDollars = ref(0);
    /** Simulated BRLUSD rate. The simulator overrides the market one freely. */
    const brlUsdRate = ref(0);

    // Trade form.
    const side = ref<Side>('buy');
    const cashSource = ref<CashSource>('USD');
    const symbol = ref('');
    const qtyInput = ref('');
    const priceInput = ref('');
    const totalInput = ref('');
    const qtyPct = ref(0);

    // UI-only state. The name is the legacy localStorage key, so a preference
    // set by the vanilla page is still read after the migration.
    const simAllocCurrency = ref<Currency>('USD');
    const scenarios = ref<ScenarioSummary[]>([]);
    const saveModalOpen = ref(false);
    const openModalOpen = ref(false);
    const scenarioName = ref('');
    const scenarioOverwriteId = ref('');
    const loading = ref(false);

    const classifier = computed(() => createSymbolClassifier(symbols.value));
    const calculator = computed(() => createPortfolioCalculator(symbols.value));
    const isBRLAsset = (s: string): boolean => classifier.value.isBRLAsset(s);
    const isBRLNonBond = (s: string): boolean => classifier.value.isBRLNonBond(s);
    const isBRLBond = (s: string): boolean => classifier.value.isBRLBond(s);

    /** Market price, falling back to the scenario override. */
    const priceOf = (s: string): number => simPrices.value[s] || prices.value[s] || 0;

    /** BRL per USD — the simulator shows and edits the inverse of the rate. */
    const brlPerUsd = computed(() => (brlUsdRate.value ? 1 / brlUsdRate.value : 0));
    const baseBrlPerUsd = computed(() => {
      const base = prices.value['BRLUSD'];
      if (base) return 1 / base;
      return brlUsdRate.value ? 1 / brlUsdRate.value : 0;
    });

    /**
     * Real trades plus the planned ones. The spec types every Trade field as
     * optional, so rows without a symbol or quantity are dropped rather than
     * replayed as a NaN lot.
     */
    const combinedTrades = computed<Array<{ symbol: string; side: string; qty: number; price?: number | null }>>(() => [
      ...realTrades.value
        .filter((t): t is Trade & { symbol: string; qty: number } => Boolean(t.symbol) && typeof t.qty === 'number')
        .map((t) => ({ symbol: t.symbol, side: String(t.side ?? ''), qty: t.qty, price: t.price ?? null })),
      ...simTrades.value,
    ]);

    /**
     * Scenario prices win over market prices when a trade carries no price.
     * A spread (rather than the legacy `sim || market || 0`) lets an override
     * of exactly 0 stay 0 instead of snapping back to the market price.
     */
    /**
     * Scenario prices win over market prices when a trade carries no price.
     * A spread (rather than the legacy `sim || market || 0`) lets an override
     * of exactly 0 stay 0 instead of snapping back to the market price.
     */
    const fallbackPrices = computed<Record<string, number>>(() => ({ ...prices.value, ...simPrices.value }));

    /**
     * The prices a position is valued at: a scenario override, or the market
     * price for an asset the scenario never set.
     *
     * Kept separate from `fallbackPrices` on purpose — a 0 override means
     * "worthless" when costing a lot, but an *unset* price falls back to the
     * market when valuing a position. `computeValuation` takes both maps.
     */
    const currentPrices = computed<Record<string, number>>(() => {
      const out: Record<string, number> = { ...prices.value };
      for (const [symbol, price] of Object.entries(simPrices.value)) {
        if (price) out[symbol] = price;
      }
      return out;
    });

    /**
     * The scenario's portfolio, valued by the shared module.
     *
     * This is the last place that valued positions itself. The dashboard reads
     * `GET /api/portfolio/valuation`; the simulator cannot, because its prices
     * and cash balances are hypothetical and re-derive on every keystroke — a
     * request per slider frame would make the page worse, not the arithmetic
     * safer. It calls the same `computeValuation` the endpoint does, so the two
     * cannot disagree about invested cost, BRL conversion or a position's P/L.
     *
     * Realized P/L is the one input that differs: the scenario's trades are not
     * in the database, so their P/L comes from the FIFO walk rather than from a
     * `profit` column. There is no interest in a scenario.
     */
    const valuation = computed(() => {
      const replay = calculator.value.replayTradesWithRealized(combinedTrades.value, fallbackPrices.value);
      return computeValuation({
        trades: combinedTrades.value,
        prices: currentPrices.value,
        lotFallbackPrices: fallbackPrices.value,
        cash: { cashReais: simCashReais.value || 0, cashDollars: simCashDollars.value || 0 },
        realizedFromSells: replay.realized,
        interest: { brlTotal: 0, usdTotal: 0 },
        brlUsdRate: brlUsdRate.value,
        symbols: symbols.value,
        includeCashInAllocation: true,
      });
    });

    /** The FIFO walk on its own, for the fields only the walk knows. */
    const replay = computed(() => calculator.value.replayTradesWithRealized(combinedTrades.value, fallbackPrices.value));

    const portfolio = computed(() => {
      const v = valuation.value;
      return {
        lots: v.lots,
        positions: v.positions,
        realized: replay.value.realized,
        invested: v.invested,
        totalValue: v.total,
        unrealized: v.unrealized,
      };
    });

    const metrics = computed(() => {
      const st = portfolio.value;
      const v = valuation.value;
      const rate = brlUsdRate.value || 0;
      const investedNet = Math.max(0, st.invested - st.realized);

      return {
        totalValue: st.totalValue,
        totalImpact: st.unrealized + st.realized,
        breakEven: v.breakEven,
        investedNet,
        unrealPct: v.unrealizedPct,
        tickerValue: v.tickerValue,
        investedPct: v.investedPct,
        unrealized: st.unrealized,
        realized: st.realized,
        realizedPctOfInvested: (st.realized / Math.max(1, st.invested)) * 100,
        salesCount: simTrades.value.filter((t) => t.side === 'sell').length,
        brlInvested: rate ? investedNet / rate : null,
        brlTotal: rate ? st.totalValue / rate : null,
        brlUnrealized: rate ? st.unrealized / rate : null,
        brlRealized: rate ? st.realized / rate : null,
      };
    });

    /** One row per open position, with its P/L formatted in the asset's currency. */
    const positionRows = computed(() =>
      valuation.value.rows
        .filter((row) => row.kind === 'position')
        .map((row) => {
          const brl = row.valueCurrency === 'BRL';
          const money = (amount: number): string => (brl ? formatMoney(amount, 'BRL') : formatMoney(amount, 'USD'));
          return {
            symbol: row.symbol,
            qty: row.qty.toFixed(4),
            avg: money(row.avgCost),
            cur: money(row.currentPrice),
            value: money(row.value),
            // `$-492.66`, not `-$492.66`: the sign stays inside the currency, as
            // `signedUsd` and `formatMoney` have always rendered it.
            pl: formatSigned(row.pl, row.plCurrency),
            positive: row.pl >= 0,
          };
        }),
    );

    /** Allocation slices in USD plus their share of the total. */
    const allocation = computed(() => {
      const slices = valuation.value.allocation;
      return {
        labels: slices.map((slice) => slice.label),
        values: slices.map((slice) => slice.value),
        pcts: slices.map((slice) => slice.pct),
        colors: slices.map((_, i) => ALLOC_PALETTE[i % ALLOC_PALETTE.length]),
      };
    });

    const tradeRows = computed(() =>
      simTrades.value.map((t) => {
        const price = t.price || priceOf(t.symbol);
        // `t.currency` is optional on the stored shape, and the original
        // `t.currency === 'BRL' ? brl(..) : usd(..)` defaulted to USD. Passing it
        // straight through would have thrown on a row with no currency set, so the
        // fallback is explicit rather than incidental.
        const currency: Currency = t.currency === 'BRL' ? 'BRL' : 'USD';
        const totalDisplay = t.total !== undefined ? formatMoney(t.total, currency) : formatMoney(price * t.qty, currency);
        return {
          time: new Date(t.time).toLocaleString(),
          symbol: t.symbol,
          side: t.side.toUpperCase(),
          qty: t.qty,
          price: formatMoney(price, 'USD'),
          total: totalDisplay,
        };
      }),
    );

    // --- Scenario price overrides -------------------------------------------------

    function setPricePct(s: string, pct: number): void {
      simPricePcts.value[s] = pct;
      const base = prices.value[s] || 0;
      simPrices.value[s] = +(base * (1 + pct / 100)).toFixed(2);
    }

    /** Parses a typed price in the asset's display currency and stores it in USD terms. */
    function setPrice(s: string, text: string): void {
      if (isBRLNonBond(s)) {
        const value = parseMoney(text, 'BRL') || 0;
        simPrices.value[s] = +value.toFixed(2);
      } else if (isBRLBond(s)) {
        const value = parseMoney(text, 'BRL') || 0;
        simPrices.value[s] = +(value / (brlUsdRate.value || 1)).toFixed(2);
      } else {
        const value = parseMoney(text, 'USD') || 0;
        simPrices.value[s] = +value.toFixed(2);
      }
      const base = prices.value[s] || 0;
      simPricePcts.value[s] = base ? Math.round(((simPrices.value[s] - base) / base) * 100) : 0;
    }

    /** Display price: bonds are stored in USD but quoted in BRL. */
    function displayPrice(s: string): number {
      const price = priceOf(s);
      return isBRLBond(s) ? price / (brlUsdRate.value || 1) : price;
    }

    function displayPriceText(s: string): string {
      const price = displayPrice(s);
      if (!price) return '';
      return formatMoney(price, isBRLAsset(s) ? 'BRL' : 'USD');
    }

    function displayBaseText(s: string): string {
      const base = prices.value[s] || 0;
      const shown = isBRLBond(s) ? base / (brlUsdRate.value || 1) : base;
      return formatMoney(shown, isBRLAsset(s) ? 'BRL' : 'USD');
    }

    function displayPctText(s: string): string {
      const pct = Number(simPricePcts.value[s]) || 0;
      return `${pct >= 0 ? '+' : ''}${pct}%`;
    }

    function setBrlPct(pct: number): void {
      simPricePcts.value['BRLUSD'] = pct;
      const next = +(baseBrlPerUsd.value * (1 + pct / 100)).toFixed(4);
      brlUsdRate.value = next > 0 ? 1 / next : 0;
    }

    /** Sets the rate from a typed "BRL per USD" value. */
    function setBrlPerUsd(text: string): void {
      const brlPer = parseMoney(text, 'BRL') || 0;
      brlUsdRate.value = brlPer > 0 ? 1 / brlPer : 0;
      const base = baseBrlPerUsd.value;
      simPricePcts.value['BRLUSD'] = base ? Math.round(((brlPer - base) / base) * 100) : 0;
    }

    // --- Trade form ---------------------------------------------------------------

    const parsedPrice = computed(
      () => parseMoney(priceInput.value, isBRLAsset(symbol.value) ? 'BRL' : 'USD') || priceOf(symbol.value),
    );
    const parsedQty = computed(() => parseFloat(qtyInput.value) || 0);

    /** Total implied by qty × price, formatted in the selected cash currency. */
    function totalFromQty(): string {
      const qty = parsedQty.value;
      const price = parsedPrice.value;
      const s = symbol.value;
      if (!qty || !price) return '';

      if (isBRLNonBond(s)) {
        const brlTotal = +(qty * price).toFixed(2);
        if (!brlTotal || brlTotal <= 0) return '';
        if (cashSource.value === 'BRL') return formatMoney(brlTotal, 'BRL');
        if (!brlUsdRate.value || brlUsdRate.value <= 0) return '';
        return formatMoney(brlTotal * brlUsdRate.value, 'USD');
      }
      const usdAmount = +(qty * price).toFixed(2);
      if (!usdAmount || usdAmount <= 0) return '';
      if (cashSource.value === 'USD') return formatMoney(usdAmount, 'USD');
      if (!brlUsdRate.value || brlUsdRate.value <= 0) return '';
      return formatMoney(usdAmount / brlUsdRate.value, 'BRL');
    }

    /** Quantity implied by the total, using the same currency rules. */
    function qtyFromTotal(): string {
      if (totalInput.value === '') return '';
      const total = parseMoney(totalInput.value, cashSource.value === 'USD' ? 'USD' : 'BRL');
      if (isNaN(total) || total <= 0) return '';
      const price = parsedPrice.value;
      if (!price || price <= 0) return '';
      const s = symbol.value;

      if (isBRLNonBond(s)) {
        const totalBRL = cashSource.value === 'USD' ? total / (brlUsdRate.value || 1) : total;
        return String(+(totalBRL / price).toFixed(4));
      }
      if (cashSource.value === 'BRL') {
        if (!brlUsdRate.value || brlUsdRate.value <= 0) return '';
        return String(+((total * brlUsdRate.value) / price).toFixed(4));
      }
      return String(+(total / price).toFixed(4));
    }

    /** What `pct` of the available cash (or of the open position, when selling) buys. */
    function qtyFromPct(pct: number): number {
      const s = symbol.value;
      const price = parsedPrice.value;
      if (!price || price <= 0) return 0;

      if (side.value === 'sell') {
        const avail = portfolio.value.positions[s] || 0;
        return +((avail * pct) / 100).toFixed(4);
      }
      if (isBRLNonBond(s)) {
        const availBRL =
          cashSource.value === 'USD' ? (simCashDollars.value || 0) / (brlUsdRate.value || 1) : simCashReais.value || 0;
        return +((availBRL * pct) / 100 / price).toFixed(4);
      }
      if (cashSource.value === 'BRL' && (!brlUsdRate.value || brlUsdRate.value <= 0)) return 0;
      const availUsd = cashSource.value === 'USD' ? simCashDollars.value : (simCashReais.value || 0) * (brlUsdRate.value || 0);
      return +((availUsd * pct) / 100 / price).toFixed(4);
    }

    /**
     * Total implied by the percentage slider, in the selected cash currency.
     *
     * Deliberately *not* money-formatted: the vanilla page wrote this field as a
     * plain `toFixed(2)` number (`refreshPctComputed`), unlike the qty-driven
     * total above, and the two were kept apart.
     */
    function totalFromPct(): string {
      const amount = +(qtyFromPct(qtyPct.value) * parsedPrice.value).toFixed(2);
      if (!amount || amount <= 0) return '';
      const s = symbol.value;
      const rate = brlUsdRate.value || 0;

      if (isBRLNonBond(s)) {
        if (cashSource.value === 'BRL') return amount.toFixed(2);
        if (rate <= 0) return '';
        return (amount * rate).toFixed(2);
      }
      if (cashSource.value === 'USD') return amount.toFixed(2);
      if (rate <= 0) return '';
      return (amount / rate).toFixed(2);
    }

    function refreshTotalFromPct(): void {
      totalInput.value = totalFromPct();
    }

    function setQtyPct(pct: number): void {
      qtyPct.value = pct;
      qtyInput.value = String(qtyFromPct(pct));
      totalInput.value = totalFromQty();
    }

    function setQty(text: string): void {
      qtyInput.value = text;
      totalInput.value = totalFromQty();
    }

    function setTotal(text: string): void {
      const parsed = parseMoney(text, cashSource.value === 'USD' ? 'USD' : 'BRL');
      totalInput.value =
        parsed && parsed > 0 ? (cashSource.value === 'USD' ? formatMoney(parsed, 'USD') : formatMoney(parsed, 'BRL')) : text;
      const qty = qtyFromTotal();
      if (qty) qtyInput.value = qty;
    }

    function setPriceInput(text: string): void {
      const s = symbol.value;
      const currency = isBRLAsset(s) ? 'BRL' : 'USD';
      const parsed = parseMoney(text, currency);
      priceInput.value = parsed ? formatMoney(parsed, currency) : '';
      totalInput.value = totalFromQty();
    }

    /** Seeds the price field from the scenario price when the asset changes. */
    function syncPriceToSymbol(): void {
      const s = symbol.value;
      const price = priceOf(s);
      priceInput.value = price ? formatMoney(price, 'USD') : '';
      totalInput.value = totalFromQty();
    }

    function setSide(next: Side): void {
      side.value = next;
    }

    /**
     * Switching the cash currency is the one path the vanilla page left writing
     * the total as a raw number (`refreshPctComputed`, with no follow-up), so the
     * field briefly shows an unformatted value here too.
     */
    function setCashSource(next: CashSource): void {
      cashSource.value = next;
      refreshTotalFromPct();
    }

    /**
     * Books a planned trade against the scenario cash. Returns a message to show
     * the user, or null on success — the legacy page used `alert()` here.
     */
    function addTrade(): string | null {
      const s = symbol.value;
      if (!s) return 'Pick an asset first';

      let qty = parsedQty.value;
      const isBRLNBSym = isBRLNonBond(s);
      const priceToUse = parsedPrice.value;
      const totalRaw = totalInput.value === '' ? NaN : parseFloat(totalInput.value);
      const rate = brlUsdRate.value || 1;

      if (qty <= 0) {
        if (!isNaN(totalRaw) && totalRaw > 0) {
          if (!priceToUse || priceToUse <= 0) return 'Price is required to compute quantity from total';
          if (cashSource.value === 'BRL' && (!brlUsdRate.value || brlUsdRate.value <= 0)) {
            return 'BRL/USD rate unavailable to convert total';
          }
          qty = isBRLNBSym
            ? +((cashSource.value === 'USD' ? totalRaw / rate : totalRaw) / priceToUse).toFixed(4)
            : +((cashSource.value === 'USD' ? totalRaw : totalRaw * brlUsdRate.value) / priceToUse).toFixed(4);
          if (qty <= 0) return 'Computed quantity is invalid; check price and total';
        } else {
          return 'Enter valid quantity or total';
        }
      }

      // For BRL non-bonds the price is in BRL; cash is accounted in USD.
      const usdAmount = isBRLNBSym ? priceToUse * qty * rate : priceToUse * qty;
      const brlAmount = isBRLNBSym ? priceToUse * qty : usdAmount / rate;

      if (side.value === 'buy') {
        if (cashSource.value === 'USD') {
          if (simCashDollars.value < usdAmount) return 'Not enough USD cash in scenario';
          simCashDollars.value = +(simCashDollars.value - usdAmount).toFixed(2);
        } else {
          if (!brlUsdRate.value || brlUsdRate.value <= 0) return 'BRL/USD rate unavailable to convert total';
          if (simCashReais.value < brlAmount) return 'Not enough BRL cash in scenario';
          simCashReais.value = +(simCashReais.value - brlAmount).toFixed(2);
        }
      } else if (cashSource.value === 'USD') {
        simCashDollars.value = +(simCashDollars.value + usdAmount).toFixed(2);
      } else {
        if (!brlUsdRate.value || brlUsdRate.value <= 0) return 'BRL/USD rate unavailable to convert proceeds';
        simCashReais.value = +(simCashReais.value + brlAmount).toFixed(2);
      }

      simTrades.value.push({
        symbol: s,
        side: side.value,
        qty,
        price: priceToUse,
        total: cashSource.value === 'USD' ? +usdAmount.toFixed(2) : +brlAmount.toFixed(2),
        currency: cashSource.value,
        time: new Date().toISOString(),
      });

      qtyInput.value = '';
      priceInput.value = '';
      totalInput.value = '';
      qtyPct.value = 0;
      return null;
    }

    function clearTrades(): void {
      simTrades.value = [];
      simCashReais.value = +(realCash.value.cashReais || 0).toFixed(2);
      simCashDollars.value = +(realCash.value.cashDollars || 0).toFixed(2);
    }

    function reset(): void {
      simTrades.value = [];
      simPricePcts.value = {};
      simPrices.value = { ...prices.value };
      simCashReais.value = realCash.value.cashReais;
      simCashDollars.value = realCash.value.cashDollars;
      brlUsdRate.value = prices.value['BRLUSD'] || 0;
      simPricePcts.value['BRLUSD'] = 0;
      qtyInput.value = '';
      priceInput.value = '';
      totalInput.value = '';
      qtyPct.value = 0;
      syncPriceToSymbol();
    }

    // --- Scenarios ----------------------------------------------------------------

    async function fetchScenarios(): Promise<ScenarioSummary[]> {
      const list = await request(api.GET('/scenarios'), 'GET', '/scenarios');
      scenarios.value = Array.isArray(list) ? list : [];
      return scenarios.value;
    }

    async function openSaveModal(): Promise<void> {
      scenarioName.value = '';
      scenarioOverwriteId.value = '';
      try {
        await fetchScenarios();
      } catch (err) {
        // The list only populates the "overwrite" picker; opening with it empty
        // is better than not opening the modal at all.
        console.warn('[simulation] could not load scenarios:', err);
      }
      saveModalOpen.value = true;
    }

    async function openScenariosModal(): Promise<void> {
      try {
        await fetchScenarios();
      } catch (err) {
        console.warn('[simulation] could not load scenarios:', err);
      }
      openModalOpen.value = true;
    }

    function scenarioPayload(): ScenarioData {
      return {
        version: 1,
        simPrices: simPrices.value,
        simTrades: simTrades.value,
        simCashReais: simCashReais.value,
        simCashDollars: simCashDollars.value,
        simPricePcts: simPricePcts.value,
      };
    }

    /** Returns a message to show the user, or null on success. */
    async function confirmSaveScenario(): Promise<string | null> {
      const name = scenarioName.value.trim();
      if (!name) return 'Please enter a scenario name';
      const body = { name, data: scenarioPayload() };

      try {
        if (scenarioOverwriteId.value) {
          await request(
            api.PUT('/scenarios/{id}', { params: { path: { id: scenarioOverwriteId.value } }, body }),
            'PUT',
            '/scenarios/{id}',
          );
        } else {
          await request(api.POST('/scenarios', { body }), 'POST', '/scenarios');
        }
      } catch (err) {
        console.warn('[simulation] save scenario failed:', err);
        return 'Failed to save scenario';
      }
      await fetchScenarios();
      saveModalOpen.value = false;
      return scenarioOverwriteId.value ? 'Scenario updated' : 'Scenario saved';
    }

    /** Returns a warning when the blob came from a newer app version, else null. */
    async function loadScenario(id: string): Promise<string | null> {
      let blob: ScenarioData;
      try {
        const payload = await request(api.GET('/scenarios/{id}', { params: { path: { id } } }), 'GET', '/scenarios/{id}');
        blob = (payload?.data ?? {}) as ScenarioData;
      } catch (err) {
        console.warn('[simulation] load scenario failed:', err);
        return 'Failed to load scenario';
      }
      // Version guard: unversioned blobs are treated as v1 (schema evolution).
      const warning =
        (blob.version ?? 1) !== 1 ? 'Scenario was saved with a newer version of this app and may not load correctly.' : null;

      if (blob.simPrices) simPrices.value = blob.simPrices;
      if (blob.simPricePcts) simPricePcts.value = blob.simPricePcts;
      if (blob.simTrades) simTrades.value = blob.simTrades;
      if (typeof blob.simCashReais !== 'undefined') simCashReais.value = blob.simCashReais;
      if (typeof blob.simCashDollars !== 'undefined') simCashDollars.value = blob.simCashDollars;
      if (simPrices.value['BRLUSD']) brlUsdRate.value = simPrices.value['BRLUSD'];
      syncPriceToSymbol();
      openModalOpen.value = false;
      return warning;
    }

    async function deleteScenario(id: string): Promise<string | null> {
      try {
        await request(api.DELETE('/scenarios/{id}', { params: { path: { id } } }), 'DELETE', '/scenarios/{id}');
      } catch (err) {
        console.warn('[simulation] delete scenario failed:', err);
        return 'Failed to delete scenario';
      }
      await fetchScenarios();
      return null;
    }

    // --- Loading ------------------------------------------------------------------

    async function load(): Promise<void> {
      loading.value = true;

      // Trades come from `/trades` and the balances from `/cash`;
      // retired the `/api/state` aggregation that used to bundle both.
      try {
        const [tradeRows, cashPositions, priceMap, symbolsPayload] = await Promise.all([
          request(api.GET('/trades'), 'GET', '/trades'),
          request(api.GET('/cash'), 'GET', '/cash'),
          request(api.GET('/prices'), 'GET', '/prices'),
          request(api.GET('/config/symbols'), 'GET', '/config/symbols'),
        ]);

        realTrades.value = (tradeRows ?? []) as Trade[];
        realCash.value = {
          cashReais: Number(cashPositions?.cashReais) || 0,
          cashDollars: Number(cashPositions?.cashDollars) || 0,
        };
        if (!simCashReais.value) simCashReais.value = realCash.value.cashReais || 0;
        if (!simCashDollars.value) simCashDollars.value = realCash.value.cashDollars || 0;
        simCashReais.value = +Number(simCashReais.value).toFixed(2);
        simCashDollars.value = +Number(simCashDollars.value).toFixed(2);

        if (priceMap) {
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(priceMap)) {
            if (k === 'ts' || k === 'cacheTTLms') continue;
            next[k] = v;
          }
          prices.value = next;
          brlUsdRate.value = next['BRLUSD'] || brlUsdRate.value || 0;
          simPrices.value = { ...next };
          for (const s of assetList.value) {
            const base = next[s] || 0;
            const pct = Number(simPricePcts.value[s]) || 0;
            if (base) simPrices.value[s] = +(base * (1 + pct / 100)).toFixed(2);
          }
        }

        if (symbolsPayload) {
          symbols.value = (symbolsPayload.detailed ?? {}) as SymbolMap;
          const tradeable = (symbolsPayload.all ?? []).filter((s) => {
            const cfg = (symbolsPayload.detailed ?? {})[s];
            return cfg && cfg.type !== 'currency';
          });
          if (tradeable.length > 0) assetList.value = tradeable;
          if (!symbol.value && assetList.value.length > 0) symbol.value = assetList.value[0];
        }

        syncPriceToSymbol();
      } catch (err) {
        console.warn('[simulation] load failed:', err);
      } finally {
        loading.value = false;
      }
      await fetchScenarios().catch((err) => console.warn('[simulation] scenarios failed:', err));
    }

    return {
      // real inputs
      prices,
      realTrades,
      realCash,
      symbols,
      assetList,
      // scenario
      simPrices,
      simPricePcts,
      simTrades,
      simCashReais,
      simCashDollars,
      brlUsdRate,
      // form
      side,
      cashSource,
      symbol,
      qtyInput,
      priceInput,
      totalInput,
      qtyPct,
      // ui
      simAllocCurrency,
      scenarios,
      saveModalOpen,
      openModalOpen,
      scenarioName,
      scenarioOverwriteId,
      loading,
      // derived
      portfolio,
      metrics,
      positionRows,
      allocation,
      tradeRows,
      combinedTrades,
      brlPerUsd,
      baseBrlPerUsd,
      // helpers used by components
      isBRLAsset,
      isBRLNonBond,
      isBRLBond,
      priceOf,
      displayPrice,
      displayPriceText,
      displayBaseText,
      displayPctText,
      totalFromQty,
      qtyFromPct,
      usd,
      brl,
      signedUsd,
      // actions
      load,
      setPrice,
      setPricePct,
      setBrlPct,
      setBrlPerUsd,
      setSide,
      setCashSource,
      setQty,
      setQtyPct,
      setTotal,
      setPriceInput,
      syncPriceToSymbol,
      addTrade,
      clearTrades,
      reset,
      fetchScenarios,
      openSaveModal,
      openScenariosModal,
      confirmSaveScenario,
      loadScenario,
      deleteScenario,
    };
  },
  { persist: ['simAllocCurrency'] },
);
