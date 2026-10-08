import { formatMoney, parseMoney, type Currency, type SymbolClassifier } from './money';

/**
 * The trade form's arithmetic: quantity, total, and the percentage slider.
 *
 * It existed twice — `apps/web/src/stores/dashboard.ts` (the real-money form)
 * and `apps/web/src/stores/simulation.ts` (the scenario form) — as two
 * hand-written copies that had drifted apart while looking obviously correct.
 * This module is the single copy; both stores call it.
 *
 * The drift it replaces is the reason for the shape of this file:
 *
 * - `pctFromQty` and `qtyFromPct` were not inverses. `qtyFromPct` computed a
 *   buy in the symbol's own currency (BRL for a BRL asset), while `pctFromQty`
 *   divided that BRL amount by a USD balance. On a BRL asset at ~0.2 BRLUSD the
 *   round trip inflated the percentage ~5x, so the slider pinned itself at 100.
 * - The two copies disagreed about bonds: one branched on `isBRLAsset`, the
 *   other on `isBRLNonBond`, so a bond was totalled in different currencies
 *   depending on which form you typed into.
 * - One rounded the product to 2 decimals on the way through and the other did
 *   not, so the same inputs produced totals that differed in the last digit.
 *
 * Everything here works in the symbol's **display** currency — BRL when
 * `isBRLAsset`, USD otherwise — and converts to the cash source only at the
 * edge. That is the currency the price field shows and the label above it
 * promises ("Price (R$)"), so it is the only currency a user-visible number
 * should be computed in. `computeValuation` in `valuation.ts` stays the sole
 * authority on what a trade is worth; nothing here feeds a stored figure.
 *
 * A bond's display quote and its stored price are deliberately *not* reconciled
 * here: `displayPriceFromSpot` converts native → display the way `valuation.ts`
 * does (`costBRL = cost / rate`), but display → native lives in each store,
 * because the API (`routes/trades.ts`, `getAssetCurrency`) and `valuation.ts`
 * disagree about the currency a bond is stored in and that has to be settled
 * before either direction can be called correct. No `type: 'bond'` symbol is
 * configured, so the path is dormant.
 */

export type TradeSide = 'buy' | 'sell';
export type CashSource = 'USD' | 'BRL';

/** Price metadata the server ships alongside a quote (`<symbol>_meta`). */
export interface TradePriceMeta {
  readonly priceBRL?: number;
}

export type TradePriceMetaMap = Record<string, TradePriceMeta | undefined>;

/**
 * Everything the form's arithmetic needs, and nothing about which store it is
 * in: the dashboard passes real balances, the simulator passes scenario ones.
 */
export interface TradeFormContext {
  readonly symbol: string;
  readonly side: TradeSide;
  readonly cashSource: CashSource;
  readonly classifier: SymbolClassifier;
  /** BRLUSD — one BRL expressed in USD (~0.196). `0` means unknown, not parity. */
  readonly brlUsdRate: number;
  readonly cashUsd: number;
  readonly cashBrl: number;
  /** Current holding, which is what a sell-side percentage is a percentage of. */
  readonly positionQty: number;
}

/** The currency the price field shows for this symbol. */
export function displayCurrencyOf(symbol: string, classifier: SymbolClassifier): Currency {
  return classifier.isBRLAsset(symbol) ? 'BRL' : 'USD';
}

/**
 * Native spot quote → display quote. Identity for every symbol whose spot is
 * already quoted the way the form shows it; for a bond, whose spot is USD and
 * whose row `valuation.ts` reports in BRL, the same `/rate` conversion that
 * `costBRL = cost / rate` performs. `priceMeta.priceBRL` is the server's own
 * BRL quote and wins over the conversion when present.
 *
 * Returns `null` when a BRL quote cannot be derived (a bond and no rate), so a
 * caller can clear the field instead of showing a converted-from-nothing price.
 */
export function displayPriceFromSpot(
  spot: number,
  symbol: string,
  classifier: SymbolClassifier,
  brlUsdRate: number,
  priceMeta?: TradePriceMetaMap,
): number | null {
  if (!classifier.isBRLBond(symbol)) return spot;
  const meta = priceMeta?.[symbol]?.priceBRL;
  if (typeof meta === 'number') return meta;
  return brlUsdRate > 0 ? spot / brlUsdRate : null;
}

/**
 * Parse a price the user typed into the display currency. Use this only for a
 * **text** field holding formatted money (`R$1.234,56`): `parseMoney` reads a
 * BRL string as pt-BR, so a bare `169.27` from a `type="number"` input parses
 * as 16927. Those inputs must keep using `parseFloat`.
 */
export function parseDisplayPrice(text: string, symbol: string, classifier: SymbolClassifier): number {
  return parseMoney(text, displayCurrencyOf(symbol, classifier));
}

/** Format a display price for a text field. Inverse of `parseDisplayPrice`. */
export function formatDisplayPrice(price: number, symbol: string, classifier: SymbolClassifier): string {
  return formatMoney(price, displayCurrencyOf(symbol, classifier));
}

