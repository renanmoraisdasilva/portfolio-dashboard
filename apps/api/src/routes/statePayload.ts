/**
 * Shape validation for `POST /api/state/import`.
 *
 * The importer used to take the payload on trust and let the database be the
 * validator. That has three consequences, and only the first is obvious:
 *
 * 1. **The status was always 500.** A malformed row threw out of `runSync`, the
 *    transaction rolled back, and the handler answered `500 Failed to import
 *    state`. The file was the problem, not the server, and the client cannot tell
 *    the two apart.
 * 2. **The message named nothing.** "Failed to import state" does not say which
 *    table, which row, or which field. Restoring a backup is a recovery operation:
 *    the user is already dealing with a bad state and gets one opaque failure per
 *    attempt.
 * 3. **Worse, several malformed rows did not fail at all.** A `price_cache` row
 *    with `price: null` restores cleanly and leaves the dashboard pricing nothing.
 *    A `cash` entry in a currency the balance query does not sum is invisible. A
 *    missing `scenarios.data` stores the string `"undefined"`. A missing `qty`
 *    stores `NULL` into a `NOT NULL` column that only rejects it because the
 *    column happens to be declared that way - the row is gone, silently, and the
 *    FIFO walk then produces a plausible wrong number. Those are worse than a
 *    refusal, because the restore reports success.
 *
 * So this checks the fields that would make a restored row *silently* wrong, and
 * the rules are derived from `schema.ts` rather than from what the importer
 * happens to write: a field is required when its column is `NOT NULL` and the
 * importer has no default for it.
 *
 * **The numeric rules are the important ones, and they rest on SQLite affinity.**
 * A `REAL`/`INTEGER` column does not reject a bad value; it converts what it can
 * and keeps the rest as TEXT. Measured against the real column definitions:
 *
 * | inserted                       | stored as | read back by `WHERE days = 30` |
 * | ------------------------------ | --------- | ------------------------------- |
 * | `5`                            | real 5    | n/a                             |
 * | `"5"`                          | real 5    | **yes** — affinity repairs it   |
 * | `"abc"`, `"thirty"`, `""`      | TEXT      | **never**                       |
 *
 * So a numeric string is harmless and a non-numeric one is a trap: the row is
 * written, no error is raised, and it is then invisible to arithmetic. `SUM` skips
 * TEXT outright, so one text `interest.amount` lowers recorded income with nothing
 * anywhere reporting it. Requiring a real number is what turns a value that is
 * *stored* into one that is *used*.
 *
 * **Every problem is reported, not just the first.** Validation runs to
 * completion before the transaction opens, so one pass tells the user everything
 * that needs fixing instead of one row per attempt. The cap is on the *report*,
 * never on what is checked - a payload is rejected outright if anything is wrong,
 * so a truncated list cannot hide a row that was skipped.
 */

/** One thing wrong with one row of one table. */
export interface RowProblem {
  /** The payload key the row came from, e.g. `trades` or `interestReaisMonths`. */
  table: string;
  /** Zero-based position in that array, or `null` for a problem with the payload itself. */
  index: number | null;
  /** What is wrong, in terms the user can act on. */
  reason: string;
}

export interface ImportValidation {
  problems: RowProblem[];
  /** Problems found beyond the report cap, so a short list never reads as "that's all". */
  omitted: number;
}

/** Enough to fix a file without being a data dump; the count is always reported. */
const MAX_REPORTED = 20;

/**
 * The payload keys that must hold an array when present.
 *
 * A key that is present but not an array used to be silently ignored, because
 * every table is guarded by `Array.isArray(payload[key])` and leaves the table
 * untouched otherwise. That guard exists so a *partial* backup cannot empty a
 * table, which is right - but it also means a file with `"trades": {}` restores
 * everything except the trades and reports success. Flagging it is the difference
 * between a no-op and a refusal.
 *
 * `cashReais` and `cashDollars` are deliberately absent: they are scalars, and
 * the importer has a documented path that builds cash entries from them.
 */
const ARRAY_KEYS = [
  'trades',
  'history',
  'interestReaisMonths',
  'interestDollarsMonths',
  'alerts',
  'scenarios',
  'priceCache',
  'assetChartCache',
  'analyticsSnapshots',
  'cashEntries',
] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite number. `NaN` and `Infinity` are rejected: both round-trip through JSON as `null`. */
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Reports a problem unless the value is present and of the right kind.
 *
 * `optional` covers columns that are nullable *and* defaulted by the importer, so
 * that a version 1 backup stays importable. It is not a licence to skip a `NOT
 * NULL` column: those are what make a restored row wrong.
 */
