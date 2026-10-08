import { computed, ref } from 'vue';
import {
  computePctFromQty,
  computeQtyFromPct,
  computeQtyFromTotal,
  computeTotal,
  convertCashInput,
  displayPriceFromSpot,
  formatMoney,
  parseMoney,
  type CashSource,
  type SymbolClassifier,
  type TradeFormContext,
  type TradePriceMetaMap,
  type TradeSide,
} from '@portfolio-dashboard/shared';

/**
 * The dashboard's trade-form state and its setters, extracted from
 * `stores/dashboard.ts` (IMPROVEMENT-PLAN 4.1, first slice).
 *
 * It is a composable rather than a Pinia store on purpose. The form's
 * arithmetic needs six things the *dashboard* owns — the symbol classifier,
 * the BRL/USD rate, both balances, the holding a sell is a share of, the price
 * map and its metadata — and a second store would have to be fed every one of
 * them to stay a leaf. As a composable those arrive once, as getters, and
 * nothing here can reach back into the store: no cycle, no load-order trap,
 * and a test can call `useTradeForm` with plain object literals instead of a
 * network harness.
 *
 * The state still belongs to whichever store spreads this return value, so
 * `useDashboardStore().qtyInput` is the same ref this module created — the
 * `.vue` components and their direct writes (`store.formSymbol = 'SPY'`) are
 * unchanged.
 *
 * The arithmetic itself lives in `packages/shared/src/domain/tradeForm.ts`
 * (the one copy shared with the simulator); this module is the stateful edge
 * around it.
 */

/** Everything the form's arithmetic needs from the store that owns it. All getters, so the form never holds a stale snapshot. */
export interface TradeFormDeps {
  /** Classifier deciding a symbol's display currency (`isBRLAsset` etc.). */
  readonly classifier: () => SymbolClassifier;
  /** BRLUSD — one BRL in USD (~0.196). `0` means unknown, not parity. */
  readonly brlUsdRate: () => number;
  /** USD balance the slider spends when the cash source is USD. */
  readonly cashUsd: () => number;
  /** BRL balance the slider spends when the cash source is BRL. */
  readonly cashBrl: () => number;
  /** Current holding, which is what a sell percentage is a percentage of. */
  readonly positionQty: (symbol: string) => number;
  /** Spot price map as the server sent it; a missing symbol reads as `0`. */
  readonly prices: () => Record<string, number>;
  /** Price metadata (`<symbol>_meta`), the server's own BRL quote when it has one. */
  readonly priceMeta: () => TradePriceMetaMap;
}

