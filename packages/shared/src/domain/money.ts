/**
 * Money helpers shared by `apps/api` and (from Phase 4) `apps/web`.
 *
 * Everything here is pure: no DOM, no `Intl` locale side effects beyond
 * formatting, no database. The symbol-dependent predicates take their symbol
 * map as an argument through `createSymbolClassifier`, so the API binds
 * `src/config/symbols.ts` and the frontend binds whatever `/api/config/symbols`
 * returned — one implementation, two registries.
 *
 * Phase 2 of docs/MODERNIZATION-PLAN.md.
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
  const isBRLAsset = (symbol: string): boolean => !!(symbols[symbol]?.denominatedInBRL);
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

export function formatMoney(val: number | string | null | undefined, currency: Currency): string {
  const value = typeof val === 'number' ? val : Number(val) || 0;
  if (currency === 'BRL') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function parseMoney(str: number | string | null | undefined, currency: Currency): number {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str).trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  if (cleaned === '') return 0;
  if (currency === 'BRL') {
    const normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    return parseFloat(normalized) || 0;
  }
  const normalized = cleaned.replace(/,/g, '');
  return parseFloat(normalized) || 0;
}