function check(
  problems: RowProblem[],
  table: string,
  index: number,
  field: string,
  value: unknown,
  predicate: (v: unknown) => boolean,
  expectation: string,
  optional = false,
): void {
  if (optional && (value === undefined || value === null)) return;
  if (!predicate(value)) {
    problems.push({ table, index, reason: `\`${field}\` must be ${expectation}` });
  }
}

/** `?? <default>` is applied by the importer, so these columns need no value. */
const OPTIONAL = true;

/** A `REAL`/`INTEGER` column that is nullable in the schema but must carry a value to be meaningful. */
const isNullableNumber = (v: unknown): boolean => v === undefined || v === null || isNumber(v);

function checkRows(payload: Record<string, unknown>, key: string, problems: RowProblem[]): void {
  const rows = payload[key];
  if (rows === undefined) return;
  if (!Array.isArray(rows)) {
    problems.push({ table: key, index: null, reason: 'must be an array' });
    return;
  }

  rows.forEach((row, index) => {
    if (!isObject(row)) {
      problems.push({ table: key, index, reason: 'must be an object' });
      return;
    }

    switch (key) {
      case 'trades': {
        // `id` is `text PRIMARY KEY NOT NULL` (migration `0000`) and the importer
        // writes `t.id ?? null`, so a row without one does throw — checked against
        // the real DDL, which answers `NOT NULL constraint failed: trades.id`. So
        // this is not about integrity; it is about what the database's error
        // *omits*. It names no table, no row and no field, the whole restore rolls
        // back, and the response was a bare 500. The check moves that information
        // from "unavailable" to "in the response", and nothing more.
        check(problems, key, index, 'id', row.id, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'symbol', row.symbol, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'side', row.side, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'qty', row.qty, isNumber, 'a finite number');
        check(problems, key, index, 'time', row.time, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'price', row.price, isNullableNumber, 'a finite number or null', OPTIONAL);
        break;
      }

      case 'history': {
        // Nothing in `portfolio_snapshots` is NOT NULL, so the database would
        // accept any of this. Two columns are still load-bearing:
        //   - `ts` is what every chart and the analytics window order by; NULL puts
        //     the snapshot outside every period.
        //   - `v` is the value, and the importer defaults a missing one to `0` -
        //     a zero-height candle that flattens the chart without any error.
        check(problems, key, index, 'id', row.id, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'ts', row.ts, isNumber, 'a finite number');
        check(problems, key, index, 'v', row.v, isNumber, 'a finite number');
        check(problems, key, index, 'i', row.i, isNullableNumber, 'a finite number or null', OPTIONAL);
        check(problems, key, index, 'p', row.p, isNullableNumber, 'a finite number or null', OPTIONAL);
        check(problems, key, index, 'brlusd_rate', row.brlusd_rate, isNullableNumber, 'a finite number or null', OPTIONAL);
        break;
      }

      case 'interestReaisMonths':
      case 'interestDollarsMonths': {
        // `currency` is written by the importer as a literal, so it is not the
        // payload's to get wrong. `amount` is nullable in the schema, and a NULL
        // is skipped by `SUM` - so a restore with a null amount quietly lowers
        // recorded income rather than failing.
        check(problems, key, index, 'month', row.month, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'amount', row.amount, isNumber, 'a finite number');
        break;
      }

      case 'alerts': {
        check(problems, key, index, 'symbol', row.symbol, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'alert_type', row.alert_type, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'threshold', row.threshold, isNumber, 'a finite number');
        check(problems, key, index, 'condition', row.condition, isNonEmptyString, 'a non-empty string');
        check(
          problems,
          key,
          index,
          'reference_price',
          row.reference_price,
          isNullableNumber,
          'a finite number or null',
          OPTIONAL,
        );
        break;
      }

      case 'scenarios': {
        check(problems, key, index, 'name', row.name, isNonEmptyString, 'a non-empty string');
        // `data` is the serialised scenario. `JSON.stringify` is what writes it,
        // so a hand-edited file carrying a real object instead of a string would
        // be stored as `"[object Object]"` - accepted, and unreadable. It is
        // parsed here rather than only type-checked for the same reason: a
        // scenario that will not parse is a scenario the simulator cannot load.
        const data = row.data;
        if (typeof data !== 'string') {
          problems.push({ table: key, index, reason: '`data` must be a JSON string' });
        } else {
          try {
            JSON.parse(data);
          } catch {
            problems.push({ table: key, index, reason: '`data` is not valid JSON' });
          }
        }
        break;
      }

      case 'priceCache': {
        // Nullable in the schema, and a null price is served by `/api/prices` as
        // "no price" - every position of that symbol values at zero until the
        // worker's next fetch, with no error anywhere.
        check(problems, key, index, 'symbol', row.symbol, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'price', row.price, isNumber, 'a finite number');
        check(problems, key, index, 'ts', row.ts, isNullableNumber, 'a finite number or null', OPTIONAL);
        break;
      }

      case 'assetChartCache': {
        check(problems, key, index, 'symbol', row.symbol, isNonEmptyString, 'a non-empty string');
        // Part of the composite primary key, and the reader compares it with
        // `WHERE days = ?` against an integer. Verified: `"30"` is coerced by
        // INTEGER affinity and *is* found again, but `"thirty"` is stored as TEXT
        // and never is - and neither is rejected. See the affinity note at the top
        // of this file for why that matters more than it looks.
        check(problems, key, index, 'days', row.days, isNumber, 'a number');
        check(problems, key, index, 'interval', row.interval, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'ts', row.ts, isNullableNumber, 'a finite number or null', OPTIONAL);
        break;
      }

      case 'analyticsSnapshots': {
        check(problems, key, index, 'period', row.period, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'computed_at', row.computed_at, isNumber, 'a finite number');
        check(problems, key, index, 'return_pct', row.return_pct, isNullableNumber, 'a finite number or null', OPTIONAL);
        check(problems, key, index, 'sharpe_ratio', row.sharpe_ratio, isNullableNumber, 'a finite number or null', OPTIONAL);
        break;
      }

      case 'cashEntries': {
        check(problems, key, index, 'id', row.id, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'amount', row.amount, isNumber, 'a finite number');
        // The balance query sums `CASE WHEN currency='BRL' … ELSE 0 END` and the
        // same for USD. A row in a third currency is stored, counted by no query,
        // and leaves the restored balance disagreeing with the sum of its entries
        // - the exact class of bug the whole `packages/shared` extraction exists
        // to stop.
        if (row.currency !== 'BRL' && row.currency !== 'USD') {
          problems.push({ table: key, index, reason: '`currency` must be "BRL" or "USD"' });
        }
        check(problems, key, index, 'ts', row.ts, isNumber, 'a finite number');
        break;
      }
    }
  });
}

