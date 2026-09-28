
const PERIOD_RANGE = {
  '1W':  'week',
  '1M':  'month',
  '3M':  '6months',
  '1Y':  'year',
  'ALL': 'all',
};

const ASSET_COLORS = {
  BTC:  '#f97316',
  ETH:  '#7c3aed',
  SOL:  '#06b6d4',
  MSFT: '#3b82f6',
  AAPL: '#a3e635',
  Cash: '#64748b',
};

const EMERGENCY_FUND_USD = 50_000;
const CASH_CHART_MODE = {
  ASSETS_CASH: 'assets-cash',
  CASH_CURRENCIES: 'cash-currencies',
};

let activePeriod = '3M';
let portfolioChart = null;
let costMarketChart = null;
let cashAssetsChart = null;
let snapshotsCache = {};
let cashContextCache = null;
let cashEntriesCache = null;
let cashAssetsViewMode = CASH_CHART_MODE.ASSETS_CASH;
let cashAssetsLastInputs = { historyPoints: [], cashEntries: [], cashCtx: null };

function fmtPct(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function fmtUSD(v) {
  if (v == null) return '—';
  return '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtSignedUSD(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '−';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtMoney(v, currency) {
  if (v == null) return '—';
  const c = currency === 'BRL' ? 'BRL' : 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: 0,
  }).format(v);
}

function syncCashAssetsToggle() {
  document.querySelectorAll('#cashAssetsCurrencyToggle .currency-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === cashAssetsViewMode);
  });
  const meta = document.getElementById('cashAssetsMeta');
  if (meta) {
    meta.textContent = cashAssetsViewMode === CASH_CHART_MODE.ASSETS_CASH
      ? 'period history · assets vs cash (USD)'
      : 'period history · BRL and USD cash amounts';
  }
}

