import { computed } from 'vue';
import type { ChartConfiguration } from 'chart.js';
import {
  buildCashAssetSeries,
  buildCashCurrencySeries,
  computeCorrelatedAxisMax,
  formatMoney,
} from '@portfolio-dashboard/shared';
import { CASH_CHART_MODE, EMERGENCY_FUND_USD, useAnalyticsStore } from '../stores/analytics';

/** Per-asset colors, unchanged from the legacy page so charts keep their look. */
export const ASSET_COLORS: Record<string, string> = {
  BTC: '#f97316',
  ETH: '#7c3aed',
  SOL: '#06b6d4',
  MSFT: '#3b82f6',
  AAPL: '#a3e635',
  Cash: '#64748b',
};

const EMERGENCY_LABEL = 'Emergency Fund (50k USD)';

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function usdAxis(value: unknown): string {
  return '$' + (Number(value) / 1000).toFixed(0) + 'k';
}

const xTicks = { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 } as const;
const xGrid = { color: 'rgba(45,55,72,0.5)' } as const;
const legend = { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 12 } } } as const;

/**
 * The three Analytics Lab charts, as Chart.js configurations.
 *
 * The options are the legacy page's, moved here unchanged; only the canvas
 * lookup and the imperative `destroy()` calls are gone — `ChartCanvas.vue`
 * owns that lifecycle now.
 *
 * A `null` configuration means "no data for this period", which the canvas
 * renders as a message instead of an empty grid.
 */
export function useAnalyticsCharts() {
  const store = useAnalyticsStore();

  const cashAssets = computed<{ config: ChartConfiguration<'line'>; meta: string } | null>(() => {
    const points = store.history;
    if (points.length === 0) return null;

    const cashCtx = store.cashContext;
    const series = buildCashAssetSeries(points, store.cashEntries, cashCtx?.brlUsd ?? 1);
    if (series.length === 0) return null;

    const labels = series.map((p) => dayLabel(p.ts));
    const assetsUSD = series.map((p) => p.assetsUSD);
    const cashUSD = series.map((p) => p.cashUSD);

    const currencySeries = buildCashCurrencySeries(points, store.cashEntries);
    const cashBRLSeries = currencySeries.length
      ? currencySeries.map((p) => Number(p.cashBRL) || 0)
      : series.map(() => 0);
    const cashUSDNativeSeries = currencySeries.length
      ? currencySeries.map((p) => Number(p.cashUSDNative) || 0)
      : series.map(() => 0);

    const sortedHistory = [...points].sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
    const fxRef =
      Number(cashCtx?.brlUsd) || Number(sortedHistory[sortedHistory.length - 1]?.brlusd_rate) || 1;

    const isAssetsCash = store.cashChartMode === CASH_CHART_MODE.ASSETS_CASH;

    const datasets = isAssetsCash
      ? [
          {
            label: 'Assets',
            data: assetsUSD,
            borderColor: '#00d9ff',
            backgroundColor: 'rgba(0,217,255,0.10)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.25,
            fill: true,
          },
          {
            label: 'Cash',
            data: cashUSD,
            borderColor: '#94a3b8',
            backgroundColor: 'rgba(148,163,184,0.20)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.25,
            fill: false,
          },
          {
            label: EMERGENCY_LABEL,
            data: labels.map(() => EMERGENCY_FUND_USD),
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            borderDash: [4, 4] as number[],
            pointRadius: 0,
            tension: 0,
            fill: false,
          },
        ]
      : [
          {
            label: 'BRL Cash',
            data: cashBRLSeries,
            yAxisID: 'yBRL',
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.10)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.22,
            fill: false,
          },
          {
            label: 'USD Cash',
            data: cashUSDNativeSeries,
            yAxisID: 'yUSD',
            borderColor: '#60a5fa',
            backgroundColor: 'rgba(96,165,250,0.10)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.22,
            fill: false,
          },
        ];

    const axis = computeCorrelatedAxisMax(cashBRLSeries, cashUSDNativeSeries, fxRef > 0 ? fxRef : 1, 1.08);

    const meta = isAssetsCash
      ? 'period history · assets vs cash (USD)'
      : `period history · BRL and USD cash amounts · locked by BRLUSD ${axis.fx.toFixed(3)}`;

    return {
      meta,
      config: {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend,
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const label = ctx.dataset.label ?? '';
                  const currency = !isAssetsCash && label.includes('BRL') ? 'BRL' : 'USD';
                  return `${label}: ${formatMoney(ctx.parsed.y, currency, 0)}`;
                },
              },
            },
          },
          scales: isAssetsCash
            ? {
                x: { ticks: xTicks, grid: xGrid },
                y: {
                  stacked: false,
                  beginAtZero: true,
                  ticks: { color: '#64748b', callback: usdAxis },
                  grid: xGrid,
                },
              }
            : {
                x: { ticks: xTicks, grid: xGrid },
                yBRL: {
                  position: 'left',
                  beginAtZero: true,
                  max: axis.yBRLMax,
                  ticks: { color: '#22c55e', callback: (v: unknown) => 'R$' + (Number(v) / 1000).toFixed(0) + 'k' },
                  grid: xGrid,
                },
                yUSD: {
                  position: 'right',
                  beginAtZero: true,
                  max: axis.yUSDMax,
                  ticks: { color: '#60a5fa', callback: usdAxis },
                  grid: { drawOnChartArea: false },
                },
              },
        },
      } as ChartConfiguration<'line'>,
    };
  });

  const portfolioConfig = computed<ChartConfiguration<'line'> | null>(() => {
    const points = store.history;
    if (points.length === 0) return null;

    const labels = points.map((p) => dayLabel(Number(p.ts ?? 0)));
    // Prefer unrealized P/L to avoid deposits being visualized as "performance".
    // `null` keeps Chart.js drawing a gap instead of dropping to zero.
    const values = points.map((p) => (typeof p.p === 'number' ? p.p : (p.v ?? null)));

    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Unrealized P/L',
            data: values,
            borderColor: '#00d9ff',
            backgroundColor: 'rgba(0,217,255,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => '$' + Number(ctx.parsed.y).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            },
          },
        },
        scales: {
          x: { ticks: xTicks, grid: xGrid },
          y: { ticks: { color: '#64748b', callback: usdAxis }, grid: xGrid },
        },
      },
    } as ChartConfiguration<'line'>;
  });

  const costMarketConfig = computed<ChartConfiguration<'bar'> | null>(() => {
    const assets = Object.keys(store.costVsMarket);
    if (assets.length === 0) return null;

    return {
      type: 'bar',
      data: {
        labels: assets,
        datasets: [
          {
            label: 'Cost Basis',
            data: assets.map((a) => store.costVsMarket[a].cost),
            backgroundColor: 'rgba(148,163,184,0.35)',
            borderColor: 'rgba(148,163,184,0.6)',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Market Value',
            data: assets.map((a) => store.costVsMarket[a].market),
            backgroundColor: assets.map((a) => (ASSET_COLORS[a] || '#00d9ff') + 'cc'),
            borderColor: assets.map((a) => ASSET_COLORS[a] || '#00d9ff'),
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend,
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { display: false } },
          y: { ticks: { color: '#64748b', callback: usdAxis }, grid: xGrid },
        },
      },
    } as ChartConfiguration<'bar'>;
  });

  return { cashAssets, portfolioConfig, costMarketConfig };
}