/**
 * Keys that must be unique within one payload.
 *
 * `interest` has `idx_interest_month_currency` and `analytics_snapshots` has
 * `idx_analytics_snapshots_period`. Both writes are `INSERT OR REPLACE`, so a
 * duplicate in the payload is *not* a no-op - the second row replaces the first,
 * and one period of income silently disappears. That is worth catching before the
 * write rather than reporting as a constraint failure afterwards.
 *
 * This is why `interest` uses a plain `INSERT`: with the duplicate caught here,
 * the constraint violation it would otherwise raise has no reachable path.
 */
function checkUnique(payload: Record<string, unknown>, key: string, field: string, problems: RowProblem[]): void {
  const rows = payload[key];
  if (!Array.isArray(rows)) return;
  const seen = new Set<unknown>();
  rows.forEach((row, index) => {
    if (!isObject(row) || row[field] === undefined || row[field] === null) return;
    const value = row[field];
    if (seen.has(value)) {
      problems.push({
        table: key,
        index,
        reason: `duplicate \`${field}\` ${JSON.stringify(value)}; a restore replaces rather than merges, so the earlier row would be lost`,
      });
    }
    seen.add(value);
  });
}

/**
 * Validates an import payload. An empty `problems` array means it is safe to write.
 *
 * `index: null` marks a problem with the payload as a whole rather than with a
 * row, so the client can tell "this file is not a backup" from "row 41 is wrong".
 */
export function validateImportPayload(payload: unknown): ImportValidation {
  const found: RowProblem[] = [];

  if (!isObject(payload)) {
    return {
      problems: [{ table: '(payload)', index: null, reason: 'must be a JSON object' }],
      omitted: 0,
    };
  }

  if (payload.formatVersion !== undefined && !isNumber(payload.formatVersion)) {
    found.push({ table: '(payload)', index: null, reason: '`formatVersion` must be a number' });
  }

  for (const key of ARRAY_KEYS) checkRows(payload, key, found);

  // `month` is only unique within a currency, and the two months keys are the two
  // currencies, so each is checked on its own.
  checkUnique(payload, 'interestReaisMonths', 'month', found);
  checkUnique(payload, 'interestDollarsMonths', 'month', found);
  checkUnique(payload, 'analyticsSnapshots', 'period', found);

  return { problems: found.slice(0, MAX_REPORTED), omitted: Math.max(0, found.length - MAX_REPORTED) };
}