function fmtTs(ms) {
  if (!ms) return '?';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetweenMs(a, b) {
  return Math.round(Math.abs(b - a) / 86400000);
}

async function getCashContext() {
  if (cashContextCache) return cashContextCache;
  try {
    const [stateRes, pricesRes] = await Promise.all([
      fetch('/api/state'),
      fetch('/api/prices'),
    ]);
    if (!stateRes.ok || !pricesRes.ok) throw new Error('Failed to load state/prices');
    const state = await stateRes.json();
    const prices = await pricesRes.json();
    const brlUsd = typeof prices.BRLUSD === 'number' ? prices.BRLUSD : 1;
    const cashUSD = (Number(state.cashDollars) || 0) + (Number(state.cashReais) || 0) * brlUsd;
    cashContextCache = {
      cashUSD,
      cashBRL: Number(state.cashReais) || 0,
      cashUSDNative: Number(state.cashDollars) || 0,
      brlUsd,
    };
    return cashContextCache;
  } catch (err) {
    console.error('[analytics] getCashContext failed:', err);
    return null;
  }
}

async function getCashEntries() {
  if (cashEntriesCache) return cashEntriesCache;
  try {
    const res = await fetch('/api/cash/entries');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    cashEntriesCache = Array.isArray(rows) ? rows : [];
    return cashEntriesCache;
  } catch (err) {
    console.error('[analytics] getCashEntries failed:', err);
    return [];
  }
}

function renderCashDragCard(snap, costVsMarket, cashCtx) {
  const badge = document.getElementById('cashDragBadge');
  const body = document.getElementById('cashDragBody');
  if (!badge || !body) return;

  if (!snap || !cashCtx) {
    badge.textContent = 'Unavailable';
    badge.className = 'analysis-badge';
    body.innerHTML = '<div class="analysis-signal"><div class="signal-dot" style="background:#64748b"></div><span>Could not load cash diagnostics.</span></div>';
    return;
  }

  const assetsUSD = Object.values(costVsMarket || {}).reduce((s, v) => s + (Number(v.market) || 0), 0);
  const cashUSD = cashCtx.cashUSD;
  const totalUSD = assetsUSD + cashUSD;
  const cashPct = totalUSD > 0 ? (cashUSD / totalUSD) * 100 : 0;
  const protectedCashUSD = Math.min(cashUSD, EMERGENCY_FUND_USD);
  const deployableCashUSD = Math.max(0, cashUSD - EMERGENCY_FUND_USD);
  const deployableCashPct = totalUSD > 0 ? (deployableCashUSD / totalUSD) * 100 : 0;
  const emergencyCoverage = EMERGENCY_FUND_USD > 0 ? (cashUSD / EMERGENCY_FUND_USD) : 0;

  const inputs = snap.return_inputs || null;
  const startInvested = Number(inputs?.start_invested || 0);
  const interestUSD = Number(inputs?.interest_period_usd || 0);
  const periodRetPct = Number(snap.return_pct || 0);
  // Opportunity cost should only apply to deployable cash; emergency reserve is intentionally idle.
  const expectedCashPnL = deployableCashUSD * (periodRetPct / 100);
  const carryGapUSD = interestUSD - expectedCashPnL;
  const carryGapPctStart = startInvested > 0 ? (carryGapUSD / startInvested) * 100 : 0;

  let badgeText = 'Balanced';
  let badgeClass = 'analysis-badge';
  let headline = 'Cash stance looks reasonable versus your emergency buffer.';

  if (emergencyCoverage < 1) {
    badgeText = 'Below Buffer';
    badgeClass = 'analysis-badge danger';
    headline = 'Emergency reserve is under the 50k target.';
  } else if (deployableCashPct >= 30) {
    badgeText = 'Heavy Cash';
    badgeClass = 'analysis-badge warn';
    headline = 'Deployable cash is high; upside participation may be reduced.';
  } else if (periodRetPct < 0 && carryGapUSD > 0) {
    badgeText = 'Defensive';
    badgeClass = 'analysis-badge';
    headline = 'Cash and carry helped cushion a weak period.';
  }

  badge.textContent = badgeText;
  badge.className = badgeClass;

  const gapLabel = carryGapUSD >= 0 ? 'carry benefit' : 'estimated drag';
  const gapColor = carryGapUSD >= 0 ? '#22c55e' : '#ef4444';
  const cashSplitText = `${fmtUSD(cashUSD)} total (${cashPct.toFixed(1)}%)`;
  const cashBreakdownText = `${fmtUSD(protectedCashUSD)} protected + ${fmtUSD(deployableCashUSD)} deployable (${deployableCashPct.toFixed(1)}%)`;
  const emergencyText = `Target ${fmtUSD(EMERGENCY_FUND_USD)} · Coverage ${(emergencyCoverage * 100).toFixed(1)}%`;
  const interestText = fmtSignedUSD(interestUSD);
  const netEffectText = `${fmtSignedUSD(carryGapUSD)} (${carryGapPctStart >= 0 ? '+' : ''}${carryGapPctStart.toFixed(2)}% of start invested)`;
  const expectedText = `${fmtUSD(deployableCashUSD)} × ${periodRetPct.toFixed(2)}% = ${fmtSignedUSD(expectedCashPnL)}`;
  const netFormulaText = `${fmtSignedUSD(interestUSD)} − ${fmtSignedUSD(expectedCashPnL)} = ${fmtSignedUSD(carryGapUSD)}`;

  body.innerHTML = `
    <div class="analysis-signal cash-headline">
      <div class="signal-dot" style="background:#14b8a6"></div>
      <span>${headline}</span>
    </div>

    <div class="cash-kpi-grid">
      <div class="cash-kpi-item">
        <div class="cash-kpi-label cash-kpi-label-neutral"><span class="cash-kpi-icon" aria-hidden="true">💧</span>Cash split</div>
        <div class="cash-kpi-value">${cashSplitText}</div>
        <div class="cash-kpi-sub">${cashBreakdownText}</div>
      </div>

      <div class="cash-kpi-item">
        <div class="cash-kpi-label ${emergencyCoverage >= 1 ? 'cash-kpi-label-good' : 'cash-kpi-label-bad'}"><span class="cash-kpi-icon" aria-hidden="true">🛟</span>Emergency fund</div>
        <div class="cash-kpi-value">${emergencyText}</div>
      </div>

      <div class="cash-kpi-item">
        <div class="cash-kpi-label ${interestUSD >= 0 ? 'cash-kpi-label-good' : 'cash-kpi-label-bad'}"><span class="cash-kpi-icon" aria-hidden="true">🏛️</span>Interest carry</div>
        <div class="cash-kpi-value">${interestText} this period</div>
      </div>

      <div class="cash-kpi-item">
        <div class="cash-kpi-label ${carryGapUSD >= 0 ? 'cash-kpi-label-good' : 'cash-kpi-label-bad'}"><span class="cash-kpi-icon" aria-hidden="true">⚖️</span>${gapLabel}</div>
        <div class="cash-kpi-value" style="color:${gapColor};font-weight:700;">${netEffectText}</div>
      </div>
    </div>

    <div class="cash-formula">
      <div class="cash-formula-title">How this was computed</div>
      <div class="cash-formula-line">Expected deployable-cash P/L: <span class="cash-mono">${expectedText}</span></div>
      <div class="cash-formula-line">Net effect: <span class="cash-mono">${netFormulaText}</span></div>
    </div>
  `;
}

function renderCashAssetsChart(historyPoints, cashEntries, cashCtx) {
  const canvas = document.getElementById('cashAssetsChart');
  if (!canvas) return;

  cashAssetsLastInputs = { historyPoints, cashEntries, cashCtx };
  syncCashAssetsToggle();

  if (!historyPoints || historyPoints.length === 0) {
    if (cashAssetsChart) { cashAssetsChart.destroy(); cashAssetsChart = null; }
    showEmptyChart('cashAssetsChart', 'No history data for this period');
    return;
  }

  const insights = (typeof AnalyticsInsights !== 'undefined') ? AnalyticsInsights : null;
  if (!insights) {
    showEmptyChart('cashAssetsChart', 'Insights helper unavailable');
    return;
  }

  const series = insights.buildCashAssetSeries(
    historyPoints,
    cashEntries,
    cashCtx?.brlUsd ?? 1,
  );

  const labels = series.map(p =>
    new Date(p.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  );
  const assetsUSD = series.map((p) => p.assetsUSD);
  const cashUSD = series.map((p) => p.cashUSD);

  const currencySeries = (typeof insights.buildCashCurrencySeries === 'function')
    ? insights.buildCashCurrencySeries(historyPoints, cashEntries)
    : [];
  const cashBRLSeries = currencySeries.length
    ? currencySeries.map(p => Number(p.cashBRL) || 0)
    : series.map(() => 0);
  const cashUSDNativeSeries = currencySeries.length
    ? currencySeries.map(p => Number(p.cashUSDNative) || 0)
    : series.map(() => 0);

  const sortedHistory = Array.isArray(historyPoints)
    ? [...historyPoints].sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
    : [];
  const fxRef = Number(cashCtx?.brlUsd)
    || Number(sortedHistory[sortedHistory.length - 1]?.brlusd_rate)
    || 1;

  const emergencyRef = EMERGENCY_FUND_USD;
  const emergencyLine = labels.map(() => emergencyRef);
  const emergencyLabel = 'Emergency Fund (50k USD)';

  const datasets = cashAssetsViewMode === CASH_CHART_MODE.ASSETS_CASH
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
          label: emergencyLabel,
          data: emergencyLine,
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          borderDash: [4, 4],
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

  if (cashAssetsChart) cashAssetsChart.destroy();

  const fxSafe = fxRef > 0 ? fxRef : 1;
  const axis = (typeof insights.computeCorrelatedAxisMax === 'function')
    ? insights.computeCorrelatedAxisMax(cashBRLSeries, cashUSDNativeSeries, fxSafe, 1.08)
    : { yBRLMax: 1, yUSDMax: 1, ratio: fxSafe, fx: fxSafe };
  const yBRLMax = axis.yBRLMax;
  const yUSDMax = axis.yUSDMax;

  const meta = document.getElementById('cashAssetsMeta');
  if (meta && cashAssetsViewMode === CASH_CHART_MODE.CASH_CURRENCIES) {
    meta.textContent = `period history · BRL and USD cash amounts · locked by BRLUSD ${axis.fx.toFixed(3)}`;
  }

  cashAssetsChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8', boxWidth: 12, font: { size: 12 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (cashAssetsViewMode === CASH_CHART_MODE.CASH_CURRENCIES) {
                const c = ctx.dataset.label.includes('BRL') ? 'BRL' : 'USD';
                return `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, c)}`;
              }
              return `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, 'USD')}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 },
          grid: { color: 'rgba(45,55,72,0.5)' },
        },
        ...(cashAssetsViewMode === CASH_CHART_MODE.ASSETS_CASH
          ? {
              y: {
                stacked: false,
                beginAtZero: true,
                ticks: {
                  color: '#64748b',
                  callback: (v) => `$${(Number(v) / 1000).toFixed(0)}k`,
                },
                grid: { color: 'rgba(45,55,72,0.5)' },
              },
            }
          : {
              yBRL: {
                position: 'left',
                beginAtZero: true,
                max: yBRLMax,
                ticks: {
                  color: '#22c55e',
                  callback: (v) => `R$${(Number(v) / 1000).toFixed(0)}k`,
                },
                grid: { color: 'rgba(45,55,72,0.5)' },
              },
              yUSD: {
                position: 'right',
                beginAtZero: true,
                max: yUSDMax,
                ticks: {
                  color: '#60a5fa',
                  callback: (v) => `$${(Number(v) / 1000).toFixed(0)}k`,
                },
                grid: { drawOnChartArea: false },
              },
            }),
      },
    },
  });
}

function renderRiskProfile(snap, costVsMarket, cashCtx, historyPoints) {
  const badge = document.getElementById('riskProfileBadge');
  const body = document.getElementById('riskProfileBody');
  if (!badge || !body) return;

  const insights = (typeof AnalyticsInsights !== 'undefined') ? AnalyticsInsights : null;
  if (!snap || !insights) {
    badge.textContent = 'Unavailable';
    badge.className = 'analysis-badge';
    body.innerHTML = '<div class="analysis-signal"><div class="signal-dot" style="background:#64748b"></div><span>Could not compute risk profile.</span></div>';
    return;
  }

  const assetsUSD = Object.values(costVsMarket || {}).reduce((s, v) => s + (Number(v.market) || 0), 0);
  const cashUSD = Number(cashCtx?.cashUSD || 0);
  const totalUSD = assetsUSD + cashUSD;
  const cashPct = totalUSD > 0 ? (cashUSD / totalUSD) * 100 : 0;
  const deployableCashUSD = Math.max(0, cashUSD - EMERGENCY_FUND_USD);
  const deployableCashPct = totalUSD > 0 ? (deployableCashUSD / totalUSD) * 100 : 0;
  const emergencyCoverage = EMERGENCY_FUND_USD > 0 ? (cashUSD / EMERGENCY_FUND_USD) : 0;
  const maxAllocPct = assetsUSD > 0
    ? Math.max(...Object.values(costVsMarket || {}).map(v => (Number(v.market) || 0) / assetsUSD * 100))
    : 0;

  const pnlReturns = insights.computePnlReturns(historyPoints || []);
  const pnlStdPct = insights.stdDev(pnlReturns) * 100;

  const profile = insights.computeRiskProfile({
    drawdownPct: Number(snap.max_drawdown_pct || 0),
    sharpeRatio: Number(snap.sharpe_ratio || 0),
    cashPct,
    deployableCashPct,
    emergencyCoverage,
    maxAssetAllocPct: maxAllocPct,
    periodReturnPct: Number(snap.return_pct || 0),
    pnlStdPct,
  });

  let badgeClass = 'analysis-badge safe';
  if (profile.score >= 55) badgeClass = 'analysis-badge danger';
  else if (profile.score >= 35) badgeClass = 'analysis-badge warn';

  badge.textContent = `${profile.label} Risk · ${profile.score.toFixed(0)}/100`;
  badge.className = badgeClass;

  body.innerHTML = `
    <div class="risk-bar-wrap">
      <div class="risk-bar-bg"><div class="risk-bar-fill" style="width:${profile.score.toFixed(1)}%"></div></div>
    </div>
    <div class="analysis-signal"><div class="signal-dot" style="background:#38bdf8"></div><span><strong>Main risk drivers:</strong> Sharpe ${snap.sharpe_ratio == null ? 'N/A' : Number(snap.sharpe_ratio).toFixed(2)} (${profile.components.sharpeRisk.toFixed(1)} pts), drawdown ${Number(snap.max_drawdown_pct || 0).toFixed(1)}% (${profile.components.ddRisk.toFixed(1)} pts), concentration ${maxAllocPct.toFixed(1)}% (${profile.components.concentrationRisk.toFixed(1)} pts).</span></div>
    <div class="analysis-signal"><div class="signal-dot" style="background:#94a3b8"></div><span><strong>Cash posture:</strong> deployable cash ${deployableCashPct.toFixed(1)}% (+${profile.components.deployableCashRisk.toFixed(1)} pts), emergency coverage ${(emergencyCoverage * 100).toFixed(1)}% (−${profile.components.cashBufferCredit.toFixed(1)} pts).</span></div>
    ${profile.components.emergencyShortfallRisk > 0 ? `<div class="analysis-signal"><div class="signal-dot" style="background:#ef4444"></div><span><strong>Alert:</strong> emergency shortfall adds +${profile.components.emergencyShortfallRisk.toFixed(1)} pts to risk.</span></div>` : ''}
    <div class="analysis-signal"><div class="signal-dot" style="background:#64748b"></div><span><strong>Volatility context:</strong> short-term P/L volatility is ${pnlStdPct.toFixed(3)}% per step (+${profile.components.volRisk.toFixed(1)} pts).</span></div>
  `;
}

function setStatus(online) {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (!dot || !text) return;
  dot.className  = 'status-dot ' + (online ? 'online' : 'offline');
  text.textContent = online ? 'Live' : 'Offline';
}

function showSkeletons() {
  ['metricReturn', 'metricDrawdown', 'metricSharpe'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="skeleton" style="width:80px;height:28px;display:inline-block;"></span>';
  });
}

function showEmptyChart(chartId, message) {
  const canvas = document.getElementById(chartId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#475569';
  ctx.font = '14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}


function buildReturnTooltip(snap) {
  const ret = snap.return_pct;
  const inputs = snap.return_inputs || null;
  if (ret == null) {
    return `<div class="tt-title">P/L Return on Invested Capital</div>
      <div class="tt-body">Not enough snapshot history to compute return for this period.</div>`;
  }
  const sign = ret >= 0 ? '+' : '';
  const verdict = ret >= 20 ? 'Strong gain' : ret >= 5 ? 'Modest gain' : ret >= 0 ? 'Flat / slight gain'
    : ret >= -10 ? 'Slight loss' : ret >= -50 ? 'Significant loss' : 'Severe loss';
  const color = ret >= 0 ? 'var(--accent-success)' : ret >= -20 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  return `
    <div class="tt-title">P/L Return on Invested Capital</div>
    <div class="tt-body">Measures how much your snapshot P/L changed across the period, plus interest gains recorded for the period, relative to the invested base at the period start.</div>
    <div class="tt-value" style="color:${color}">${sign}${ret.toFixed(1)}% — ${verdict}</div>
    <div class="tt-hint">Formula: (P/L_end − P/L_start + Interest_period) ÷ Invested_start.</div>
    ${inputs ? `<div class="tt-hint">Values: (${fmtSignedUSD(inputs.end_pnl)} − ${fmtSignedUSD(inputs.start_pnl)} + ${fmtSignedUSD(inputs.interest_period_usd)}) ÷ ${fmtUSD(inputs.start_invested)} = ${sign}${ret.toFixed(1)}%</div>` : ''}
  `;
}

function buildDrawdownTooltip(snap) {
  const dd = snap.max_drawdown_pct;
  const inputs = snap.drawdown_inputs || null;
  if (dd == null) {
    return `<div class="tt-title">Maximum Drawdown</div>
      <div class="tt-body">No drawdown recorded — the portfolio never fell from a prior peak during this period. All movement was upward.</div>`;
  }
  const days = snap.max_drawdown_start && snap.max_drawdown_end
    ? daysBetweenMs(snap.max_drawdown_start, snap.max_drawdown_end) : null;
  const dateRange = snap.max_drawdown_start && snap.max_drawdown_end
    ? `${fmtTs(snap.max_drawdown_start)} → ${fmtTs(snap.max_drawdown_end)}` : null;
  const severity = dd < 5 ? 'Minimal — very stable'
    : dd < 10 ? 'Low — normal volatility'
    : dd < 20 ? 'Moderate — typical for equities'
    : dd < 35 ? 'Significant — worth reviewing risk'
    : 'Severe — high loss exposure';
  const color = dd < 10 ? 'var(--accent-success)' : dd < 20 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  const peakIdx = inputs?.peak_value;
  const troughIdx = inputs?.trough_value;
  return `
    <div class="tt-title">Maximum Drawdown</div>
    <div class="tt-body">The largest peak-to-trough decline in a <strong>daily cumulative return index</strong> built from P/L returns (ΔP/L ÷ previous invested base). This avoids distortion from cash deposits and raw P/L level changes.</div>
    <div class="tt-value" style="color:${color}">−${dd.toFixed(1)}% — ${severity}</div>
    ${inputs ? `<div class="tt-hint">Formula values: (${peakIdx.toFixed(4)} − ${troughIdx.toFixed(4)}) ÷ ${peakIdx.toFixed(4)} = −${dd.toFixed(1)}% · ${inputs.points_count} daily closes used</div>` : ''}
    ${dateRange ? `<div class="tt-hint">Peak on ${dateRange}${days != null ? ` · ${days} day${days !== 1 ? 's' : ''} to reach the trough` : ''}. A smaller drawdown with a shorter recovery window is healthier.</div>` : ''}
  `;
}

function buildSharpeTooltip(snap) {
  const sr = snap.sharpe_ratio;
  const inputs = snap.sharpe_inputs || null;
  if (sr == null) {
    return `<div class="tt-title">Sharpe Ratio</div>
      <div class="tt-body">Requires at least 30 consecutive snapshot data points. The server snapshots every 30 min — you need ~15 hours of continuous history for this period.</div>`;
  }
  const verdict = sr >= 2 ? 'Excellent risk-adjusted return'
    : sr >= 1 ? 'Good — beats risk-free with low volatility'
    : sr >= 0.5 ? 'Acceptable — modest risk premium'
    : sr >= 0 ? 'Below average — barely above risk-free'
    : sr >= -1 ? 'Poor — underperforming a savings account'
    : 'Very poor — deeply below risk-free';
  const color = sr >= 1 ? 'var(--accent-success)' : sr >= 0.5 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  return `
    <div class="tt-title">Sharpe Ratio</div>
    <div class="tt-body">Annualised excess return (vs risk-free 4.5%/yr) divided by volatility, using per-period P/L returns: ΔP/L ÷ prior invested base. Answers: <em>"am I being compensated for the risk I'm taking?"</em></div>
    <div class="tt-value" style="color:${color}">${sr.toFixed(2)} — ${verdict}</div>
    ${inputs ? `<div class="tt-hint">Values: mean=${(inputs.mean_return * 100).toFixed(4)}% · std=${(inputs.std_return * 100).toFixed(4)}% · n=${inputs.observations} · rf/period=${(inputs.rf_per_period * 100).toFixed(4)}%</div>` : ''}
    <div class="tt-scale">
      <span class="tt-scale-item bad">&lt; 0 Poor</span>
      <span class="tt-scale-item ok">0–0.5 Low</span>
      <span class="tt-scale-item ok">0.5–1 OK</span>
      <span class="tt-scale-item good">1–2 Good</span>
      <span class="tt-scale-item great">&gt; 2 Excellent</span>
    </div>
    <div class="tt-hint">A negative Sharpe means you'd have earned more by holding a risk-free fixed-income instrument (e.g. Tesouro Selic) than taking on this portfolio's volatility.</div>
  `;
}

function buildAnalysis(snap) {
  const ret = snap.return_pct;
  const dd  = snap.max_drawdown_pct;
  const sr  = snap.sharpe_ratio;

  const signals = [];

  if (ret == null) {
    signals.push({ type: 'neutral', text: 'Return unavailable — not enough history for this period.' });
  } else if (ret >= 20) {
    signals.push({ type: 'good', text: `Strong return of +${ret.toFixed(1)}% on start invested capital.` });
  } else if (ret >= 5) {
    signals.push({ type: 'ok', text: `Positive return of +${ret.toFixed(1)}% on start invested capital.` });
  } else if (ret >= 0) {
    signals.push({ type: 'ok', text: `Flat return of +${ret.toFixed(1)}% — effectively breakeven.` });
  } else if (ret >= -10) {
    signals.push({ type: 'warning', text: `Slight investment loss of ${ret.toFixed(1)}% based on P/L change.` });
  } else if (ret >= -50) {
    signals.push({ type: 'danger', text: `Significant investment loss of ${ret.toFixed(1)}% based on P/L change.` });
  } else {
    signals.push({ type: 'danger', text: `Severe return of ${ret.toFixed(1)}% — review position sizing and risk.` });
  }

  if (dd == null) {
    signals.push({ type: 'good', text: 'No drawdown in this period — the portfolio never fell from a prior peak.' });
  } else if (dd < 5) {
    signals.push({ type: 'good', text: `Max drawdown of just ${dd.toFixed(1)}% — very stable with minimal peak-to-trough exposure.` });
  } else if (dd < 15) {
    signals.push({ type: 'ok', text: `Drawdown of ${dd.toFixed(1)}% — within normal range for a diversified equity portfolio.` });
  } else if (dd < 30) {
    signals.push({ type: 'warning', text: `Notable drawdown of ${dd.toFixed(1)}% — consider whether your risk allocation matches your tolerance.` });
  } else {
    signals.push({ type: 'danger', text: `Severe drawdown of ${dd.toFixed(1)}% — this is a large peak-to-trough decline. High concentration or leverage risk.` });
  }

  if (sr == null) {
    signals.push({ type: 'neutral', text: 'Sharpe ratio requires ≥30 data points — extend the period or wait for more snapshots.' });
  } else if (sr >= 1) {
    signals.push({ type: 'good', text: `Sharpe of ${sr.toFixed(2)} — solid risk-adjusted return. You're being compensated for the volatility you're taking on.` });
  } else if (sr >= 0.5) {
    signals.push({ type: 'ok', text: `Sharpe of ${sr.toFixed(2)} — acceptable, though there's room to improve the return-to-risk ratio.` });
  } else if (sr >= 0) {
    signals.push({ type: 'warning', text: `Sharpe of ${sr.toFixed(2)} — barely above the risk-free rate (4.5%/yr). The volatility you're taking isn't paying off much.` });
  } else if (sr >= -1) {
    signals.push({ type: 'danger', text: `Sharpe of ${sr.toFixed(2)} — you're earning less than a Selic/fixed-income account while taking on more risk.` });
  } else {
    signals.push({ type: 'danger', text: `Sharpe of ${sr.toFixed(2)} — deeply negative. Significant return drag relative to the risk being taken.` });
  }

  if (ret != null && ret < -10 && dd != null && dd < 10 && sr != null && sr < 0) {
    signals.push({ type: 'warning', text: 'Note: small max drawdown alongside negative return suggests a slow, steady decline rather than a single crash event.' });
  }

  const dangerCount  = signals.filter(s => s.type === 'danger').length;
  const warningCount = signals.filter(s => s.type === 'warning').length;
  const goodCount    = signals.filter(s => s.type === 'good' || s.type === 'ok').length;

  let overallType;
  if      (dangerCount >= 2)                     overallType = 'danger';
  else if (dangerCount === 1 || warningCount >= 2) overallType = 'warning';
  else if (goodCount >= 2)                        overallType = 'good';
  else                                            overallType = 'neutral';

  return { overallType, signals };
}

