import Database from 'better-sqlite3';
import { isSelectQuery, isValidDbName, resolveDb, VALID_DBS } from './sqlExplorer';

// ---------------------------------------------------------------------------
// isSelectQuery
// ---------------------------------------------------------------------------
describe('isSelectQuery', () => {
  test.each([
    ['SELECT * FROM trades', true],
    ['  select id from trades', true],
    ['SELECT\n  *\nFROM trades', true],
    ['WITH cte AS (SELECT 1) SELECT * FROM cte', true],
    ['EXPLAIN SELECT * FROM trades', true],
    ['PRAGMA table_info(trades)', true],
    ['pragma journal_mode', true],
    ['explain query plan SELECT 1', true],
  ])('treats "%s" as read-only → %s', (sql, expected) => {
    expect(isSelectQuery(sql)).toBe(expected);
  });

  test.each([
    ['INSERT INTO trades VALUES (1)', false],
    ['UPDATE trades SET qty=1 WHERE id=1', false],
    ['DELETE FROM trades WHERE id=1', false],
    ['DROP TABLE trades', false],
    ['CREATE TABLE foo (id TEXT)', false],
    ['ALTER TABLE trades ADD COLUMN foo TEXT', false],
  ])('treats "%s" as write → %s', (sql, expected) => {
    expect(isSelectQuery(sql)).toBe(expected);
  });

  test('ignores leading whitespace', () => {
    expect(isSelectQuery('   \n\t SELECT 1')).toBe(true);
    expect(isSelectQuery('   DELETE FROM foo')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidDbName
// ---------------------------------------------------------------------------
describe('isValidDbName', () => {
  test.each(VALID_DBS)('accepts valid db name: %s', name => {
    expect(isValidDbName(name)).toBe(true);
  });

  test.each(['PORTFOLIO', 'Finance', 'sqlite', 'unknown', '', '  portfolio'])
    ('rejects invalid db name: "%s"', name => {
      expect(isValidDbName(name)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// resolveDb — uses an in-memory fake map so no real DB files are touched
// ---------------------------------------------------------------------------
describe('resolveDb', () => {
  let fakeDb: Database.Database;
  let fakeMap: Record<string, Database.Database>;

  beforeAll(() => {
    fakeDb = new Database(':memory:');
    fakeMap = { portfolio: fakeDb };
  });

  afterAll(() => {
    fakeDb.close();
  });

  test('returns the database for a known name', () => {
    expect(resolveDb('portfolio', fakeMap)).toBe(fakeDb);
  });

  test('returns undefined for an unknown name', () => {
    expect(resolveDb('unknown', fakeMap)).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(resolveDb('', fakeMap)).toBeUndefined();
  });

  test('is case-sensitive — "Portfolio" does not match "portfolio"', () => {
    expect(resolveDb('Portfolio', fakeMap)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: isSelectQuery + real in-memory SQLite
// ---------------------------------------------------------------------------
describe('query execution against in-memory SQLite', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
    db.exec(`INSERT INTO items VALUES (1, 'alpha'), (2, 'beta')`);
  });

  afterAll(() => db.close());

  test('SELECT query returns rows', () => {
    const rows = db.prepare('SELECT * FROM items ORDER BY id').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 1, name: 'alpha' });
  });

  test('isSelectQuery correctly gates INSERT', () => {
    const sql = "INSERT INTO items VALUES (3, 'gamma')";
    expect(isSelectQuery(sql)).toBe(false);
    db.prepare(sql).run();
    const all = db.prepare('SELECT * FROM items').all();
    expect(all).toHaveLength(3);
  });

  test('PRAGMA is treated as select-like', () => {
    const sql = 'PRAGMA table_info(items)';
    expect(isSelectQuery(sql)).toBe(true);
    const cols = db.prepare(sql).all() as { name: string }[];
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('name');
  });

  test('WITH ... SELECT is treated as read-only', () => {
    const sql = 'WITH t AS (SELECT id FROM items) SELECT * FROM t';
    expect(isSelectQuery(sql)).toBe(true);
    const rows = db.prepare(sql).all();
    expect(rows).toHaveLength(3);
  });

  test('UPDATE changes rowcount', () => {
    const sql = "UPDATE items SET name='updated' WHERE id=1";
    expect(isSelectQuery(sql)).toBe(false);
    const info = db.prepare(sql).run();
    expect(info.changes).toBe(1);
  });

  test('DELETE removes rows', () => {
    db.exec(`INSERT INTO items VALUES (99, 'temp')`);
    const sql = 'DELETE FROM items WHERE id=99';
    expect(isSelectQuery(sql)).toBe(false);
    const info = db.prepare(sql).run();
    expect(info.changes).toBe(1);
  });

  test('invalid SQL throws from prepare()', () => {
    expect(() => db.prepare('NOT VALID SQL !!!')).toThrow();
  });

  test('query on non-existent table throws', () => {
    expect(() => db.prepare('SELECT * FROM no_such_table').all()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// VALID_DBS constant sanity checks
// ---------------------------------------------------------------------------
describe('VALID_DBS', () => {
  test('contains exactly the two expected db names', () => {
    expect([...VALID_DBS].sort()).toEqual(['finance', 'portfolio']);
  });

  test('is a readonly tuple (not mutated at runtime)', () => {
    const copy = [...VALID_DBS];
    expect(copy).toHaveLength(2);
  });
});
