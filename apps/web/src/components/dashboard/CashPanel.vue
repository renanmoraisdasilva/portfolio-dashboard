<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatMoney, parseMoney } from '@portfolio-dashboard/shared';
import { useDashboardStore, type Currency } from '../../stores/dashboard';
import { useToast } from '../../composables/useToast';

const store = useDashboardStore();
const { show } = useToast();

const brlMonth = ref('');
const brlAmount = ref('');
const usdMonth = ref('');
const usdAmount = ref('');
const entryAmount = ref('');
const entryDate = ref('');

const brlSummary = computed(() => {
  const total = store.interestReaisMonths.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  return `${store.interestReaisMonths.length} month(s) recorded • Total: ${formatMoney(total, 'BRL')}`;
});
const usdSummary = computed(() => {
  const total = store.interestDollarsMonths.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  return `${store.interestDollarsMonths.length} month(s) recorded • Total: ${formatMoney(total, 'USD')}`;
});

const brlTotal = computed(() => store.interestReaisMonths.reduce((s, m) => s + (Number(m.amount) || 0), 0));
const usdTotal = computed(() => store.interestDollarsMonths.reduce((s, m) => s + (Number(m.amount) || 0), 0));

function fmtBrlInput(event: Event): void {
  brlAmount.value = formatMoney(+parseMoney((event.target as HTMLInputElement).value, 'BRL').toFixed(2), 'BRL');
}

async function submitInterest(currency: Currency): Promise<void> {
  const month = currency === 'BRL' ? brlMonth.value : usdMonth.value;
  const amount = currency === 'BRL' ? brlAmount.value : usdAmount.value;
  const message = await store.addInterestMonth(currency, month, amount);
  if (message) {
    show(message, 'error');
    return;
  }
  if (currency === 'BRL') {
    brlMonth.value = '';
    brlAmount.value = '';
  } else {
    usdMonth.value = '';
    usdAmount.value = '';
  }
}

async function submitEntry(): Promise<void> {
  const message = await store.addCashEntry(entryAmount.value, entryDate.value);
  if (message) {
    show(message, 'error');
    return;
  }
  entryAmount.value = '';
  entryDate.value = '';
}

async function removeEntry(id: string): Promise<void> {
  if (!window.confirm('Delete this cash entry?')) return;
  const message = await store.deleteCashEntry(id);
  if (message) show(message, 'error');
}
</script>