function renderOverallAnalysis(snap) {
  const el = document.getElementById('overallAnalysis');
  if (!el) return;

  const { overallType, signals } = buildAnalysis(snap);

  const theme = {
    danger:  { border: '#ef4444', icon: '🔴', badge: 'Needs attention',    badgeBg: 'rgba(239,68,68,0.1)',   badgeBorder: 'rgba(239,68,68,0.3)',   color: '#ef4444' },
    warning: { border: '#f59e0b', icon: '🟡', badge: 'Mixed signals',      badgeBg: 'rgba(245,158,11,0.1)',  badgeBorder: 'rgba(245,158,11,0.3)',  color: '#f59e0b' },
    good:    { border: '#22c55e', icon: '🟢', badge: 'On track',           badgeBg: 'rgba(34,197,94,0.1)',   badgeBorder: 'rgba(34,197,94,0.3)',   color: '#22c55e' },
    neutral: { border: '#64748b', icon: '⚪', badge: 'Insufficient data',  badgeBg: 'rgba(100,116,139,0.1)', badgeBorder: 'rgba(100,116,139,0.3)', color: '#64748b' },
  }[overallType] || { border: '#64748b', icon: '⚪', badge: 'Unknown', badgeBg: '', badgeBorder: '', color: '#64748b' };

  const dotColor = { danger: '#ef4444', warning: '#f59e0b', good: '#22c55e', ok: '#4ade80', neutral: '#64748b' };

  el.style.borderLeftColor = theme.border;
  el.innerHTML = `
    <div class="analysis-header">
      <span class="analysis-icon">${theme.icon}</span>
      <span class="analysis-title">Portfolio Analysis</span>
      <span class="analysis-badge" style="background:${theme.badgeBg};color:${theme.color};border:1px solid ${theme.badgeBorder};">${theme.badge}</span>
    </div>
    <div class="analysis-signals">
      ${signals.map(s => `
        <div class="analysis-signal">
          <div class="signal-dot" style="background:${dotColor[s.type] || dotColor.neutral}"></div>
          <span>${s.text}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCards(snap) {
  const retEl   = document.getElementById('metricReturn');
  const retSub  = document.getElementById('metricReturnSub');
  const ddEl    = document.getElementById('metricDrawdown');
  const ddDates = document.getElementById('metricDrawdownDates');
  const shEl    = document.getElementById('metricSharpe');
  const shSub   = document.getElementById('metricSharpeSub');
  const marker  = document.getElementById('drawdownMarker');

  const ttReturn   = document.getElementById('tooltipReturn');
  const ttDrawdown = document.getElementById('tooltipDrawdown');
  const ttSharpe   = document.getElementById('tooltipSharpe');
  if (ttReturn)   ttReturn.innerHTML   = buildReturnTooltip(snap);
  if (ttDrawdown) ttDrawdown.innerHTML = buildDrawdownTooltip(snap);
  if (ttSharpe)   ttSharpe.innerHTML   = buildSharpeTooltip(snap);

  renderOverallAnalysis(snap);

  if (snap.return_pct == null) {
    retEl.textContent = '—';
    retEl.className = 'metric-value';
    retSub.textContent = 'Not enough history';
    retSub.className = 'metric-sub';
  } else {
    retEl.textContent = fmtPct(snap.return_pct);
    retEl.className = 'metric-value ' + (snap.return_pct >= 0 ? 'positive' : 'negative');
    const sign = snap.return_pct >= 0 ? '↑' : '↓';
    retSub.textContent = `${sign} P/L return over period`;
    retSub.className = 'metric-sub ' + (snap.return_pct >= 0 ? 'positive' : 'negative');
  }

  if (snap.max_drawdown_pct == null) {
    ddEl.textContent = '—';
    ddDates.textContent = 'No drawdown in period';
  } else {
    ddEl.textContent = `−${snap.max_drawdown_pct.toFixed(1)}%`;
    if (snap.max_drawdown_start && snap.max_drawdown_end) {
      const days = daysBetweenMs(snap.max_drawdown_start, snap.max_drawdown_end);
      ddDates.textContent = `${fmtTs(snap.max_drawdown_start)} → ${fmtTs(snap.max_drawdown_end)} · ${days} day${days !== 1 ? 's' : ''}`;
    } else {
      ddDates.textContent = '—';
    }
  }
  if (marker) marker.textContent = snap.max_drawdown_pct != null ? `Max DD −${snap.max_drawdown_pct.toFixed(1)}%` : '';

  if (snap.sharpe_ratio == null) {
    shEl.innerHTML = '<span class="null-badge">N/A</span>';
    shSub.textContent = '< 30 data points — not enough history';
    shSub.className = 'metric-sub';
  } else {
    const sr = snap.sharpe_ratio;
    shEl.textContent = sr.toFixed(2);
    shEl.className = 'metric-value';
    shEl.style.color = sr >= 1 ? 'var(--accent-success)' : sr >= 0.5 ? 'var(--accent-warning)' : 'var(--accent-danger)';
    shSub.textContent = 'Risk-free: 4.5% / yr · ≥30 pts';
    shSub.className = 'metric-sub';
  }
}

function renderPortfolioChart(historyPoints) {
  const canvas = document.getElementById('portfolioChart');
  if (!canvas) return;
  if (!historyPoints || historyPoints.length === 0) {
    if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }
    showEmptyChart('portfolioChart', 'No history data for this period');
    return;
  }

  const labels = historyPoints.map(p =>
    new Date(p.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  );
  // Prefer unrealized P/L to avoid deposits being visualized as "performance".
  const values = historyPoints.map(p => (typeof p.p === 'number' ? p.p : p.v));

  if (portfolioChart) portfolioChart.destroy();
  portfolioChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Unrealized P/L',
        data: values,
        borderColor: '#00d9ff',
        backgroundColor: 'rgba(0,217,255,0.08)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => '$' + ctx.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 0 }),
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 },
          grid: { color: 'rgba(45,55,72,0.5)' },
        },
        y: {
          ticks: {
            color: '#64748b',
            callback: v => '$' + (v / 1000).toFixed(0) + 'k',
          },
          grid: { color: 'rgba(45,55,72,0.5)' },
        },
      },
    },
  });
}

