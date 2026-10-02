import { describe, expect, test } from 'vitest';
import { validateImportPayload } from './statePayload';

/**
 * `POST /api/state/import` shape validation.
 *
 * The tests are grouped by what each rule is *for*, because the interesting
 * cases are not the missing-field ones — the database catches those. They are the
 * rows that used to restore **successfully and wrongly**, which is the failure a
 * user cannot detect from the app afterwards: nothing throws, nothing logs, and
 * the number on the dashboard is simply wrong.
 *
 * Every "would have been accepted" claim below was measured against the real
 * column definitions rather than asserted from memory, because the claim is that
 * SQLite *would not* have complained. Two of them turned out to be wrong on the
 * first pass and are corrected in the tests that cover them: a NULL `trades.id`
 * *is* rejected by the `NOT NULL` on that column, and `days: "30"` *is* found by
 * the integer reader because affinity converts it. The real trap is a value
 * affinity cannot convert.
 */
const problemsOf = (payload: unknown) => validateImportPayload(payload).problems;

/** A row that passes every rule, used as the base for single-field mutations. */
const validTrade = { id: 't1', symbol: 'BTC', side: 'buy', qty: 0.05, price: 64_002, time: '2026-01-01T00:00:00.000Z' };
const validHistory = { id: 's1', t: '2026-08-10T22:22:08.000Z', ts: 1780147023633, v: 42_000, i: 40_000, p: 2_000 };
const validInterest = { month: '2026-08', amount: 1_234.56 };
const validAlert = { symbol: 'BTC', alert_type: 'value', threshold: 50_000, condition: 'below' };
const validChart = { symbol: 'BTC', days: 30, interval: '1h', ts: 1780147023633, data: '{"labels":[]}' };
const validAnalytics = { id: 'a1', computed_at: 1780147023633, period: '1M', return_pct: 1.2 };
const validCash = { id: 'c1', currency: 'USD', amount: 100, description: 'x', ts: 1780147023633 };

describe('validateImportPayload — the payload itself', () => {
  test.each([[null], [undefined], ['a string'], [42], [[]], [true]])('rejects %p as not a backup', (body) => {
    const { problems } = validateImportPayload(body);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({ table: '(payload)', index: null, reason: 'must be a JSON object' });
  });

  test('an empty object is a valid no-op restore, not an error', () => {
    // Every key is optional and its absence leaves the table alone, so `{}` means
    // "change nothing". Refusing it would break a legitimately empty database.
    expect(problemsOf({})).toEqual([]);
  });

  test('rejects a non-numeric formatVersion rather than ignoring it', () => {
    // The version is how an old file is recognised. A string here would compare
    // false against EXPORT_FORMAT_VERSION in any code that checked it, silently.
    const { problems } = validateImportPayload({ formatVersion: '2' });
    expect(problems[0].reason).toContain('`formatVersion` must be a number');
  });

  test('accepts a numeric formatVersion, including an older one', () => {
    expect(problemsOf({ formatVersion: 2 })).toEqual([]);
    expect(problemsOf({ formatVersion: 1 })).toEqual([]);
  });
});

describe('validateImportPayload — keys that are present but not arrays', () => {
  test.each([
    ['trades', {}],
    ['history', 'not an array'],
    ['alerts', 7],
    ['cashEntries', null],
  ])('flags `%s` as the wrong type', (key, bad) => {
    const { problems } = validateImportPayload({ [key]: bad });
    expect(problems).toEqual([{ table: key, index: null, reason: 'must be an array' }]);
  });

  test('a key that is absent is not flagged — a partial backup must stay importable', () => {
    expect(problemsOf({ trades: [validTrade] })).toEqual([]);
  });

  test('the scalar cash fields are not mistaken for array keys', () => {
    // `cashReais` / `cashDollars` feed a documented path that synthesises cash
    // entries. Flagging them would reject every version 1 backup.
    expect(problemsOf({ cashReais: 100, cashDollars: 200 })).toEqual([]);
  });
});