/** True when the cash source is a *different* currency from the price field's. */
export function conversionNeedsRate(ctx: TradeFormContext): boolean {
  return displayCurrencyOf(ctx.symbol, ctx.classifier) !== ctx.cashSource;
}

/** BRL ↔ USD. `null` when the conversion is needed and the rate is unknown. */
function convert(value: number, from: Currency, to: Currency, brlUsdRate: number): number | null {
  if (from === to) return value;
  if (!(brlUsdRate > 0)) return null;
  return from === 'BRL' ? value * brlUsdRate : value / brlUsdRate;
}

/** Cash the user is spending, expressed in the display currency. `null` when that conversion needs an unknown rate. */
function availableInDisplayCurrency(ctx: TradeFormContext): number | null {
  const currency = displayCurrencyOf(ctx.symbol, ctx.classifier);
  // The balance belongs to the cash source — that is the money being spent —
  // so it is read from there and converted into the currency the price is in.
  const cash = ctx.cashSource === 'USD' ? ctx.cashUsd : ctx.cashBrl;
  return convert(cash, ctx.cashSource, currency, ctx.brlUsdRate);
}

/** `qty × price`, shown in the cash-source currency. `''` when it cannot be shown honestly. */
export function computeTotal(qty: number, displayPrice: number, ctx: TradeFormContext): string {
  if (!(qty > 0) || !(displayPrice > 0)) return '';
  const value = qty * displayPrice;
  const currency = displayCurrencyOf(ctx.symbol, ctx.classifier);
  const converted = convert(value, currency, ctx.cashSource, ctx.brlUsdRate);
  return converted === null ? '' : formatMoney(converted, ctx.cashSource);
}

/** The inverse of `computeTotal`, for a total typed by hand. `''` when it cannot be derived. */
export function computeQtyFromTotal(text: string, displayPrice: number, ctx: TradeFormContext): string {
  const total = parseMoney(text, ctx.cashSource);
  if (!(total > 0) || !(displayPrice > 0)) return '';
  const currency = displayCurrencyOf(ctx.symbol, ctx.classifier);
  const native = convert(total, ctx.cashSource, currency, ctx.brlUsdRate);
  if (native === null) return '';
  return String(+(native / displayPrice).toFixed(4));
}

/** Quantity for a slider position: a share of the cash balance, or of the position when selling. */
export function computeQtyFromPct(pct: number, displayPrice: number, ctx: TradeFormContext): number {
  if (!(pct > 0) || !(displayPrice > 0)) return 0;
  if (ctx.side === 'sell') return +((ctx.positionQty * pct) / 100).toFixed(4);
  const available = availableInDisplayCurrency(ctx);
  if (available === null) return 0;
  return +((available * (pct / 100)) / displayPrice).toFixed(4);
}

/**
 * The inverse of `computeQtyFromPct`, for the slider to reflect a quantity
 * typed or stepped into the field. Both directions work in the display
 * currency, which is what makes them inverses: a quantity times its display
 * price is a display amount, compared against the same display balance the
 * forward direction divided by.
 */
export function computePctFromQty(qty: number, displayPrice: number, ctx: TradeFormContext): number {
  if (!(qty > 0) || !(displayPrice > 0)) return 0;
  if (ctx.side === 'sell') {
    return ctx.positionQty > 0 ? Math.min(100, Math.max(0, Math.round((qty / ctx.positionQty) * 100))) : 0;
  }
  const available = availableInDisplayCurrency(ctx);
  if (available === null || !(available > 0)) return 0;
  const pct = Math.round(((qty * displayPrice) / available) * 100);
  return Math.min(100, Math.max(0, pct));
}

export interface TradeAmounts {
  /** The trade's value in USD. */
  readonly usd: number;
  /** The trade's value in BRL, or 0 when the rate is unknown. */
  readonly brl: number;
}

/**
 * The trade's value in both currencies — what the simulator debits from a
 * balance. A `brl` of 0 means "no rate"; every caller that moves BRL already
 * refuses to proceed without one, so this never silently converts at parity.
 */
export function computeTradeAmounts(qty: number, displayPrice: number, ctx: TradeFormContext): TradeAmounts {
  const value = qty * displayPrice;
  const rate = ctx.brlUsdRate;
  if (displayCurrencyOf(ctx.symbol, ctx.classifier) === 'USD') {
    return { usd: value, brl: rate > 0 ? value / rate : 0 };
  }
  return { usd: rate > 0 ? value * rate : 0, brl: value };
}

/**
 * Re-express a typed total in another cash source when the toggle flips.
 * Returns the input untouched when there is nothing to convert (unparsable,
 * zero, or a conversion the unknown rate cannot support) rather than showing
 * the same digits under a different currency symbol.
 */
export function convertCashInput(text: string, from: CashSource, to: CashSource, brlUsdRate: number): string {
  const parsed = parseMoney(text, from);
  if (!(parsed > 0)) return text;
  const converted = convert(parsed, from, to, brlUsdRate);
  return converted === null ? text : formatMoney(converted, to);
}