function renderCostMarketChart(costVsMarket) {
  const canvas = document.getElementById('costMarketChart');
  if (!canvas) return;

  const assets = Object.keys(costVsMarket || {});
  if (assets.length === 0) {
    if (costMarketChart) { costMarketChart.destroy(); costMarketChart = null; }
    showEmptyChart('costMarketChart', 'No position data available');
    return;
  }

  const costs   = assets.map(a => costVsMarket[a].cost);
  const markets = assets.map(a => costVsMarket[a].market);

  if (costMarketChart) costMarketChart.destroy();
  costMarketChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: assets,
      datasets: [
        {
          label: 'Cost Basis',
          data: costs,
          backgroundColor: 'rgba(148,163,184,0.35)',
          borderColor: 'rgba(148,163,184,0.6)',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Market Value',
          data: markets,
          backgroundColor: assets.map(a => (ASSET_COLORS[a] || '#00d9ff') + 'cc'),
          borderColor:      assets.map(a =>  ASSET_COLORS[a] || '#00d9ff'),
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8', boxWidth: 12, font: { size: 12 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { display: false } },
        y: {
          ticks: { color: '#64748b', callback: v => '$' + (v / 1000).toFixed(0) + 'k' },
          grid: { color: 'rgba(45,55,72,0.5)' },
        },
      },
    },
  });
}

