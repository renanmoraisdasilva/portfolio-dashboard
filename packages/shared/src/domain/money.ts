/**
 * Money helpers shared by `apps/api` and `apps/web`.
 *
 * Everything here is pure: no DOM, no `Intl` locale side effects beyond
 * formatting, no database. The symbol-dependent predicates take their symbol
 * map as an argument through `createSymbolClassifier`, so the API binds
 * `src/config/symbols.ts` and the frontend binds whatever `/api/config/symbols`
 * returned — one implementation, two registries.
 *

 */

export type Currency = 'BRL' | 'USD';

export interface SymbolMeta {
  readonly type?: string;
  readonly denominatedInBRL?: boolean;
}

export type SymbolMap = Record<string, SymbolMeta | undefined>;

export interface SymbolClassifier {
  isBRLAsset(symbol: string): boolean;
  /** BRL-denominated and not a bond: prices must be multiplied by BRLUSD to reach USD. */
  isBRLNonBond(symbol: string): boolean;
  /** BRL-denominated bond: the form shows BRL, the database stores USD. */
  isBRLBond(symbol: string): boolean;
}

/**
 * Binds the money rules to a symbol registry. Unknown symbols are never BRL.
 */
export function createSymbolClassifier(symbols: SymbolMap): SymbolClassifier {
  const isBRLAsset = (symbol: string): boolean => !!symbols[symbol]?.denominatedInBRL;
  return {
    isBRLAsset,
    isBRLNonBond: (symbol) => isBRLAsset(symbol) && symbols[symbol]?.type !== 'bond',
    isBRLBond: (symbol) => isBRLAsset(symbol) && symbols[symbol]?.type === 'bond',
  };
}

export function brlToUSD(amount: number, brlUsdRate: number): number {
  return amount * brlUsdRate;
}

export function usdToBRL(amount: number, brlUsdRate: number): number {
  return amount / brlUsdRate;
}

/**
 * `maxFractionDigits` defaults to the locale default (2). Chart axes and
 * tooltips pass 0 — they render thousands of values and the cents are noise.
 *
 * The `Intl.NumberFormat` instances are memoised. Constructing one is
 * comparatively expensive and these run inside computed properties that are
 * re-evaluated on every reactive tick — a positions table is hundreds of calls
 * per render. The key covers every option that changes the output, so two
 * currencies never share a formatter and `maximumFractionDigits: 0` cannot be
 * served by the 2-decimal one.
 */
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: Currency, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = currency === 'BRL' ? 'pt-BR' : 'en-US';
  // Built by hand rather than from JSON.stringify(options), so it stays obvious
  // which options are load-bearing if the set ever grows.
  const key = `${locale}|${options.style}|${options.currency}|${options.maximumFractionDigits ?? ''}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatMoney(val: number | string | null | undefined, currency: Currency, maxFractionDigits?: number): string {
  const value = typeof val === 'number' ? val : Number(val) || 0;
  const options: Intl.NumberFormatOptions =
    maxFractionDigits == null
      ? { style: 'currency', currency }
      : { style: 'currency', currency, maximumFractionDigits: maxFractionDigits };
  return formatterFor(currency, options).format(value);
}

/**
 * `formatMoney` with an explicit sign: `+$1,234.56` / `-$1,234.56`.
 *
 * Both Vue stores carried a local `signedUsd`/`signedBrl` pair doing
 * `` `${n >= 0 ? '+' : ''}${usd(n)}` `` over a hand-rolled `` `$` + `toLocaleString` ``.
 * That is right for an ordinary positive, and wrong for two cases the store tests
 * never asserted:
 *
 * - **Negative zero.** `-0 >= 0` is `true`, so it took the `+` branch and then
 *   formatted `-0`, which `Intl` renders as `-$0.00`. The result was `+$-0.00`: two
 *   signs. Formatting the magnitude here means `-0` collapses to `+0` first.
 * - **Anything reaching the legacy `$-` form** — see `legacySigned` in
 *   `stores/dashboard.ts`, where the same rule was spelled `` `$${x.toFixed(2)}` ``
 *   and put the symbol ahead of the minus.
 *
 * So the magnitude is formatted separately and the sign supplied here, rather than
 * prepended to a string that may already carry one.
 */
export function formatSigned(val: number | string | null | undefined, currency: Currency, maxFractionDigits?: number): string {
  const value = typeof val === 'number' ? val : Number(val) || 0;
  const magnitude = formatMoney(Math.abs(value), currency, maxFractionDigits);
  return value >= 0 ? `+${magnitude}` : `-${magnitude}`;
}

export function parseMoney(str: number | string | null | undefined, currency: Currency): number {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str)
    .trim()
    .replace(/\s/g, '')
    .replace(/[^0-9,.-]/g, '');
  if (cleaned === '') return 0;
  if (currency === 'BRL') {
    const normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    return parseFloat(normalized) || 0;
  }
  const normalized = cleaned.replace(/,/g, '');
  return parseFloat(normalized) || 0;
}
