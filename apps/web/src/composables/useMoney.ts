import { brlToUSD, formatMoney, parseMoney, usdToBRL } from '@portfolio-dashboard/shared';

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

export function fmtPct(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

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
