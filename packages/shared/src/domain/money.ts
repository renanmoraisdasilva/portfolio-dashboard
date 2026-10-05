export const CENT = 0.01;

export type Currency = 'BRL' | 'USD';

export interface SymbolMeta {
  readonly type?: string;
  readonly denominatedInBRL?: boolean;
}

export type SymbolMap = Record<string, SymbolMeta | undefined>;

export interface SymbolClassifier {
  isBRLAsset(this: void, symbol: string): boolean;
  isBRLNonBond(this: void, symbol: string): boolean;
  isBRLBond(this: void, symbol: string): boolean;
}

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

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: Currency, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = currency === 'BRL' ? 'pt-BR' : 'en-US';
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
