import { brlToUSD, formatMoney, parseMoney, usdToBRL } from '@portfolio-dashboard/shared';

/**
 * Display helpers. The currency formatting and parsing come from
 * `packages/shared` — the same implementation the API and the tests use, so
 * the Vue app cannot drift from the legacy pages.
 */
export function useMoney() {
  return {
    formatMoney,
    parseMoney,
    brlToUSD,
    usdToBRL,
    fmtPct,
    fmtUSD,
    fmtSignedUSD,
    fmtDate,
    daysBetween,
  };
}

/** `+18.4%` / `-3.2%`, em-dash when there is no value. */
export function fmtPct(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/** Magnitude only — the legacy page renders the sign in its own element. */
export function fmtUSD(value: number | null | undefined): string {
  if (value == null) return '—';
  return '$' + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function fmtSignedUSD(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '−';
  return sign + '$' + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '?';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function daysBetween(a: number, b: number): number {
  return Math.round(Math.abs(b - a) / 86_400_000);
}
