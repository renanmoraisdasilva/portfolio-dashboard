import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import { formatMoney, parseMoney, type Currency } from '@portfolio-dashboard/shared';
import { request, useApi } from './useApi';

/**
 * Cash balances, the interest ledgers and the cash-entry log — extracted from
 * `stores/dashboard.ts` (IMPROVEMENT-PLAN 4.1, third slice).
 *
 * The balances themselves are server state: `reloadState()` and `fetchPrices`
 * live in the store and write into these refs through the same destructure
 * every other slice uses, which is why the names in the store's return block
 * do not move. What the slice owns end to end is the write path — the forms'
 * optimistic list edits, the request, and the reload afterwards; that reload
 * is the only dep, because the balances come back with it.
 *
 * The two `*MonthsCollapsed` prefs ride along with the interest panel they
 * belong to. Their names are the ones the persist plugin mirrors, so moving
 * the refs does not move or drop the localStorage key.
 */

export interface InterestMonth {
  month: string;
  amount: number;
  currency?: string;
}

type CashEntry = components['schemas']['CashEntry'];

const CASH_ENTRIES_PAGE_SIZE = 5;

export interface CashflowDeps {
  /** Reload the server state after a write; the balances and ledgers come back with it. */
  readonly afterWrite: () => Promise<void>;
}

export function useCashflow(deps: CashflowDeps) {
  const api = useApi();

  const cashReais = ref(0);
  const cashDollars = ref(0);
  const interestReais = ref(0);
  const interestDollars = ref(0);
  const interestReaisMonths = ref<InterestMonth[]>([]);
  const interestDollarsMonths = ref<InterestMonth[]>([]);
  const cdiRate = ref(0);

  const interestMonthsCollapsed = ref(true);
  const interestUSDMonthsCollapsed = ref(true);

  const entryCurrency = ref<Currency>('USD');
  const cashEntries = ref<CashEntry[]>([]);
  const cashEntriesPage = ref(1);

  async function addInterestMonth(currency: Currency, month: string, raw: string): Promise<string | null> {
    const amount = +parseMoney(raw, currency).toFixed(2) || 0;
    if (!month) return 'Please select a month';
    const list = currency === 'BRL' ? interestReaisMonths : interestDollarsMonths;
    const idx = list.value.findIndex((m) => m.month === month);
    if (idx >= 0) list.value[idx].amount = amount;
    else list.value.push(currency === 'USD' ? { month, amount, currency: 'USD' } : { month, amount });
    list.value.sort((a, b) => b.month.localeCompare(a.month));
    let truncated = false;
    if (list.value.length > 12) {
      list.value = list.value.slice(0, 12);
      truncated = true;
    }
    if (currency === 'BRL') interestMonthsCollapsed.value = false;
    else interestUSDMonthsCollapsed.value = false;

    await request(
      api.POST('/interest/months', {
        body: currency === 'USD' ? { month, amount, currency: 'USD' } : { month, amount },
      }),
      'POST',
      '/interest/months',
    );
    return truncated ? 'Keeping only latest 12 months; oldest entry removed.' : null;
  }

  async function deleteInterestMonth(currency: Currency, month: string): Promise<void> {
    if (currency === 'BRL') interestReaisMonths.value = interestReaisMonths.value.filter((m) => m.month !== month);
    else interestDollarsMonths.value = interestDollarsMonths.value.filter((m) => m.month !== month);
    await request(
      api.DELETE('/interest/months/{month}', {
        params: {
          path: { month },
          ...(currency === 'USD' ? { query: { currency: 'USD' } } : {}),
        },
      }),
      'DELETE',
      '/interest/months/{month}',
    );
    await deps.afterWrite();
  }

  async function loadCashEntries(page?: number): Promise<void> {
    if (page !== undefined) cashEntriesPage.value = page;
    const entries = await request(api.GET('/cash/entries'), 'GET', '/cash/entries');
    cashEntries.value = Array.isArray(entries) ? entries : [];
  }

  const cashEntriesPages = computed(() => Math.ceil(cashEntries.value.length / CASH_ENTRIES_PAGE_SIZE));
  const cashEntryRows = computed(() => {
    const total = cashEntriesPages.value;
    const current = Math.max(1, Math.min(cashEntriesPage.value, total || 1));
    const start = (current - 1) * CASH_ENTRIES_PAGE_SIZE;
    return cashEntries.value.slice(start, start + CASH_ENTRIES_PAGE_SIZE).map((e) => ({
      id: e.id ?? '',
      date: new Date(e.ts ?? 0).toLocaleDateString('pt-BR'),
      currency: e.currency ?? 'USD',
      amount: formatMoney(e.amount ?? 0, e.currency === 'BRL' ? 'BRL' : 'USD'),
      positive: (e.amount ?? 0) >= 0,
    }));
  });

  async function addCashEntry(amountText: string, date: string): Promise<string | null> {
    const raw = amountText.trim();
    const amount = parseFloat(raw.replace(/[^\d.-]/g, ''));
    if (!raw || isNaN(amount) || amount === 0) return 'Enter a non-zero amount (e.g. +1000 or -500)';
    const ts = date ? new Date(`${date}T12:00:00`).getTime() : Date.now();

    try {
      await request(api.POST('/cash/entries', { body: { currency: entryCurrency.value, amount, ts } }), 'POST', '/cash/entries');
    } catch (err) {
      console.warn('[dashboard] add cash entry failed:', err);
      return 'Failed to add cash entry';
    }
    await Promise.all([loadCashEntries(1), deps.afterWrite()]);
    return null;
  }

  async function deleteCashEntry(id: string): Promise<string | null> {
    try {
      await request(api.DELETE('/cash/entries/{id}', { params: { path: { id } } }), 'DELETE', '/cash/entries/{id}');
    } catch (err) {
      console.warn('[dashboard] delete cash entry failed:', err);
      return 'Failed to delete cash entry';
    }
    await Promise.all([loadCashEntries(), deps.afterWrite()]);
    return null;
  }

  return {
    cashReais,
    cashDollars,
    interestReais,
    interestDollars,
    interestReaisMonths,
    interestDollarsMonths,
    cdiRate,
    interestMonthsCollapsed,
    interestUSDMonthsCollapsed,
    entryCurrency,
    cashEntries,
    cashEntriesPage,
    cashEntriesPages,
    cashEntryRows,
    loadCashEntries,
    addCashEntry,
    deleteCashEntry,
    addInterestMonth,
    deleteInterestMonth,
  };
}
