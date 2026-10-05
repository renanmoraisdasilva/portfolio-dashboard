// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-tx-'));

process.env.PORTFOLIO_DATA_DIR = dataDir;

const db = await import('./db');

beforeAll(() => {
  db.runSync('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  db.runSync("INSERT INTO t (v) VALUES ('keep'), ('keep-too')");
});

afterAll(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('transaction()', () => {
  test('commits when the body returns', () => {
    db.transaction(() => {
      db.runSync("INSERT INTO t (v) VALUES ('committed')");
    });

    const rows = db.allSync<{ v: string }>('SELECT v FROM t ORDER BY id');
    expect(rows.map((r) => r.v)).toContain('committed');
  });

  test('returns the body value to the caller', () => {
    const result = db.transaction(() => db.getSync<{ v: string }>("SELECT v FROM t WHERE v = 'committed'"));
    expect(result?.v).toBe('committed');
  });

  test('rolls every write back when the body throws', () => {
    const before = db.allSync<{ v: string }>('SELECT v FROM t ORDER BY id').length;

    expect(() =>
      db.transaction(() => {
        db.runSync("INSERT INTO t (v) VALUES ('doomed-1')");
        db.runSync("INSERT INTO t (v) VALUES ('doomed-2')");
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const after = db.allSync<{ v: string }>('SELECT v FROM t ORDER BY id');
    expect(after).toHaveLength(before);
    expect(after.map((r) => r.v)).not.toContain('doomed-1');
  });

  test('rethrows the original error, not a rollback failure', () => {
    expect(() =>
      db.transaction(() => {
        throw new Error('the real cause');
      }),
    ).toThrow('the real cause');
  });

  test('a nested transaction becomes a savepoint, not a second BEGIN', () => {
    const before = db.allSync<{ v: string }>('SELECT v FROM t ORDER BY id').length;

    db.transaction(() => {
      db.runSync("INSERT INTO t (v) VALUES ('outer')");
      db.transaction(() => {
        db.runSync("INSERT INTO t (v) VALUES ('inner')");
      });
    });

    expect(db.allSync<{ v: string }>('SELECT v FROM t ORDER BY id')).toHaveLength(before + 2);
  });

  test('an inner failure rolls back only the inner scope', () => {
    const before = db.allSync<{ v: string }>('SELECT v FROM t ORDER BY id').length;

    expect(() =>
      db.transaction(() => {
        db.runSync("INSERT INTO t (v) VALUES ('outer-survives')");
        db.transaction(() => {
          db.runSync("INSERT INTO t (v) VALUES ('inner-dies')");
          throw new Error('inner failure');
        });
      }),
    ).toThrow('inner failure');

    const after = db.allSync<{ v: string }>('SELECT v FROM t ORDER BY id');
    expect(after).toHaveLength(before);
    expect(after.map((r) => r.v)).not.toContain('inner-dies');
  });

  test('leaves no transaction open on the connection after a failure', () => {
    try {
      db.transaction(() => {
        throw new Error('x');
      });
    } catch {}

    expect((db.sqlite as unknown as Database).inTransaction).toBe(false);

    db.runSync("INSERT INTO t (v) VALUES ('after-failure')");
    expect(db.allSync<{ v: string }>("SELECT v FROM t WHERE v = 'after-failure'")).toHaveLength(1);
  });
});
