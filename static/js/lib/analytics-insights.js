(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AnalyticsInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function buildCashAssetSeries(historyPoints, cashEntries, defaultBrlUsd) {
    const points = Array.isArray(historyPoints) ? [...historyPoints] : [];
    const entries = Array.isArray(cashEntries) ? [...cashEntries] : [];
    points.sort((a, b) => toNumber(a.ts, 0) - toNumber(b.ts, 0));
    entries.sort((a, b) => toNumber(a.ts, 0) - toNumber(b.ts, 0));

    let idx = 0;
    let cashBRL = 0;
    let cashUSDNative = 0;
    const out = [];

    for (const p of points) {
      const ts = toNumber(p.ts, 0);
      while (idx < entries.length && toNumber(entries[idx].ts, 0) <= ts) {
        const e = entries[idx];
        const amount = toNumber(e.amount, 0);
        if (e.currency === 'BRL') cashBRL += amount;
        if (e.currency === 'USD') cashUSDNative += amount;
        idx++;
      }

      const fx = toNumber(p.brlusd_rate, toNumber(defaultBrlUsd, 1));
      const cashUSD = cashUSDNative + cashBRL * fx;
      const totalUSD = toNumber(p.v, 0);
      const assetsUSD = Math.max(0, totalUSD - cashUSD);

      out.push({ ts, cashUSD, assetsUSD, totalUSD });
    }

    return out;
  }

  function buildCashCurrencySeries(historyPoints, cashEntries) {
    const points = Array.isArray(historyPoints) ? [...historyPoints] : [];
    const entries = Array.isArray(cashEntries) ? [...cashEntries] : [];
    points.sort((a, b) => toNumber(a.ts, 0) - toNumber(b.ts, 0));
    entries.sort((a, b) => toNumber(a.ts, 0) - toNumber(b.ts, 0));

    let idx = 0;
    let runningCashBRL = 0;
    let runningCashUSDNative = 0;
    const out = [];

    for (const p of points) {
      const ts = toNumber(p.ts, 0);
      while (idx < entries.length && toNumber(entries[idx].ts, 0) <= ts) {
        const e = entries[idx];
        const amount = toNumber(e.amount, 0);
        if (e.currency === 'BRL') runningCashBRL += amount;
        if (e.currency === 'USD') runningCashUSDNative += amount;
        idx++;
      }
      out.push({ ts, cashBRL: runningCashBRL, cashUSDNative: runningCashUSDNative });
    }

    return out;
  }

  function computeCorrelatedAxisMax(cashBRLSeries, cashUSDSeries, fxRef, paddingFactor) {
    const brl = Array.isArray(cashBRLSeries) ? cashBRLSeries : [];
    const usd = Array.isArray(cashUSDSeries) ? cashUSDSeries : [];
    const padding = toNumber(paddingFactor, 1.08);
    const fxRaw = toNumber(fxRef, 1);
    const fx = fxRaw > 0 ? fxRaw : 1;

    const maxBRL = brl.length ? Math.max(...brl.map(v => toNumber(v, 0))) : 0;
    const maxUSD = usd.length ? Math.max(...usd.map(v => toNumber(v, 0))) : 0;
    const unifiedMaxBRL = Math.max(maxBRL, maxUSD / fx);
    const yBRLMax = Math.max(1, unifiedMaxBRL * padding);
    const yUSDMax = yBRLMax * fx;

    return {
      fx,
      yBRLMax,
      yUSDMax,
      ratio: yUSDMax / yBRLMax,
    };
  }

  function computePnlReturns(historyPoints) {
    const points = Array.isArray(historyPoints) ? [...historyPoints] : [];
    points.sort((a, b) => toNumber(a.ts, 0) - toNumber(b.ts, 0));

    const returns = [];
    for (let i = 1; i < points.length; i++) {
      const prevI = toNumber(points[i - 1].i, 0);
      const prevP = toNumber(points[i - 1].p, NaN);
      const currP = toNumber(points[i].p, NaN);
      if (prevI <= 0 || !Number.isFinite(prevP) || !Number.isFinite(currP)) continue;
      returns.push((currP - prevP) / prevI);
    }
    return returns;
  }

  function stdDev(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const mean = values.reduce((s, x) => s + x, 0) / values.length;
    const variance = values.reduce((s, x) => s + (x - mean) * (x - mean), 0) / values.length;
    return Math.sqrt(variance);
  }

  function computeRiskProfile(input) {
    const drawdownPct = toNumber(input.drawdownPct, 0);
    const sharpeRatio = toNumber(input.sharpeRatio, 0);
    const cashPct = toNumber(input.cashPct, 0);
    const deployableCashPct = toNumber(input.deployableCashPct, 0);
    const emergencyCoverage = toNumber(input.emergencyCoverage, 0);
    const maxAssetAllocPct = toNumber(input.maxAssetAllocPct, 0);
    const periodReturnPct = toNumber(input.periodReturnPct, 0);
    const pnlStdPct = toNumber(input.pnlStdPct, 0);

    const ddRisk = Math.min(35, drawdownPct * 1.8);

    let sharpeRisk = 12;
    if (sharpeRatio >= 1.5) sharpeRisk = 0;
    else if (sharpeRatio >= 1) sharpeRisk = 4;
    else if (sharpeRatio >= 0.5) sharpeRisk = 10;
    else if (sharpeRatio >= 0) sharpeRisk = 18;
    else if (sharpeRatio >= -1) sharpeRisk = 28;
    else sharpeRisk = 35;

    const concentrationRisk = Math.min(20, Math.max(0, maxAssetAllocPct - 35) * 0.9);
    const volRisk = Math.min(20, pnlStdPct * 5.0);

    // Opportunity-cost risk is attached only to deployable cash, not the protected emergency buffer.
    let deployableCashRisk;
    if (periodReturnPct >= 0) {
      deployableCashRisk = Math.min(12, deployableCashPct * 0.35);
    } else {
      deployableCashRisk = Math.min(5, deployableCashPct * 0.12);
    }

    // Cash buffer provides downside protection and should reduce overall market risk.
    const cashBufferCredit = emergencyCoverage >= 1
      ? Math.min(12, 6 + (emergencyCoverage - 1) * 6)
      : 0;
    const emergencyShortfallRisk = emergencyCoverage < 1
      ? Math.min(15, (1 - emergencyCoverage) * 15)
      : 0;

    const rawScore = ddRisk + sharpeRisk + concentrationRisk + volRisk + deployableCashRisk + emergencyShortfallRisk - cashBufferCredit;
    const score = Math.max(0, Math.min(100, rawScore));

    let label = 'Low';
    if (score >= 70) label = 'Very High';
    else if (score >= 55) label = 'High';
    else if (score >= 35) label = 'Moderate';

    return {
      score,
      label,
      components: {
        ddRisk,
        sharpeRisk,
        concentrationRisk,
        volRisk,
        deployableCashRisk,
        emergencyShortfallRisk,
        cashBufferCredit,
      },
    };
  }

  return {
    buildCashAssetSeries,
    buildCashCurrencySeries,
    computeCorrelatedAxisMax,
    computePnlReturns,
    stdDev,
    computeRiskProfile,
  };
});
