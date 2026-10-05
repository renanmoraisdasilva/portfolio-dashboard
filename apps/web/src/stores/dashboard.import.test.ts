// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { ApiError } from '../composables/useApi';
import { importErrorMessage } from './dashboard';

describe('importErrorMessage', () => {
  const problem = (table: string, index: number | null, reason: string) => ({ table, index, reason });
  const apiError = (status: number, details: unknown) => new ApiError('POST', '/state/import', status, details);

  test('renders each problem as its own line, naming the table and the row', () => {
    const message = importErrorMessage(
      apiError(400, {
        error: 'Import payload is not a valid backup',
        problems: [
          problem('trades', 0, '`qty` must be a finite number'),
          problem('priceCache', 3, '`price` must be a finite number'),
        ],
        omitted: 0,
      }),
    );

    expect(message).toBe(
      'Backup rejected — 2 problems:\ntrades[0]: `qty` must be a finite number\npriceCache[3]: `price` must be a finite number',
    );
    expect(message?.split('\n')).toHaveLength(3);
  });

  test('a payload-level problem has no index and does not print one', () => {
    const message = importErrorMessage(apiError(400, { problems: [problem('trades', null, 'must be an array')], omitted: 0 }));
    expect(message).toContain('trades: must be an array');
    expect(message).not.toContain('null');
  });

  test('a single problem is not pluralised', () => {
    const message = importErrorMessage(apiError(400, { problems: [problem('trades', 0, 'bad')], omitted: 0 }));
    expect(message).toContain('Backup rejected — 1 problem:');
  });

  test('both the display cap and the server cap are counted, never swallowed', () => {
    const many = Array.from({ length: 9 }, (_, i) => problem('trades', i, 'bad'));
    const message = importErrorMessage(apiError(400, { problems: many, omitted: 4 }));

    expect(message?.split('\n')).toHaveLength(8); // header + 6 rendered + 1 "and N more"
    expect(message).toContain('Backup rejected — 13 problems:');
    expect(message).toContain('…and 7 more');
  });

  test("the server's omitted count is honoured when nothing is dropped locally", () => {
    const message = importErrorMessage(apiError(400, { problems: [problem('trades', 0, 'bad')], omitted: 2 }));
    expect(message).toContain('…and 2 more');
    expect(message).toContain('Backup rejected — 3 problems:');
  });

  test('a 500 without a problem list falls back to the error message', () => {
    const message = importErrorMessage(apiError(500, { error: 'Failed to import state' }));
    expect(message).toBe('POST /state/import failed with 500: Failed to import state');
    expect(message).not.toContain('Backup rejected');
  });

  test('a 400 with no problems in the body falls back rather than rendering an empty list', () => {
    const message = importErrorMessage(apiError(400, { error: 'Import payload is not a valid backup' }));
    expect(message).toBe('POST /state/import failed with 400: Import payload is not a valid backup');
  });

  test('a non-ApiError returns null, so the caller can say "failed" without inventing detail', () => {
    expect(importErrorMessage(new TypeError('Failed to fetch'))).toBeNull();
    expect(importErrorMessage(undefined)).toBeNull();
  });
});