function renderAllocTable(costVsMarket) {
  const tbody = document.getElementById('allocTableBody');
  if (!tbody) return;
  const assets = Object.keys(costVsMarket || {});
  if (assets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#475569;padding:2rem;">No position data</td></tr>';
    return;
  }

  const totalMarket = assets.reduce((s, a) => s + costVsMarket[a].market, 0);
  tbody.innerHTML = assets.map(asset => {
    const { cost, market } = costVsMarket[asset];
    const pnl      = market - cost;
    const pnlPct   = cost > 0 ? (pnl / cost) * 100 : 0;
    const allocPct = totalMarket > 0 ? (market / totalMarket) * 100 : 0;
    const color    = ASSET_COLORS[asset] || '#94a3b8';
    const barPct   = Math.min(100, Math.abs(pnlPct) / 50 * 100);

    return `
      <tr>
        <td>
          <div class="asset-badge">
            <div class="asset-swatch" style="background:${color};"></div>
            ${asset}
          </div>
        </td>
        <td>${allocPct.toFixed(1)}%</td>
        <td>${fmtUSD(cost)}</td>
        <td>${fmtUSD(market)}</td>
        <td class="${pnl >= 0 ? 'positive' : 'negative'}">
          ${pnl >= 0 ? '+' : '−'}${fmtUSD(Math.abs(pnl))}
        </td>
        <td>
          <div class="pnl-bar-wrap">
            <div class="pnl-bar-bg">
              <div class="pnl-bar-fill ${pnl < 0 ? 'negative' : ''}" style="width:${barPct}%;"></div>
            </div>
            <span class="${pnl >= 0 ? 'positive' : 'negative'}" style="min-width:48px;text-align:right;font-weight:600;">
              ${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%
            </span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.snapshots)) return null;

    snapshotsCache = {};
    for (const snap of data.snapshots) {
      snapshotsCache[snap.period] = snap;
    }

    const active = snapshotsCache[activePeriod];
    const lastEl = document.getElementById('lastComputedTime');
    if (lastEl && active && active.computed_at) {
      lastEl.textContent = new Date(active.computed_at).toLocaleString();
    }

    setStatus(true);
    return snapshotsCache;
  } catch (err) {
    console.error('[analytics] loadAnalytics failed:', err);
    setStatus(false);
    return null;
  }
}

async function loadHistory(period) {
  const range = PERIOD_RANGE[period] || 'all';
  try {
    const res = await fetch(`/api/history?range=${range}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.points || []);
  } catch (err) {
    console.error('[analytics] loadHistory failed:', err);
    return [];
  }
}

