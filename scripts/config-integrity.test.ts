import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Every path in `coverage.include` must exist.
 *
 * `apps/api/src/services/cashBackfill.ts` sat in that list after the file was
 * deleted along with both backfill endpoints. The coverage run did not fail —
 * `include` is a filter, and a pattern matching nothing is a valid pattern — so
 * the config kept a reference to something that had not existed for a while, and
 * a reader had no way to tell a deliberate entry from a stale one. That is the
 * drift class that makes a carefully maintained config untrustworthy.
 *
 * A glob is allowed to match nothing (`apps/api/src/config/**` is empty on a
 * fresh checkout before the config module lands), so this checks only the entries
 * that name a specific file.
 */
const config = readFileSync(resolve(process.cwd(), 'vitest.config.ts'), 'utf8');

/** The `include` array's entries, whether or not the file is a `.ts` config. */
function includeEntries(): string[] {
  const block = /coverage:\s*\{[\s\S]*?include:\s*\[([\s\S]*?)\]/.exec(config)?.[1];
  if (!block) throw new Error('could not find coverage.include in vitest.config.ts — has the config been restructured?');
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('coverage.include', () => {
  const entries = includeEntries();

  test('names at least the files the gate is meant to protect', () => {
    // Guards against the parse above silently matching an empty or relocated
    // block, which would make every other test in this file vacuous.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain('packages/shared/src/domain/**');
  });

  test.each(includeEntries().filter((e) => !e.includes('*')))('%s exists', (entry) => {
    // The assertion that would have caught cashBackfill.ts.
    expect(existsSync(resolve(process.cwd(), entry)), `${entry} is listed in coverage.include but does not exist`).toBe(true);
  });

  test('no entry points into a build output directory', () => {
    // Coverage against `dist/` measures the compiled output and the declared
    // types rather than the source the app bundles — the trap that
    // `static/js/__tests__` fell into while it was still CommonJS.
    for (const entry of entries) {
      expect(entry, `${entry} would measure build output`).not.toMatch(/(^|\/)(dist|build|node_modules)\//);
    }
  });

  test('no entry is a test file', () => {
    // A suite included in its own coverage denominator reports 100% for the wrong
    // reason and inflates the global figure.
    for (const entry of entries) {
      expect(entry, `${entry} is a test file`).not.toMatch(/\.(test|spec)\.[jt]sx?$/);
    }
  });
});