describe('validateImportPayload — rows that would restore silently wrong', () => {
  test('a trade with no id is refused with a row index instead of a constraint error', () => {
    // Migration `0000` declares `id text PRIMARY KEY NOT NULL`, so this *does*
    // throw — `NOT NULL constraint failed: trades.id`, measured. What the
    // database does not give is the part a person needs: which table, which row,
    // which field. The check moves that from unavailable into the response.
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, id: undefined }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`id` must be a non-empty string' });
  });

  test('a price_cache row with a null price is refused', () => {
    // Nullable in the schema, so SQLite takes it. `/api/prices` then reports no
    // price for that symbol and the position values at zero until the worker's
    // next fetch - with nothing to indicate a restore caused it.
    const { problems } = validateImportPayload({ priceCache: [{ symbol: 'BTC', price: null, ts: 1 }] });
    expect(problems).toContainEqual({ table: 'priceCache', index: 0, reason: '`price` must be a finite number' });
  });

  test('a cash entry in a currency the balance query does not sum is refused', () => {
    // The balance is `SUM(CASE WHEN currency='BRL' … ELSE 0 END)` and the same
    // for USD. A third currency is stored and counted by nothing, so the restored
    // balance disagrees with the sum of its own entries.
    const { problems } = validateImportPayload({ cashEntries: [{ ...validCash, currency: 'EUR' }] });
    expect(problems).toContainEqual({ table: 'cashEntries', index: 0, reason: '`currency` must be "BRL" or "USD"' });
  });

  test('a cash entry with a missing amount is refused', () => {
    const { problems } = validateImportPayload({ cashEntries: [{ ...validCash, amount: undefined }] });
    expect(problems).toContainEqual({ table: 'cashEntries', index: 0, reason: '`amount` must be a finite number' });
  });

  test('a scenario whose data is an object is refused rather than stored as "[object Object]"', () => {
    // `data` is TEXT and the insert takes any value, so a hand-edited file with a
    // real object is stringified by the driver into something unreadable.
    const asObject = validateImportPayload({ scenarios: [{ name: 's', data: { allocations: [] } }] });
    expect(asObject.problems).toContainEqual({
      table: 'scenarios',
      index: 0,
      reason: '`data` must be a JSON string',
    });

    const asBrokenJson = validateImportPayload({ scenarios: [{ name: 's', data: '{not json' }] });
    expect(asBrokenJson.problems).toContainEqual({
      table: 'scenarios',
      index: 0,
      reason: '`data` is not valid JSON',
    });
  });

  test('a scenario whose data is a JSON string is accepted', () => {
    expect(problemsOf({ scenarios: [{ name: 's', data: '{"allocations":[]}' }] })).toEqual([]);
  });

  test('an interest month with a null amount is refused', () => {
    // `interest.amount` is nullable and `SUM` skips NULL, so the month restores
    // and counts as nothing — recorded income silently too low, no error.
    const { problems } = validateImportPayload({ interestReaisMonths: [{ month: '2026-08', amount: null }] });
    expect(problems).toContainEqual({
      table: 'interestReaisMonths',
      index: 0,
      reason: '`amount` must be a finite number',
    });
  });

  test('a snapshot with a missing `v` is refused: the importer would default it to 0', () => {
    // `v ?? 0` turns a missing value into a real zero-height candle, which
    // flattens the chart and drags the drawdown calculation.
    const { problems } = validateImportPayload({ history: [{ ...validHistory, v: undefined }] });
    expect(problems).toContainEqual({ table: 'history', index: 0, reason: '`v` must be a finite number' });
  });

  test('a snapshot with a missing `ts` is refused: it would fall outside every period', () => {
    const { problems } = validateImportPayload({ history: [{ ...validHistory, ts: undefined }] });
    expect(problems).toContainEqual({ table: 'history', index: 0, reason: '`ts` must be a finite number' });
  });

  test('an asset chart row with a non-numeric `days` is refused', () => {
    // `days` is part of the composite primary key and the reader compares it as
    // `WHERE days = ?` against an integer. Measured: `"30"` is converted by
    // INTEGER affinity and *is* found again, but `"thirty"` is stored as TEXT and
    // never is — and neither value is rejected. So the trap is not the string, it
    // is the one affinity cannot convert.
    const { problems } = validateImportPayload({ assetChartCache: [{ ...validChart, days: 'thirty' }] });
    expect(problems).toContainEqual({ table: 'assetChartCache', index: 0, reason: '`days` must be a number' });

    // Both forms are refused, because the rule is "is a number" rather than a
    // judgement about which strings affinity happens to repair.
    expect(problemsOf({ assetChartCache: [{ ...validChart, days: '30' }] })).toHaveLength(1);
  });
});

