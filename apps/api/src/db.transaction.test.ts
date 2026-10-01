// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'better-sqlite3';

/**
 * `transaction()` against a real SQLite connection.
 *
 * The route suites mock `../db`, which means their atomicity assertions are about
 * two things only: that the handler *calls* `transaction`, and that its body is
 * the sequence of writes expected. The rollback itself was never exercised — the
 * old fakes ignored `ROLLBACK` and undid nothing, and mutating the real
 * `transaction()` to a no-op does not fail a single one of them. That gap is the
 * reason this file exists.
 *
 * This is the one test tier that uses a real database. Everything else fakes it,
 * which is the right trade for the rest (fast, no file I/O) and the wrong one for
 * "does a rollback actually roll back".
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-tx-'));

// `db.ts` opens the database at module load, so the override has to be in place
// before the import — hence `vi.hoisted` and the dynamic import below.
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
    // The hand-rolled blocks had `await run('ROLLBACK')` in the catch, so a
    // failure *of the rollback* replaced the cause. Whatever the body threw has to
    // be what surfaces — this is the whole reason for moving to the driver's
    // primitive.
    expect(() =>
      db.transaction(() => {
        throw new Error('the real cause');
      }),
    ).toThrow('the real cause');
  });

  test('a nested transaction becomes a savepoint, not a second BEGIN', () => {
    // SQLite has no nested BEGIN. If this were two independent transactions the
    // inner commit would end the outer one and the outer's writes would land
    // outside it — silently, and only under nesting.
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
    // A `BEGIN` that is never matched by a `COMMIT` leaves the connection inside
    // a transaction, and every later write on it is undone by the next rollback.
    // Checking `sqlite.inTransaction` is the direct assertion.
    try {
      db.transaction(() => {
        throw new Error('x');
      });
    } catch {
      /* expected */
    }

    expect((db.sqlite as unknown as Database).inTransaction).toBe(false);

    // And a subsequent write really does persist.
    db.runSync("INSERT INTO t (v) VALUES ('after-failure')");
    expect(db.allSync<{ v: string }>("SELECT v FROM t WHERE v = 'after-failure'")).toHaveLength(1);
  });
});
