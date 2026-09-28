import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { run, all, get } from '../db';
import { Alert } from '../models';
import { sendHomeAssistantNotification } from '../services/homeAssistantService';

export const alertsRouter = Router();

alertsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const alerts = await all<Alert>('SELECT * FROM alerts ORDER BY created_at DESC');
    res.json(alerts);
  } catch (err) {
    console.error('Error fetching alerts', err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

alertsRouter.get('/triggered', async (req: Request, res: Response) => {
  try {
    const triggered = await all<Alert>(
      `SELECT * FROM alerts WHERE triggered_at IS NOT NULL AND is_dismissed = 0 ORDER BY triggered_at DESC`,
    );
    res.json(triggered);
  } catch (err) {
    console.error('Error fetching triggered alerts', err);
    res.status(500).json({ error: 'Failed to fetch triggered alerts' });
  }
});

alertsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { symbol, alert_type, threshold, condition, reference_price } = req.body;

    if (!symbol || !alert_type || threshold === undefined || !condition) {
      return res.status(400).json({ error: 'Missing required fields: symbol, alert_type, threshold, condition' });
    }

    if (!['value', 'percentage'].includes(alert_type)) {
      return res.status(400).json({ error: 'alert_type must be "value" or "percentage"' });
    }

    if (!['above', 'below'].includes(condition)) {
      return res.status(400).json({ error: 'condition must be "above" or "below"' });
    }

    if (alert_type === 'percentage' && reference_price === undefined) {
      return res.status(400).json({ error: 'reference_price is required for percentage-based alerts' });
    }

    const id = randomUUID();
    const now = Date.now();

    await run(
      'INSERT INTO alerts (id, symbol, alert_type, threshold, condition, reference_price, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, symbol.toUpperCase(), alert_type, threshold, condition, reference_price ?? null, 1, now],
    );

    const alert = await get<Alert>('SELECT * FROM alerts WHERE id = ?', [id]);
    res.status(201).json({ alert });
  } catch (err) {
    console.error('Error creating alert', err);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

alertsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { symbol, alert_type, threshold, condition, reference_price, is_active } = req.body;

    const updates: { field: string; value: any }[] = [];

    if (symbol !== undefined) updates.push({ field: 'symbol', value: symbol.toUpperCase() });
    if (alert_type !== undefined) updates.push({ field: 'alert_type', value: alert_type });
    if (threshold !== undefined) updates.push({ field: 'threshold', value: threshold });
    if (condition !== undefined) updates.push({ field: 'condition', value: condition });
    if (reference_price !== undefined) updates.push({ field: 'reference_price', value: reference_price ?? null });
    if (is_active !== undefined) updates.push({ field: 'is_active', value: is_active ? 1 : 0 });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const setClause = updates.map((u) => `${u.field} = ?`).join(', ');
    const values = updates.map((u) => u.value);
    values.push(id);

    await run(`UPDATE alerts SET ${setClause} WHERE id = ?`, values);

    const alert = await get<Alert>('SELECT * FROM alerts WHERE id = ?', [id]);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ alert });
  } catch (err) {
    console.error('Error updating alert', err);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

alertsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM alerts WHERE id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting alert', err);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

alertsRouter.post('/dismiss/:alertId', async (req: Request, res: Response) => {
  try {
    const { alertId } = req.params;
    const now = Date.now();

    await run('UPDATE alerts SET is_dismissed = 1, dismissed_at = ? WHERE id = ?', [now, alertId]);

    const alert = await get<Alert>('SELECT * FROM alerts WHERE id = ?', [alertId]);

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ alert });
  } catch (err) {
    console.error('Error dismissing alert', err);
    res.status(500).json({ error: 'Failed to dismiss alert' });
  }
});

alertsRouter.post('/test-notify', async (req: Request, res: Response) => {
  try {
    const { title, message } = req.body || {};
    const t = title || 'Portfolio Test Notification';
    const m = message || 'This is a test notification from portfolio-dashboard';

    await sendHomeAssistantNotification(t, m);

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to send test notification', err);
    res.status(500).json({ error: 'Failed to send notification', details: err instanceof Error ? err.message : String(err) });
  }
});
