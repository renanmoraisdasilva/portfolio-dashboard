import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const config = readFileSync(resolve(process.cwd(), 'vitest.config.ts'), 'utf8');

function includeEntries(): string[] {
  const block = /coverage:\s*\{[\s\S]*?include:\s*\[([\s\S]*?)\]/.exec(config)?.[1];
  if (!block) throw new Error('could not find coverage.include in vitest.config.ts — has the config been restructured?');
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('coverage.include', () => {
  const entries = includeEntries();

  test('names at least the files the gate is meant to protect', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain('packages/shared/src/domain/**');
  });

  test.each(includeEntries().filter((e) => !e.includes('*')))('%s exists', (entry) => {
    expect(existsSync(resolve(process.cwd(), entry)), `${entry} is listed in coverage.include but does not exist`).toBe(true);
  });

  test('no entry points into a build output directory', () => {
    for (const entry of entries) {
      expect(entry, `${entry} would measure build output`).not.toMatch(/(^|\/)(dist|build|node_modules)\//);
    }
  });

  test('no entry is a test file', () => {
    for (const entry of entries) {
      expect(entry, `${entry} is a test file`).not.toMatch(/\.(test|spec)\.[jt]sx?$/);
    }
  });
});