export function useTradeForm(deps: TradeFormDeps) {
  const formSide = ref<TradeSide>('buy');
  const formSymbol = ref('BTC');
  const formCashSource = ref<CashSource>('USD');
  const qtyInput = ref('');
  const priceInput = ref('');
  const tradeDate = ref('');
  const totalInput = ref('');
  const qtyPct = ref(0);

  const parsedQty = computed(() => parseFloat(qtyInput.value) || 0);
  const parsedPrice = computed(() => parseFloat(priceInput.value) || 0);

  /**
   * What the form's arithmetic needs, and nothing else: the balance the
   * slider spends, the classifier that decides the price field's currency,
   * and the holding a sell percentage is a share of. Quantity, total and
   * percentage all come from `packages/shared/src/domain/tradeForm.ts` — the
   * one copy of this arithmetic, shared with the simulator's form.
   */
  const formCtx = computed<TradeFormContext>(() => ({
    symbol: formSymbol.value,
    side: formSide.value,
    cashSource: formCashSource.value,
    classifier: deps.classifier(),
    brlUsdRate: deps.brlUsdRate(),
    cashUsd: deps.cashUsd(),
    cashBrl: deps.cashBrl(),
    positionQty: deps.positionQty(formSymbol.value),
  }));

  /**
   * The price being typed, or the symbol's market quote when the field is
   * empty — in the currency the field shows. `parsedPrice` stays a plain
   * `parseFloat` because this input is `type="number"`: it holds `169.27`,
   * never `R$169,27`, and `parseMoney` would read a pt-BR thousands
   * separator into it.
   */
  const formPrice = computed(() => {
    const typed = parsedPrice.value;
    if (typed > 0) return typed;
    const s = formSymbol.value;
    return displayPriceFromSpot(deps.prices()[s] ?? 0, s, deps.classifier(), deps.brlUsdRate(), deps.priceMeta()) ?? 0;
  });

  function totalFromQty(): string {
    return computeTotal(parsedQty.value, formPrice.value, formCtx.value);
  }

  function qtyFromTotal(): string {
    return computeQtyFromTotal(totalInput.value, formPrice.value, formCtx.value);
  }

  function qtyFromPct(pct: number): number {
    return computeQtyFromPct(pct, formPrice.value, formCtx.value);
  }

  function pctFromQty(qty: number): number {
    return computePctFromQty(qty, formPrice.value, formCtx.value);
  }

  function setQty(text: string): void {
    qtyInput.value = text;
    totalInput.value = totalFromQty();
    qtyPct.value = pctFromQty(parseFloat(text) || 0);
  }

  function setQtyPct(pct: number): void {
    qtyPct.value = pct;
    qtyInput.value = String(qtyFromPct(pct));
    totalInput.value = totalFromQty();
  }

  function setPrice(text: string): void {
    priceInput.value = text;
    totalInput.value = totalFromQty();
  }

  function setTotal(text: string): void {
    const parsed = parseMoney(text, formCashSource.value === 'USD' ? 'USD' : 'BRL');
    totalInput.value =
      parsed && parsed > 0 ? (formCashSource.value === 'USD' ? formatMoney(parsed, 'USD') : formatMoney(parsed, 'BRL')) : text;
    const qty = qtyFromTotal();
    if (qty) qtyInput.value = qty;
  }

  function syncPriceToSymbol(): void {
    const s = formSymbol.value;
    // Always resync, for every symbol: leaving a USD asset's price field
    // alone kept the previous symbol's quote in it, and the total was then
    // computed from a price that belonged to a different asset.
    const spot = displayPriceFromSpot(deps.prices()[s] ?? 0, s, deps.classifier(), deps.brlUsdRate(), deps.priceMeta());
    priceInput.value = spot !== null && spot > 0 ? spot.toFixed(2) : '';
    totalInput.value = totalFromQty();
    qtyPct.value = pctFromQty(parsedQty.value);
  }

  function setFormSide(side: TradeSide): void {
    formSide.value = side;
    totalInput.value = totalFromQty();
    qtyPct.value = pctFromQty(parsedQty.value);
  }

  function setCashSource(source: CashSource): void {
    const previous = formCashSource.value;
    formCashSource.value = source;
    if (totalInput.value) {
      totalInput.value = convertCashInput(totalInput.value, previous, source, deps.brlUsdRate());
      const qty = qtyFromTotal();
      if (qty) qtyInput.value = qty;
    }
    qtyPct.value = pctFromQty(parsedQty.value);
  }

  function resolvedTradePrice(): number | null {
    const typed = priceInput.value ? parseFloat(priceInput.value) : null;
    const s = formSymbol.value;
    const prices = deps.prices();
    const rate = deps.brlUsdRate();
    if (deps.classifier().isBRLBond(s)) {
      const meta = deps.priceMeta()[s];
      const brlP =
        typed !== null ? typed : typeof meta?.priceBRL === 'number' ? meta.priceBRL : rate > 0 ? (prices[s] ?? 0) / rate : null;
      return brlP !== null && rate > 0 ? brlP / rate : (prices[s] ?? null);
    }
    return typed !== null ? typed : (prices[s] ?? null);
  }

  function resetTradeForm(): void {
    formSymbol.value = 'BTC';
    formSide.value = 'buy';
    qtyInput.value = '';
    priceInput.value = '';
    tradeDate.value = '';
    totalInput.value = '';
    qtyPct.value = 0;
  }

  return {
    formSide,
    formSymbol,
    formCashSource,
    qtyInput,
    priceInput,
    tradeDate,
    totalInput,
    qtyPct,
    totalFromQty,
    qtyFromTotal,
    qtyFromPct,
    pctFromQty,
    setQty,
    setQtyPct,
    setPrice,
    setTotal,
    syncPriceToSymbol,
    setFormSide,
    setCashSource,
    resolvedTradePrice,
    resetTradeForm,
  };
}