async function selectPeriod(period, btn) {
  activePeriod = period;
  document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const snap = snapshotsCache[period];
  if (!snap) {
    showSkeletons();
    renderPortfolioChart([]);
    renderCostMarketChart({});
    renderAllocTable({});
    renderCashDragCard(null, {}, null);
    renderCashAssetsChart([], [], null);
    renderRiskProfile(null, {}, null, []);
    return;
  }

  renderCards(snap);

  const costVsMarket = snap.cost_vs_market_json ? JSON.parse(snap.cost_vs_market_json) : {};
  renderCostMarketChart(costVsMarket);
  renderAllocTable(costVsMarket);

  const cashCtx = await getCashContext();
  renderCashDragCard(snap, costVsMarket, cashCtx);

  const historyPoints = await loadHistory(period);
  renderPortfolioChart(historyPoints);
  const cashEntries = await getCashEntries();
  renderCashAssetsChart(historyPoints, cashEntries, cashCtx);
  renderRiskProfile(snap, costVsMarket, cashCtx, historyPoints);
}


document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('#cashAssetsCurrencyToggle .currency-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMode = btn.dataset.mode === CASH_CHART_MODE.CASH_CURRENCIES
        ? CASH_CHART_MODE.CASH_CURRENCIES
        : CASH_CHART_MODE.ASSETS_CASH;
      if (nextMode === cashAssetsViewMode) return;
      cashAssetsViewMode = nextMode;
      renderCashAssetsChart(
        cashAssetsLastInputs.historyPoints,
        cashAssetsLastInputs.cashEntries,
        cashAssetsLastInputs.cashCtx,
      );
    });
  });

  showSkeletons();
  await loadAnalytics();
  const defaultBtn = document.querySelector(`.period-tab[data-period="${activePeriod}"]`);
  await selectPeriod(activePeriod, defaultBtn);
});
