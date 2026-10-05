export interface RowProblem {
  table: string;
  index: number | null;
  reason: string;
}

export interface ImportValidation {
  problems: RowProblem[];
  omitted: number;
}

const MAX_REPORTED = 20;

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

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

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

const OPTIONAL = true;

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
        check(problems, key, index, 'id', row.id, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'symbol', row.symbol, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'side', row.side, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'qty', row.qty, isNumber, 'a finite number');
        check(problems, key, index, 'time', row.time, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'price', row.price, isNullableNumber, 'a finite number or null', OPTIONAL);
        break;
      }

      case 'history': {
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
        check(problems, key, index, 'symbol', row.symbol, isNonEmptyString, 'a non-empty string');
        check(problems, key, index, 'price', row.price, isNumber, 'a finite number');
        check(problems, key, index, 'ts', row.ts, isNullableNumber, 'a finite number or null', OPTIONAL);
        break;
      }

      case 'assetChartCache': {
        check(problems, key, index, 'symbol', row.symbol, isNonEmptyString, 'a non-empty string');
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
        if (row.currency !== 'BRL' && row.currency !== 'USD') {
          problems.push({ table: key, index, reason: '`currency` must be "BRL" or "USD"' });
        }
        check(problems, key, index, 'ts', row.ts, isNumber, 'a finite number');
        break;
      }
    }
  });
}

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

  checkUnique(payload, 'interestReaisMonths', 'month', found);
  checkUnique(payload, 'interestDollarsMonths', 'month', found);
  checkUnique(payload, 'analyticsSnapshots', 'period', found);

  return { problems: found.slice(0, MAX_REPORTED), omitted: Math.max(0, found.length - MAX_REPORTED) };
}
