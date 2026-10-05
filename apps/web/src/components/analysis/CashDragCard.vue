<script setup lang="ts">
import { computed } from 'vue';
import { EMERGENCY_FUND_USD, useAnalyticsStore } from '../../stores/analytics';
import { fmtSignedUSD, fmtUSD } from '../../composables/useMoney';

const store = useAnalyticsStore();

const card = computed(() => {
  const snap = store.active;
  const cashCtx = store.cashContext;
  if (!snap || !cashCtx) return null;

  const cashUSD = store.cashUSD;
  const cashPct = store.cashPct;
  const protectedCashUSD = Math.min(cashUSD, EMERGENCY_FUND_USD);
  const deployableCashUSD = store.deployableCashUSD;
  const deployableCashPct = store.deployableCashPct;
  const emergencyCoverage = store.emergencyCoverage;

  const inputs = snap.return_inputs ?? null;
  const startInvested = Number(inputs?.start_invested || 0);
  const interestUSD = Number(inputs?.interest_period_usd || 0);
  const periodRetPct = Number(snap.return_pct || 0);

  const expectedCashPnL = deployableCashUSD * (periodRetPct / 100);
  const carryGapUSD = interestUSD - expectedCashPnL;
  const carryGapPctStart = startInvested > 0 ? (carryGapUSD / startInvested) * 100 : 0;

  let badge = 'Balanced';
  let badgeClass = 'analysis-badge';
  let headline = 'Cash stance looks reasonable versus your emergency buffer.';

  if (emergencyCoverage < 1) {
    badge = 'Below Buffer';
    badgeClass = 'analysis-badge danger';
    headline = 'Emergency reserve is under the 50k target.';
  } else if (deployableCashPct >= 30) {
    badge = 'Heavy Cash';
    badgeClass = 'analysis-badge warn';
    headline = 'Deployable cash is high; upside participation may be reduced.';
  } else if (periodRetPct < 0 && carryGapUSD > 0) {
    badge = 'Defensive';
    badgeClass = 'analysis-badge';
    headline = 'Cash and carry helped cushion a weak period.';
  }

  return {
    badge,
    badgeClass,
    headline,
    cashSplitText: `${fmtUSD(cashUSD)} total (${cashPct.toFixed(1)}%)`,
    cashBreakdownText: `${fmtUSD(protectedCashUSD)} protected + ${fmtUSD(deployableCashUSD)} deployable (${deployableCashPct.toFixed(1)}%)`,
    emergencyText: `Target ${fmtUSD(EMERGENCY_FUND_USD)} · Coverage ${(emergencyCoverage * 100).toFixed(1)}%`,
    emergencyOk: emergencyCoverage >= 1,
    interestText: `${fmtSignedUSD(interestUSD)} this period`,
    interestOk: interestUSD >= 0,
    gapLabel: carryGapUSD >= 0 ? 'carry benefit' : 'estimated drag',
    gapOk: carryGapUSD >= 0,
    gapColor: carryGapUSD >= 0 ? '#22c55e' : '#ef4444',
    netEffectText: `${fmtSignedUSD(carryGapUSD)} (${carryGapPctStart >= 0 ? '+' : ''}${carryGapPctStart.toFixed(2)}% of start invested)`,
    expectedText: `${fmtUSD(deployableCashUSD)} × ${periodRetPct.toFixed(2)}% = ${fmtSignedUSD(expectedCashPnL)}`,
    netFormulaText: `${fmtSignedUSD(interestUSD)} − ${fmtSignedUSD(expectedCashPnL)} = ${fmtSignedUSD(carryGapUSD)}`,
  };
});
</script>

<template>
  <div class="analysis-card cash-analysis-card">
    <div class="analysis-header">
      <span class="analysis-icon">🏦</span>
      <span class="analysis-title">Cash Drag &amp; Interest Carry</span>
      <span :class="card ? card.badgeClass : 'analysis-badge'">{{ card ? card.badge : 'Unavailable' }}</span>
    </div>

    <div class="analysis-signals">
      <template v-if="card">
        <div class="analysis-signal cash-headline">
          <div class="signal-dot" style="background: #14b8a6"></div>
          <span>{{ card.headline }}</span>
        </div>

        <div class="cash-kpi-grid">
          <div class="cash-kpi-item">
            <div class="cash-kpi-label cash-kpi-label-neutral">
              <span class="cash-kpi-icon" aria-hidden="true">💧</span>Cash split
            </div>
            <div class="cash-kpi-value">{{ card.cashSplitText }}</div>
            <div class="cash-kpi-sub">{{ card.cashBreakdownText }}</div>
          </div>

          <div class="cash-kpi-item">
            <div class="cash-kpi-label" :class="card.emergencyOk ? 'cash-kpi-label-good' : 'cash-kpi-label-bad'">
              <span class="cash-kpi-icon" aria-hidden="true">🛟</span>Emergency fund
            </div>
            <div class="cash-kpi-value">{{ card.emergencyText }}</div>
          </div>

          <div class="cash-kpi-item">
            <div class="cash-kpi-label" :class="card.interestOk ? 'cash-kpi-label-good' : 'cash-kpi-label-bad'">
              <span class="cash-kpi-icon" aria-hidden="true">🏛️</span>Interest carry
            </div>
            <div class="cash-kpi-value">{{ card.interestText }}</div>
          </div>

          <div class="cash-kpi-item">
            <div class="cash-kpi-label" :class="card.gapOk ? 'cash-kpi-label-good' : 'cash-kpi-label-bad'">
              <span class="cash-kpi-icon" aria-hidden="true">⚖️</span>{{ card.gapLabel }}
            </div>
            <div class="cash-kpi-value" :style="{ color: card.gapColor, fontWeight: 700 }">
              {{ card.netEffectText }}
            </div>
          </div>
        </div>

        <div class="cash-formula">
          <div class="cash-formula-title">How this was computed</div>
          <div class="cash-formula-line">
            Expected deployable-cash P/L: <span class="cash-mono">{{ card.expectedText }}</span>
          </div>
          <div class="cash-formula-line">
            Net effect: <span class="cash-mono">{{ card.netFormulaText }}</span>
          </div>
        </div>
      </template>

      <div v-else class="analysis-signal">
        <div class="signal-dot" style="background: #64748b"></div>
        <span>Could not load cash diagnostics.</span>
      </div>
    </div>
  </div>
</template>