describe('validateImportPayload — NOT NULL columns the importer does not default', () => {
  test.each([
    ['symbol', 'a non-empty string'],
    ['side', 'a non-empty string'],
    ['qty', 'a finite number'],
    ['time', 'a non-empty string'],
  ])('a trade missing `%s` is flagged with the expected type', (field, expectation) => {
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, [field]: undefined }] });
    expect(problems).toEqual([{ table: 'trades', index: 0, reason: `\`${field}\` must be ${expectation}` }]);
  });

  test.each([
    ['alerts', 'symbol', 'a non-empty string'],
    ['alerts', 'alert_type', 'a non-empty string'],
    ['alerts', 'threshold', 'a finite number'],
    ['alerts', 'condition', 'a non-empty string'],
    ['assetChartCache', 'symbol', 'a non-empty string'],
    ['assetChartCache', 'interval', 'a non-empty string'],
    ['analyticsSnapshots', 'period', 'a non-empty string'],
  ])('%s missing `%s` is flagged', (key, field, expectation) => {
    const base = { alerts: validAlert, assetChartCache: validChart, analyticsSnapshots: validAnalytics }[key as string];
    const { problems } = validateImportPayload({ [key]: [{ ...base, [field]: undefined }] });
    expect(problems).toContainEqual({ table: key, index: 0, reason: `\`${field}\` must be ${expectation}` });
  });

  test('a trade with a null qty is flagged — NOT NULL, and the FIFO walk would consume it', () => {
    // This one *would* have thrown and rolled the restore back, so the old 500 was
    // at least honest. It is listed here to pin that it is now a 400 naming the
    // row, which is the whole point of the change.
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, qty: null }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`qty` must be a finite number' });
  });
});

