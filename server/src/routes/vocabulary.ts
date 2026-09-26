import { Router, Request, Response } from 'express';
import * as vs from '../services/vocabularyService';

export const vocabularyRouter = Router();

// GET /api/vocab - list all entries
vocabularyRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await vs.getAllVocabulary();
    res.json(rows);
  } catch (err) {
    console.error('Error fetching vocabulary', err);
    res.status(500).json({ error: 'Failed to fetch vocabulary entries' });
  }
});

// POST /api/vocab/import - accepts JSON array of entries { word, translation?, example?, tags?, status?, class? }
vocabularyRouter.post('/import', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!Array.isArray(payload)) return res.status(400).json({ error: 'Expected an array of vocabulary entries' });
    const entries = payload.map((p: any) => ({
      word: String(p.word || '').trim(),
      translation: p.translation ?? null,
      example: p.example ?? null,
      tags: p.tags ?? null,
      status: p.status ?? 'unreviewed',
      class: p.class ?? null,
    })).filter((e: any) => e.word.length > 0);

    const inserted = await vs.insertVocabulary(entries);
    res.status(201).json({ inserted });
  } catch (err) {
    console.error('Error importing vocabulary', err);
    res.status(500).json({ error: 'Failed to import vocabulary' });
  }
});

// POST /api/vocab/class - create class with phrases + vocabulary
vocabularyRouter.post('/class', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || !payload.name) return res.status(400).json({ error: 'Missing class name' });
    const cls = await vs.createClassWithEntries(payload);
    res.status(201).json(cls);
  } catch (err) {
    console.error('Error creating class', err);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// GET /api/vocab/classes - return classes with phrases and vocabulary entries
vocabularyRouter.get('/classes', async (_req: Request, res: Response) => {
  try {
    const classes = await vs.getClasses();
    res.json(classes);
  } catch (err) {
    console.error('Error fetching vocab classes', err);
    res.status(500).json({ error: 'Failed to fetch vocab classes' });
  }
});

// DELETE /api/vocab/class/:id -> delete class and its entries
vocabularyRouter.delete('/class/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    await vs.deleteClass(id);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting vocab class', err);
    res.status(500).json({ error: 'Failed to delete vocab class' });
  }
});

// POST /api/vocab/status - upsert status by word (single object or array)
vocabularyRouter.post('/status', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];
    const out: any[] = [];
    for (const it of items) {
      if (!it || !it.word) continue;
      const word = String(it.word).trim();
      const status = it.status;
      const classId = it.class || undefined;

      // If class provided, update only that class entry; otherwise update ALL entries matching the word
      await vs.setStatusForWord(word, status, classId);

      // return affected rows for client visibility
      const rows = await vs.getAllVocabulary();
      const matched = rows.filter(r => (r.word || '').toLowerCase() === word.toLowerCase());
      out.push(...matched);
    }
    res.status(200).json(out);
  } catch (err) {
    console.error('Error updating status', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// POST /api/vocab/exclude - set excluded flag by word (single object or array)
vocabularyRouter.post('/exclude', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];
    const out: any[] = [];
    for (const it of items) {
      if (!it || !it.word) continue;
      const word = String(it.word).trim();
      const excluded = !!it.excluded;
      const classId = it.class || undefined;

      await vs.setExcludedForWord(word, excluded, classId);

      const rows = await vs.getAllVocabulary();
      const matched = rows.filter(r => (r.word || '').toLowerCase() === word.toLowerCase());
      out.push(...matched);
    }
    res.status(200).json(out);
  } catch (err) {
    console.error('Error updating excluded flag', err);
    res.status(500).json({ error: 'Failed to update excluded flag' });
  }
});

// POST /api/vocab/reset -> set all statuses to unreviewed
vocabularyRouter.post('/reset', async (_req: Request, res: Response) => {
  try {
    await vs.resetAllStatuses();
    res.status(204).send();
  } catch (err) {
    console.error('Error resetting statuses', err);
    res.status(500).json({ error: 'Failed to reset statuses' });
  }
});

// DELETE /api/vocab/:id
vocabularyRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    await vs.deleteVocabulary(id);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting vocabulary entry', err);
    res.status(500).json({ error: 'Failed to delete vocabulary entry' });
  }
});
