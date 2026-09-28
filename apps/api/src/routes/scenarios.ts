import { Router } from 'express';
import { run, get, all } from '../db';
import { randomUUID } from 'node:crypto';

export const scenariosRouter = Router();

scenariosRouter.get('/', async (req, res) => {
  try {
    const rows = await all('SELECT id, name, created_at, updated_at FROM scenarios ORDER BY COALESCE(updated_at, created_at) DESC');
    res.json(rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at || r.created_at })));
  } catch (err) {
    console.error('Failed to list scenarios', err);
    res.status(500).json({ error: 'Failed to list scenarios' });
  }
});

scenariosRouter.get('/:id', async (req, res) => {
  try {
    const row = await get('SELECT id, name, data, created_at, updated_at FROM scenarios WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ id: row.id, name: row.name, data: JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at || row.created_at });
  } catch (err) {
    console.error('Failed to get scenario', err);
    res.status(500).json({ error: 'Failed to get scenario' });
  }
});

scenariosRouter.post('/', async (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ error: 'Missing name or data' });
    const id = randomUUID();
    const now = Date.now();
    await run('INSERT INTO scenarios (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, name, JSON.stringify(data), now, now]);
    res.json({ id, name, createdAt: now, updatedAt: now });
  } catch (err) {
    console.error('Failed to save scenario', err);
    res.status(500).json({ error: 'Failed to save scenario' });
  }
});

scenariosRouter.put('/:id', async (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ error: 'Missing name or data' });
    const now = Date.now();
    await run('UPDATE scenarios SET name = ?, data = ?, updated_at = ? WHERE id = ?', [name, JSON.stringify(data), now, req.params.id]);
    res.json({ id: req.params.id, name, updatedAt: now });
  } catch (err) {
    console.error('Failed to update scenario', err);
    res.status(500).json({ error: 'Failed to update scenario' });
  }
});

scenariosRouter.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM scenarios WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete scenario', err);
    res.status(500).json({ error: 'Failed to delete scenario' });
  }
});