describe('validateImportPayload — uniqueness the database would turn into data loss', () => {
  test('two months with the same month in the same currency are flagged', () => {
    // `idx_interest_month_currency` is unique, and the write is `INSERT OR
    // REPLACE` — so the second row replaces the first and a month of income
    // disappears. The constraint does not fire, which is why this is checked here.
    const { problems } = validateImportPayload({
      interestReaisMonths: [validInterest, { ...validInterest }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].table).toBe('interestReaisMonths');
    expect(problems[0].index).toBe(1);
    expect(problems[0].reason).toContain('duplicate `month`');
    expect(problems[0].reason).toContain('the earlier row would be lost');
  });

  test('the same month in both currencies is not a duplicate', () => {
    // `month` is unique per *currency*, and the two payload keys are the two
    // currencies — so identical months across the keys are the normal case.
    expect(problemsOf({ interestReaisMonths: [validInterest], interestDollarsMonths: [{ ...validInterest }] })).toEqual([]);
  });

  test('duplicate months are checked within each key independently', () => {
    const { problems } = validateImportPayload({
      interestReaisMonths: [validInterest],
      interestDollarsMonths: [
        { month: '2026-07', amount: 1 },
        { month: '2026-07', amount: 2 },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].table).toBe('interestDollarsMonths');
    expect(problems[0].index).toBe(1);
  });

  test('two analytics snapshots for the same period are flagged', () => {
    // `idx_analytics_snapshots_period` is unique and the write is
    // `INSERT OR REPLACE`, so the second silently overwrites the first.
    const { problems } = validateImportPayload({
      analyticsSnapshots: [validAnalytics, { ...validAnalytics, id: 'a2' }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].table).toBe('analyticsSnapshots');
    expect(problems[0].reason).toContain('duplicate `period`');
  });
});

describe('validateImportPayload — reporting', () => {
  test('every bad row is reported, not just the first', () => {
    // The reason this runs before the transaction rather than inside it: a
    // validator that throws on the first problem makes the user fix one row per
    // attempt, on a file they may not be able to edit at all.
    const { problems } = validateImportPayload({
      trades: [
        { ...validTrade, qty: undefined },
        { ...validTrade, symbol: undefined },
      ],
      alerts: [{ ...validAlert, threshold: undefined }],
    });
    expect(problems.map((p) => `${p.table}[${p.index}]`)).toEqual(['trades[0]', 'trades[1]', 'alerts[0]']);
  });

  test('a row that is not an object is flagged rather than crashing the walk', () => {
    const { problems } = validateImportPayload({ trades: [validTrade, null, 'nope', 7] });
    expect(problems).toHaveLength(3);
    expect(problems.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(problems.every((p) => p.reason === 'must be an object')).toBe(true);
  });

  test('the report is capped, and the overflow is counted so a short list never reads as complete', () => {
    const { problems, omitted } = validateImportPayload({
      trades: Array.from({ length: 40 }, (_, i) => ({ ...validTrade, id: `t${i}`, qty: undefined })),
    });
    expect(problems).toHaveLength(20);
    expect(omitted).toBe(20);
  });

  test('the cap never hides a row from being checked — it only shortens the report', () => {
    // A cap applied to the *checking* rather than to the report would let rows
    // past the limit through unvalidated, which is the opposite of the point. So
    // the last row of a 40-row array is still rejected, and because it is the only
    // problem the report is short and `omitted` is zero.
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...validTrade, id: `t${i}`, qty: i === 39 ? undefined : 1 }));
    const { problems, omitted } = validateImportPayload({ trades: rows });
    expect(problems).toEqual([{ table: 'trades', index: 39, reason: '`qty` must be a finite number' }]);
    expect(omitted).toBe(0);
  });

  test('the index is the position in the array, not the position in the report', () => {
    const { problems } = validateImportPayload({
      trades: [
        validTrade,
        validTrade,
        { ...validTrade, id: 't3', qty: undefined },
        validTrade,
        { ...validTrade, id: 't5', symbol: undefined },
      ],
    });
    expect(problems.map((p) => p.index)).toEqual([2, 4]);
  });
});

describe('validateImportPayload — well-formed payloads stay importable', () => {
  test('a full round-trip payload produces no problems', () => {
    expect(
      problemsOf({
        formatVersion: 2,
        trades: [validTrade],
        history: [validHistory],
        interestReaisMonths: [validInterest],
        interestDollarsMonths: [{ month: '2026-08', amount: 50 }],
        alerts: [validAlert],
        scenarios: [{ id: 's1', name: 'bear', data: '{"a":1}' }],
        priceCache: [{ symbol: 'BTC', price: 64_002, ts: 1780147023633 }],
        assetChartCache: [validChart],
        analyticsSnapshots: [validAnalytics],
        cashEntries: [validCash],
      }),
    ).toEqual([]);
  });

  test('nullable columns that the importer defaults are left optional', () => {
    // A version 1 backup carries none of the three version 2 tables and may omit
    // `price`, `brlusd_rate`, `reference_price` and the alert flags. Refusing any
    // of those would make old backups unrestorable — the opposite of the goal.
    expect(
      problemsOf({
        trades: [{ id: 't1', symbol: 'BTC', side: 'sell', qty: 1, time: '2026-01-01T00:00:00.000Z' }],
        history: [{ id: 's1', ts: 1780147023633, v: 1 }],
        alerts: [{ symbol: 'BTC', alert_type: 'value', threshold: 1, condition: 'above' }],
        priceCache: [{ symbol: 'BTC', price: 1 }],
        assetChartCache: [{ symbol: 'BTC', days: 30, interval: '1h' }],
      }),
    ).toEqual([]);
  });

  test('a zero or a negative amount is a value, not a missing one', () => {
    // `!row.qty` style checks reject 0, which is a legitimate quantity for a
    // closing position and a legitimate cash balance.
    expect(problemsOf({ trades: [{ ...validTrade, qty: 0 }] })).toEqual([]);
    expect(problemsOf({ cashEntries: [{ ...validCash, amount: -250 }] })).toEqual([]);
    expect(problemsOf({ priceCache: [{ symbol: 'BTC', price: 0 }] })).toEqual([]);
  });

  test('NaN and Infinity are rejected, not passed through', () => {
    // Neither survives `JSON.stringify` — both become `null` on the wire — so a
    // payload that somehow carried one would restore a null into the column.
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, qty: Number.NaN }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`qty` must be a finite number' });
    expect(problemsOf({ cashEntries: [{ ...validCash, amount: Number.POSITIVE_INFINITY }] })).toHaveLength(1);
  });

  test('a numeric string is not accepted as a number, even though SQLite would coerce it', () => {
    // Measured: `"5"` into a REAL column is stored as real 5, so this is a
    // harmless coercion in isolation. It is refused anyway because the rule is
    // "is a number" — a rule with one exception is a rule that needs re-deriving
    // every time a column's affinity is discussed, and the same predicate has to
    // catch `"abc"`, which is stored as TEXT and silently skipped by `SUM`.
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, qty: '5' }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`qty` must be a finite number' });
  });

  test('an empty string is not a value', () => {
    expect(problemsOf({ trades: [{ ...validTrade, symbol: '' }] })).toHaveLength(1);
    expect(problemsOf({ trades: [{ ...validTrade, symbol: '   ' }] })).toHaveLength(1);
  });
});
