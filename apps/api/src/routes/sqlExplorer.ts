import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import Database from 'better-sqlite3';

export const sqlExplorerRouter = Router();

export const VALID_DBS = ['portfolio'] as const;
export type DbName = typeof VALID_DBS[number];

const DB_MAP: Record<string, Database.Database> = {
  portfolio: sqlite,
};

/** Returns true when the statement is read-only (SELECT / EXPLAIN / PRAGMA / WITH). */
export function isSelectQuery(sql: string): boolean {
  return /^\s*(SELECT|EXPLAIN|PRAGMA|WITH)\b/i.test(sql.trim());
}

/** Returns the resolved database or undefined for an unknown name. */
export function resolveDb(
  name: string,
  map: Record<string, Database.Database> = DB_MAP,
): Database.Database | undefined {
  return map[name];
}

/** Validate that a db name is one of the known values. */
export function isValidDbName(name: string): name is DbName {
  return (VALID_DBS as readonly string[]).includes(name);
}

// GET /api/sql/tables?db=portfolio — list tables in a given database
sqlExplorerRouter.get('/tables', (req: Request, res: Response) => {
  const dbName = (req.query.db as string) || 'portfolio';
  const db = resolveDb(dbName);
  if (!db) {
    res.status(400).json({ error: `Unknown database: ${dbName}. Valid values: ${VALID_DBS.join(', ')}` });
    return;
  }
  try {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' ORDER BY name`
    ).all() as { name: string }[];
    res.json({ tables: tables.map(t => t.name) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/sql/schema?db=portfolio&table=trades — get column info for a table
sqlExplorerRouter.get('/schema', (req: Request, res: Response) => {
  const dbName = (req.query.db as string) || 'portfolio';
  const table = req.query.table as string;
  if (!table) {
    res.status(400).json({ error: 'table query param is required' });
    return;
  }
  const db = resolveDb(dbName);
  if (!db) {
    res.status(400).json({ error: `Unknown database: ${dbName}` });
    return;
  }
  try {
    const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
    res.json({ columns: cols });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/sql/query — execute an arbitrary SQL query
sqlExplorerRouter.post('/query', (req: Request, res: Response) => {
  const { sql, db: dbName = 'portfolio' } = req.body as { sql?: string; db?: string };

  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    res.status(400).json({ error: 'sql field is required' });
    return;
  }

  const db = resolveDb(dbName);
  if (!db) {
    res.status(400).json({ error: `Unknown database: ${dbName}. Valid values: ${VALID_DBS.join(', ')}` });
    return;
  }

  try {
    const stmt = db.prepare(sql.trim());

    if (isSelectQuery(sql)) {
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns?.().map((c: { name: string }) => c.name) ?? [];
      res.json({ rows, columns, rowCount: rows.length, type: 'select' });
    } else {
      const info = stmt.run() as Database.RunResult;
      res.json({
        rowCount: info.changes,
        lastInsertRowid: info.lastInsertRowid,
        type: 'write',
        message: `${info.changes} row(s) affected`,
      });
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
