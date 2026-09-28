import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import {
  createPortfolioCalculator,
  createSymbolClassifier,
  formatMoney,
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

const usd = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brl = (n: number): string => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedUsd = (n: number): string => `${n >= 0 ? '+' : ''}${usd(n)}`;
const signedBrl = (n: number): string => `${n >= 0 ? '+' : ''}${brl(n)}`;

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
    const fallbackPrices = computed<Record<string, number>>(() => ({ ...prices.value, ...simPrices.value }));

    const portfolio = computed(() => {
      const { lots, positions, realized } = calculator.value.replayTradesWithRealized(
        combinedTrades.value,
        fallbackPrices.value,
      );
      const rate = brlUsdRate.value || 0;

      let totalValue = 0;
      for (const s of Object.keys(positions)) {
        const current = priceOf(s);
        totalValue += isBRLNonBond(s) ? positions[s] * current * (rate || 1) : positions[s] * current;
      }
      totalValue += (simCashReais.value || 0) * (rate || 1);
      totalValue += simCashDollars.value || 0;

      let invested = 0;
      for (const s of Object.keys(lots)) {
        for (const lot of lots[s]) {
          invested += isBRLNonBond(s) ? lot.qty * lot.price * (rate || 1) : lot.qty * lot.price;
        }
      }
      // Cash counts as invested here, to match the main dashboard.
      invested += (simCashReais.value || 0) * (rate || 1);
      invested += simCashDollars.value || 0;

      return { lots, positions, realized, invested, totalValue, unrealized: totalValue - invested };
    });

    const metrics = computed(() => {
      const st = portfolio.value;
      const rate = brlUsdRate.value || 0;
      const investedNet = Math.max(0, st.invested - st.realized);
      const unrealPct = st.invested > 0 ? (st.unrealized / st.invested) * 100 : 0;

      // Market value of the non-cash tickers: excludes cash and BRLUSD.
      const tickerValue = Object.keys(st.positions)
        .filter((s) => s !== 'BRLUSD')
        .reduce((sum, s) => {
          const p = priceOf(s);
          return sum + (isBRLNonBond(s) ? (st.positions[s] || 0) * p * rate : (st.positions[s] || 0) * p);
        }, 0);
      const investedPct = st.totalValue > 0 ? (tickerValue / st.totalValue) * 100 : 0;

      return {
        totalValue: st.totalValue,
        totalImpact: st.unrealized + st.realized,
        breakEven: Math.abs(st.unrealized) < 0.01,
        investedNet,
        unrealPct,
        tickerValue,
        investedPct,
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
    const positionRows = computed(() => {
      const st = portfolio.value;
      const rate = brlUsdRate.value || 1;
      return Object.keys(st.positions).map((s) => {
        const qty = st.positions[s];
        const lots = st.lots[s] || [];
        const cost = lots.reduce((sum, l) => sum + l.qty * l.price, 0);
        const cur = priceOf(s);

        if (isBRLNonBond(s)) {
          const value = qty * cur;
          const pl = value - cost;
          return {
            symbol: s,
            qty: qty.toFixed(4),
            avg: formatMoney(qty > 0 ? cost / qty : 0, 'BRL'),
            cur: formatMoney(cur, 'BRL'),
            value: formatMoney(value, 'BRL'),
            pl: (pl >= 0 ? '+' : '') + formatMoney(pl, 'BRL'),
            positive: pl >= 0,
          };
        }
        if (isBRLBond(s)) {
          const costBRL = cost / rate;
          const curBRL = cur / rate;
          const valueBRL = qty * curBRL;
          const plBRL = valueBRL - costBRL;
          return {
            symbol: s,
            qty: qty.toFixed(4),
            avg: formatMoney(qty > 0 ? costBRL / qty : 0, 'BRL'),
            cur: formatMoney(curBRL, 'BRL'),
            value: formatMoney(valueBRL, 'BRL'),
            pl: (plBRL >= 0 ? '+' : '') + formatMoney(plBRL, 'BRL'),
            positive: plBRL >= 0,
          };
        }
        const value = qty * cur;
        const pl = value - cost;
        return {
          symbol: s,
          qty: qty.toFixed(4),
          avg: usd(qty > 0 ? cost / qty : 0),
          cur: usd(cur),
          value: usd(value),
          pl: signedUsd(pl),
          positive: pl >= 0,
        };
      });
    });

    /** Allocation slices in USD plus their share of the total. */
    const allocation = computed(() => {
      const st = portfolio.value;
      const rate = brlUsdRate.value || 0;
      const symbolsWithCash = Object.keys(st.positions);
      const values = symbolsWithCash.map((s) => {
        const p = priceOf(s);
        return isBRLNonBond(s) ? st.positions[s] * p * rate : st.positions[s] * p;
      });

      const labels = [...symbolsWithCash];
      const slices = [...values];
      if (simCashReais.value > 0) {
        labels.push('BRL');
        slices.push(simCashReais.value * rate);
      }
      if (simCashDollars.value > 0) {
        labels.push('Dollar');
        slices.push(simCashDollars.value);
      }

      const total = slices.reduce((a, b) => a + b, 0);
      return {
        labels,
        values: slices,
        pcts: slices.map((v) => (total > 0 ? (v / total) * 100 : 0)),
        colors: labels.map((_, i) => ALLOC_PALETTE[i % ALLOC_PALETTE.length]),
      };
    });

    const tradeRows = computed(() =>
      simTrades.value.map((t) => {
        const price = t.price || priceOf(t.symbol);
        const totalDisplay =
          t.total !== undefined
            ? t.currency === 'BRL'
              ? brl(t.total)
              : usd(t.total)
            : usd(price * t.qty);
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
        return +(avail * pct / 100).toFixed(4);
      }
      if (isBRLNonBond(s)) {
        const availBRL = cashSource.value === 'USD' ? (simCashDollars.value || 0) / (brlUsdRate.value || 1) : simCashReais.value || 0;
        return +((availBRL * pct / 100) / price).toFixed(4);
      }
      if (cashSource.value === 'BRL' && (!brlUsdRate.value || brlUsdRate.value <= 0)) return 0;
      const availUsd = cashSource.value === 'USD' ? simCashDollars.value : (simCashReais.value || 0) * (brlUsdRate.value || 0);
      return +((availUsd * pct / 100) / price).toFixed(4);
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
      totalInput.value = parsed && parsed > 0
        ? cashSource.value === 'USD' ? formatMoney(parsed, 'USD') : formatMoney(parsed, 'BRL')
        : text;
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
      const warning = (blob.version ?? 1) !== 1
        ? 'Scenario was saved with a newer version of this app and may not load correctly.'
        : null;

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

      // Trades come from `/trades` and the balances from `/cash`; Phase 5
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
      signedBrl,
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
