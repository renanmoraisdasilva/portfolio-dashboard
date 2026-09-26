import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const VOCAB_DB_PATH = path.join(DATA_DIR, 'vocabulary.db');

export const vocabDb = new Database(VOCAB_DB_PATH);

export function runV(sql: string, params: any[] = []): Promise<void> {
  return Promise.resolve().then(() => { vocabDb.prepare(sql).run(...params); });
}

export function getV<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return Promise.resolve().then(() => vocabDb.prepare(sql).get(...params) as T | undefined);
}

export function allV<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return Promise.resolve().then(() => vocabDb.prepare(sql).all(...params) as T[]);
}
