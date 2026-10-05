import { describe, expect, test } from 'vitest';
import { validateImportPayload } from './statePayload';

const problemsOf = (payload: unknown) => validateImportPayload(payload).problems;

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
    expect(problemsOf({})).toEqual([]);
  });

  test('rejects a non-numeric formatVersion rather than ignoring it', () => {
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
    expect(problemsOf({ cashReais: 100, cashDollars: 200 })).toEqual([]);
  });
});

describe('validateImportPayload — rows that would restore silently wrong', () => {
  test('a trade with no id is refused with a row index instead of a constraint error', () => {
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, id: undefined }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`id` must be a non-empty string' });
  });

  test('a price_cache row with a null price is refused', () => {
    const { problems } = validateImportPayload({ priceCache: [{ symbol: 'BTC', price: null, ts: 1 }] });
    expect(problems).toContainEqual({ table: 'priceCache', index: 0, reason: '`price` must be a finite number' });
  });

  test('a cash entry in a currency the balance query does not sum is refused', () => {
    const { problems } = validateImportPayload({ cashEntries: [{ ...validCash, currency: 'EUR' }] });
    expect(problems).toContainEqual({ table: 'cashEntries', index: 0, reason: '`currency` must be "BRL" or "USD"' });
  });

  test('a cash entry with a missing amount is refused', () => {
    const { problems } = validateImportPayload({ cashEntries: [{ ...validCash, amount: undefined }] });
    expect(problems).toContainEqual({ table: 'cashEntries', index: 0, reason: '`amount` must be a finite number' });
  });

  test('a scenario whose data is an object is refused rather than stored as "[object Object]"', () => {
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
    const { problems } = validateImportPayload({ interestReaisMonths: [{ month: '2026-08', amount: null }] });
    expect(problems).toContainEqual({
      table: 'interestReaisMonths',
      index: 0,
      reason: '`amount` must be a finite number',
    });
  });

  test('a snapshot with a missing `v` is refused: the importer would default it to 0', () => {
    const { problems } = validateImportPayload({ history: [{ ...validHistory, v: undefined }] });
    expect(problems).toContainEqual({ table: 'history', index: 0, reason: '`v` must be a finite number' });
  });

  test('a snapshot with a missing `ts` is refused: it would fall outside every period', () => {
    const { problems } = validateImportPayload({ history: [{ ...validHistory, ts: undefined }] });
    expect(problems).toContainEqual({ table: 'history', index: 0, reason: '`ts` must be a finite number' });
  });

  test('an asset chart row with a non-numeric `days` is refused', () => {
    const { problems } = validateImportPayload({ assetChartCache: [{ ...validChart, days: 'thirty' }] });
    expect(problems).toContainEqual({ table: 'assetChartCache', index: 0, reason: '`days` must be a number' });

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
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, qty: null }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`qty` must be a finite number' });
  });
});

describe('validateImportPayload — uniqueness the database would turn into data loss', () => {
  test('two months with the same month in the same currency are flagged', () => {
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
    expect(problemsOf({ trades: [{ ...validTrade, qty: 0 }] })).toEqual([]);
    expect(problemsOf({ cashEntries: [{ ...validCash, amount: -250 }] })).toEqual([]);
    expect(problemsOf({ priceCache: [{ symbol: 'BTC', price: 0 }] })).toEqual([]);
  });

  test('NaN and Infinity are rejected, not passed through', () => {
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, qty: Number.NaN }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`qty` must be a finite number' });
    expect(problemsOf({ cashEntries: [{ ...validCash, amount: Number.POSITIVE_INFINITY }] })).toHaveLength(1);
  });

  test('a numeric string is not accepted as a number, even though SQLite would coerce it', () => {
    const { problems } = validateImportPayload({ trades: [{ ...validTrade, qty: '5' }] });
    expect(problems).toContainEqual({ table: 'trades', index: 0, reason: '`qty` must be a finite number' });
  });

  test('an empty string is not a value', () => {
    expect(problemsOf({ trades: [{ ...validTrade, symbol: '' }] })).toHaveLength(1);
    expect(problemsOf({ trades: [{ ...validTrade, symbol: '   ' }] })).toHaveLength(1);
  });
});