<template>
  <div style="display: flex; gap: 24px; margin-bottom: 20px">
    <div>
      <div class="balance-label">BRL Balance</div>
      <div class="balance-value">{{ formatMoney(store.cashReais, 'BRL') }}</div>
    </div>
    <div>
      <div class="balance-label">USD Balance</div>
      <div class="balance-value">{{ formatMoney(store.cashDollars, 'USD') }}</div>
    </div>
  </div>

  <div class="cash-entry-form">
    <div class="cash-entry-row">
      <div class="cash-entry-currency">
        <label class="small">Currency</label>
        <div style="display: flex; gap: 6px; margin-top: 10px">
          <button
            class="chip"
            :class="{ active: store.entryCurrency === 'BRL' }"
            type="button"
            @click="store.entryCurrency = 'BRL'"
          >
            BRL
          </button>
          <button
            class="chip"
            :class="{ active: store.entryCurrency === 'USD' }"
            type="button"
            @click="store.entryCurrency = 'USD'"
          >
            USD
          </button>
        </div>
      </div>
      <div class="cash-entry-amount">
        <label class="small">Amount</label>
        <input v-model="entryAmount" class="sim-input" placeholder="+1000 or -500" style="width: 100%; margin-top: 6px" />
      </div>
    </div>
    <div class="cash-entry-row">
      <div class="cash-entry-date">
        <label class="small">Date</label>
        <input v-model="entryDate" class="sim-input" type="date" style="width: 100%; margin-top: 6px" />
      </div>
      <div class="cash-entry-submit">
        <button class="btn btn-primary" style="height: 42px; width: 100%; white-space: nowrap" @click="submitEntry">
          Add Entry
        </button>
      </div>
    </div>
  </div>

  <div class="table-container" style="margin-bottom: 12px">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Currency</th>
          <th>Amount</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="store.cashEntryRows.length === 0">
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 16px">No cash entries yet.</td>
        </tr>
        <tr v-for="row in store.cashEntryRows" :key="row.id">
          <td>{{ row.date }}</td>
          <td>{{ row.currency }}</td>
          <td :class="row.positive ? 'positive' : 'negative'">{{ row.amount }}</td>
          <td>
            <button class="btn btn-sm" style="padding: 2px 10px; font-size: 0.75rem" @click="removeEntry(row.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-if="store.cashEntriesPages > 1"
    style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 24px"
  >
    <button
      class="btn btn-sm"
      :disabled="store.cashEntriesPage === 1"
      style="padding: 2px 10px; font-size: 0.75rem"
      @click="store.loadCashEntries(store.cashEntriesPage - 1)"
    >
      ‹ Prev
    </button>
    <span style="font-size: 0.85rem; color: var(--text-muted)"
      >Page {{ store.cashEntriesPage }} of {{ store.cashEntriesPages }}</span
    >
    <button
      class="btn btn-sm"
      :disabled="store.cashEntriesPage === store.cashEntriesPages"
      style="padding: 2px 10px; font-size: 0.75rem"
      @click="store.loadCashEntries(store.cashEntriesPage + 1)"
    >
      Next ›
    </button>
  </div>

  <div class="cash-columns">
    <div class="cash-column">
      <h4>BRL Monthly Interest <small class="subnote">— 100% CDI earnings</small></h4>
      <div class="month-controls">
        <div class="interest-month-row">
          <div class="interest-month-field">
            <label for="interestMonth">Month</label>
            <input id="interestMonth" v-model="brlMonth" type="month" style="width: 100%" />
          </div>
          <div class="interest-amount-field">
            <label for="interestMonthAmount">Amount (BRL)</label>
            <input
              id="interestMonthAmount"
              class="sim-input"
              placeholder="0.00"
              step="any"
              style="width: 100%"
              :value="brlAmount"
              @change="fmtBrlInput"
            />
          </div>
          <div class="interest-btn-field">
            <button class="btn btn-primary" style="width: 100%" @click="submitInterest('BRL')">Add Month</button>
          </div>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
            <div style="font-size: 0.9rem; color: #94a3b8">
              <span v-if="store.interestReaisMonths.length === 0"
                ><span class="empty-state">No monthly interest recorded.</span></span
              >
              <span v-else>{{ brlSummary }}</span>
            </div>
            <button
              v-if="store.interestReaisMonths.length > 0"
              class="btn"
              :aria-expanded="!store.interestMonthsCollapsed"
              style="padding: 6px 10px"
              @click="store.interestMonthsCollapsed = !store.interestMonthsCollapsed"
            >
              {{ store.interestMonthsCollapsed ? 'Show ▲' : 'Hide ▼' }}
            </button>
          </div>

          <div v-if="!store.interestMonthsCollapsed">
            <div
              v-for="m in store.interestReaisMonths"
              :key="m.month"
              style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px"
            >
              <div style="flex: 1">{{ m.month }}</div>
              <div style="width: 120px; text-align: right">{{ formatMoney(Number(m.amount || 0), 'BRL') }}</div>
              <div>
                <button class="btn btn-danger" style="padding: 4px 8px" @click="store.deleteInterestMonth('BRL', m.month)">
                  Delete
                </button>
              </div>
            </div>
            <div style="margin-top: 8px; font-size: 0.9rem; color: #94a3b8">
              Total (months recorded): R$ {{ brlTotal.toFixed(2) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="cash-column">
      <h4>USD Interest <small class="subnote">— earned interest</small></h4>
      <div class="month-controls">
        <div class="interest-month-row">
          <div class="interest-month-field">
            <label for="interestUSDMonth">Month</label>
            <input id="interestUSDMonth" v-model="usdMonth" class="sim-input" type="month" style="width: 100%" />
          </div>
          <div class="interest-amount-field">
            <label for="interestUSDMonthAmount">Amount (USD)</label>
            <input id="interestUSDMonthAmount" v-model="usdAmount" class="sim-input" placeholder="0.00" style="width: 100%" />
          </div>
          <div class="interest-btn-field">
            <button class="btn btn-primary" style="width: 100%" @click="submitInterest('USD')">Add Month</button>
          </div>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
            <div style="font-size: 0.9rem; color: #94a3b8">
              <span v-if="store.interestDollarsMonths.length === 0"
                ><span class="empty-state">No monthly USD interest recorded.</span></span
              >
              <span v-else>{{ usdSummary }}</span>
            </div>
            <button
              v-if="store.interestDollarsMonths.length > 0"
              class="btn"
              :aria-expanded="!store.interestUSDMonthsCollapsed"
              style="padding: 6px 10px"
              @click="store.interestUSDMonthsCollapsed = !store.interestUSDMonthsCollapsed"
            >
              {{ store.interestUSDMonthsCollapsed ? 'Show ▲' : 'Hide ▼' }}
            </button>
          </div>

          <div v-if="!store.interestUSDMonthsCollapsed">
            <div
              v-for="m in store.interestDollarsMonths"
              :key="m.month"
              style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px"
            >
              <div style="flex: 1">{{ m.month }}</div>
              <div style="width: 120px; text-align: right">{{ formatMoney(Number(m.amount || 0), 'USD') }}</div>
              <div>
                <button class="btn btn-danger" style="padding: 4px 8px" @click="store.deleteInterestMonth('USD', m.month)">
                  Delete
                </button>
              </div>
            </div>
            <div style="margin-top: 8px; font-size: 0.9rem; color: #94a3b8">
              Total (months recorded): $ {{ usdTotal.toFixed(2) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.balance-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.balance-value {
  font-size: 1.25rem;
  font-weight: 700;
  margin-top: 2px;
}
</style>
