/**
 * Money helpers shared by `apps/api` and `apps/web`.
 *
 * Everything here is pure: no DOM, no `Intl` locale side effects beyond
 * formatting, no database. The symbol-dependent predicates take their symbol
 * map as an argument through `createSymbolClassifier`, so the API binds
 * `src/config/symbols.ts` and the frontend binds whatever `/api/config/symbols`
 * returned — one implementation, two registries.
 */

/**
 * ## The rounding policy
 *
 * Every monetary value in this application is an IEEE-754 double, and every
 * monetary column is SQLite `real`. There is no minor-unit representation, no
 * `decimal.js`, and no rounding at persistence. **That is a decision, and this is
 * where it is written down** — previously the policy existed only as an absence,
 * which is indistinguishable from an oversight until someone "fixes" it.
 *
 * **1. The domain computes in full precision.** No intermediate result is
 *    rounded. `computeValuation` sums lots, converts BRL at a rate, and reports
 *    what it gets. Rounding mid-calculation compounds: round each of twelve
 *    monthly interest amounts and the total is wrong by up to six cents, and
 *    which six cents depends on the order of the rows.
 *
 * **2. Persistence stores what was computed.** The `real` column keeps the full
 *    double. Rounding on write would mean the stored figure and the computed
 *    figure disagree, and the stored one is what a restore brings back — so the
 *    rounding error would become permanent rather than cosmetic.
 *
 * **3. Display rounds, and only display.** `formatMoney` and `formatSigned` are
 *    the single rounding boundary in the system. They hand the raw double to
 *    `Intl.NumberFormat`, which rounds half-away-from-zero for display and
 *    nothing else.
 *
 * **4. Never compare money for equality.** `0.1 + 0.2 !== 0.3`. Where a
 *    comparison is unavoidable, compare against a named tolerance rather than a
 *    literal — see `CENT` below, which is the one such place in the domain.
 *
 * **Why doubles are acceptable here.** This is a single-user dashboard reading
 * its own recorded trades. The quantities are: a handful of symbols, a few
 * thousand trades over years, prices quoted to at most four decimal places, and an
 * exchange rate that is itself stored as a double. Error accumulates as roughly
 * `n × ulp`, which over thousands of additions of values in the 10^4-10^5 range is
 * far below a cent. Integer minor units would remove the question entirely at the
 * cost of touching every calculation, every fixture and every migration — and the
 * premium it buys is insurance against a class of error this application does not
 * have.
 *
 * **When to revisit.** Two things would change the arithmetic:
 *
 * - **Settlement or accounting.** If this ever has to reconcile against a broker
 *   or a tax filing, the broker's figure is authoritative and the two must match to
 *   the cent. That is the point at which doubles stop being a rounding question
 *   and become a correctness one, and the answer becomes integer minor units.
 * - **A currency without two decimal places.** Nothing here assumes 2dp except the
 *   display formatters; a currency with 0 or 3 minor units would need the exponent
 *   carried alongside the amount rather than assumed at the edge.
 */

/**
 * One cent, as the domain's only sanctioned comparison tolerance.
 *
 * Named rather than written as `0.01` inline because the literal is what made the
 * policy invisible: `Math.abs(unrealized) < 0.01` in `computeValuation` reads as a
 * magic number, and the reason a half-cent threshold is the right one for "is this
 * portfolio at break-even" — that a residual below a cent is float noise from
 * summing lots and converting currencies, not a real gain or loss — was recorded
 * nowhere.
 *
 * Half a cent would be tighter than the noise floor for the sums involved, and a
 * whole dollar would hide a real move.
 */
export const CENT = 0.01;

export type Currency = 'BRL' | 'USD';

export interface SymbolMeta {
  readonly type?: string;
  readonly denominatedInBRL?: boolean;
}

export type SymbolMap = Record<string, SymbolMeta | undefined>;

/**
 * Symbol predicates bound to one registry.
 *
 * `this: void` on every member, for the same reason as `PortfolioCalculator`: the
 * whole point of these factories is that they close over a symbol map so callers
 * can take a bare `isBRLBond` out of the object and pass it around. That is safe
 * because none of them read `this`, and declaring it is what keeps it safe — a
 * member converted to a method that reads `this` would break every detached
 * reference at runtime rather than at the type check.
 *
 * Every consumer detaches at least one of these: both Vue stores hold a
 * classifier and call `classifier.isBRLAsset(...)` through it, while
 * `createPortfolioCalculator` destructures `isBRLNonBond` straight out.
 */
export interface SymbolClassifier {
  isBRLAsset(this: void, symbol: string): boolean;
  /** BRL-denominated and not a bond: prices must be multiplied by BRLUSD to reach USD. */
  isBRLNonBond(this: void, symbol: string): boolean;
  /** BRL-denominated bond: the form shows BRL, the database stores USD. */
  isBRLBond(this: void, symbol: string): boolean;
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
