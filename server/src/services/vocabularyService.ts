import { runV, allV, getV } from '../vocabularyDb';
import { randomUUID } from 'node:crypto';

export interface VocabularyEntryRow {
  id: string;
  word: string;
  translation?: string | null;
  example?: string | null;
  tags?: string | null; // comma separated
  status?: string | null;
  class?: string | null;
  excluded?: number | null;
  created_at: number;
}

export async function initVocabularyDB() {
  await runV('PRAGMA journal_mode = WAL');
  await runV('PRAGMA foreign_keys = ON');

  await runV(`CREATE TABLE IF NOT EXISTS vocabulary_entries (
    id TEXT PRIMARY KEY,
    word TEXT NOT NULL,
    translation TEXT,
    example TEXT,
    tags TEXT,
    status TEXT,
    class TEXT,
    excluded INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  // Classes table keeps original upload phrases/context
  await runV(`CREATE TABLE IF NOT EXISTS vocabulary_classes (
    id TEXT PRIMARY KEY,
    name TEXT,
    date TEXT,
    phrases TEXT,
    created_at INTEGER
  )`);

  // Backfill/ensure columns exist for older DBs
  try {
    const cols: any[] = await allV("PRAGMA table_info('vocabulary_entries')");
    const names = (cols || []).map(c => c && c.name).filter(Boolean);
    if (!names.includes('status')) {
      await runV('ALTER TABLE vocabulary_entries ADD COLUMN status TEXT');
      await runV("UPDATE vocabulary_entries SET status = 'unreviewed' WHERE status IS NULL");
    }
    if (!names.includes('class')) {
      await runV('ALTER TABLE vocabulary_entries ADD COLUMN class TEXT');
    }
    if (!names.includes('excluded')) {
      await runV('ALTER TABLE vocabulary_entries ADD COLUMN excluded INTEGER');
      await runV("UPDATE vocabulary_entries SET excluded = 0 WHERE excluded IS NULL");
    }
  } catch (err) {
    console.warn('Could not migrate vocabulary_entries columns', err);
  }
}

export async function insertVocabulary(entries: Partial<VocabularyEntryRow>[]) {
  const inserted: VocabularyEntryRow[] = [];
  for (const e of entries) {
    const id = e.id ?? randomUUID();
    const created_at = e.created_at ?? Date.now();
    await runV('INSERT INTO vocabulary_entries (id, word, translation, example, tags, status, class, excluded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id,
      e.word,
      e.translation ?? null,
      e.example ?? null,
      e.tags ?? null,
      (e as any).status ?? 'unreviewed',
      (e as any).class ?? null,
      (e as any).excluded ? 1 : 0,
      created_at,
    ]);
    const row = await getV<VocabularyEntryRow>('SELECT * FROM vocabulary_entries WHERE id = ?', [id]);
    if (row) inserted.push(row);
  }
  return inserted;
}

// Create a class + its vocabulary entries in one atomic operation
export async function createClassWithEntries(payload: { id?: string; name: string; date?: string; phrases?: string[]; vocabulary?: Array<any> }) {
  const id = payload.id ?? randomUUID();
  const now = Date.now();
  const phrasesJson = JSON.stringify(payload.phrases || []);
  await runV('INSERT INTO vocabulary_classes (id, name, date, phrases, created_at) VALUES (?, ?, ?, ?, ?)', [id, payload.name, payload.date ?? null, phrasesJson, now]);

  const vocs = Array.isArray(payload.vocabulary) ? payload.vocabulary : [];
  const entries = vocs.map(v => ({ word: v.word, translation: v.translation ?? null, example: v.example ?? null, tags: v.tags ?? null, status: v.status ?? 'unreviewed', excluded: v.excluded ? 1 : 0, class: id }));
  await insertVocabulary(entries as any);

  // return created class with count
  return { id, name: payload.name, date: payload.date ?? null, phrases: payload.phrases || [], created_at: now };
}

export async function getClasses() {
  const classes: any[] = await allV('SELECT id, name, date, phrases, created_at FROM vocabulary_classes ORDER BY created_at DESC');
  const out: any[] = [];
  for (const c of classes) {
    const rows = await allV('SELECT * FROM vocabulary_entries WHERE class = ? ORDER BY created_at DESC', [c.id]);
    out.push({ id: c.id, name: c.name, date: c.date, phrases: JSON.parse(c.phrases || '[]'), vocabulary: rows || [] });
  }
  return out;
}

export async function deleteClass(id: string) {
  await runV('DELETE FROM vocabulary_classes WHERE id = ?', [id]);
  await runV('DELETE FROM vocabulary_entries WHERE class = ?', [id]);
}

export async function upsertByWord(word: string, fields: { status?: string; class?: string; translation?: string | null; example?: string | null; tags?: string | null; excluded?: boolean | number }) {
  const existing = await getV<any>('SELECT * FROM vocabulary_entries WHERE word = ? COLLATE NOCASE', [word]);
  if (existing) {
    const now = Date.now();
    await runV('UPDATE vocabulary_entries SET status = ?, class = ?, excluded = COALESCE(?, excluded), translation = COALESCE(?, translation), example = COALESCE(?, example), tags = COALESCE(?, tags) WHERE id = ?', [
      fields.status ?? existing.status ?? 'unreviewed',
      fields.class ?? existing.class ?? null,
      (typeof (fields as any).excluded === 'undefined') ? null : ((fields as any).excluded ? 1 : 0),
      fields.translation ?? null,
      fields.example ?? null,
      fields.tags ?? null,
      existing.id,
    ]);
    return await getV('SELECT * FROM vocabulary_entries WHERE id = ?', [existing.id]);
  } else {
    const id = randomUUID();
    const created_at = Date.now();
    await runV('INSERT INTO vocabulary_entries (id, word, translation, example, tags, status, class, excluded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id,
      word,
      fields.translation ?? null,
      fields.example ?? null,
      fields.tags ?? null,
      fields.status ?? 'unreviewed',
      fields.class ?? null,
      (fields as any).excluded ? 1 : 0,
      created_at,
    ]);
    return await getV('SELECT * FROM vocabulary_entries WHERE id = ?', [id]);
  }
} 

// Set status for all entries matching the word (or just for a class if classId provided)
export async function setStatusForWord(word: string, status: string, classId?: string) {
  if (classId) {
    await runV('UPDATE vocabulary_entries SET status = ? WHERE LOWER(word) = LOWER(?) AND class = ?', [status, word, classId]);
  } else {
    await runV('UPDATE vocabulary_entries SET status = ? WHERE LOWER(word) = LOWER(?)', [status, word]);
  }
}

export async function setExcludedForWord(word: string, excluded: boolean, classId?: string) {
  const val = excluded ? 1 : 0;
  if (classId) {
    await runV('UPDATE vocabulary_entries SET excluded = ? WHERE LOWER(word) = LOWER(?) AND class = ?', [val, word, classId]);
  } else {
    await runV('UPDATE vocabulary_entries SET excluded = ? WHERE LOWER(word) = LOWER(?)', [val, word]);
  }
}

export async function resetAllStatuses() {
  await runV("UPDATE vocabulary_entries SET status = 'unreviewed'");
}

export async function getAllVocabulary(): Promise<VocabularyEntryRow[]> {
  return allV<VocabularyEntryRow>('SELECT * FROM vocabulary_entries ORDER BY created_at DESC');
}

export async function deleteVocabulary(id: string): Promise<void> {
  await runV('DELETE FROM vocabulary_entries WHERE id = ?', [id]);
}
