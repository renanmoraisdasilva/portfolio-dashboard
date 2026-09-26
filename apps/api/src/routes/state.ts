import { Router } from 'express';
import { all, get, run } from '../db';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { getOrSetResponse, STATE_CACHE_KEY } from '../services/responseCache';

export const stateRouter = Router();

const CASH_SUM_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN currency='BRL' THEN amount ELSE 0 END), 0) AS cashReais,
    COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END), 0) AS cashDollars
  FROM cash
`;

// GET /api/state -> returns aggregated state from DB
stateRouter.get('/', async (req: Request, res: Response) => {
  try {
    const state = await getOrSetResponse(STATE_CACHE_KEY, 10_000, async () => {
      const trades = await all('SELECT * FROM trades ORDER BY time ASC');
      const interestBRLMonths = await all('SELECT month, amount FROM interest WHERE currency = ? ORDER BY month DESC', ['BRL']);
      const interestUSDMonths = await all('SELECT month, amount FROM interest WHERE currency = ? ORDER BY month DESC', ['USD']);
      const cash = await get(CASH_SUM_SQL);
      const brlInterest = await get<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?', ['BRL']);
      const usdInterest = await get<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?', ['USD']);

      return {
        trades,
        interestReaisMonths: interestBRLMonths,
        interestDollarsMonths: interestUSDMonths,
        cashReais: cash?.cashReais ?? 0,
        cashDollars: cash?.cashDollars ?? 0,
        interestReais: brlInterest?.total ?? 0,
        interestDollars: usdInterest?.total ?? 0,
      };
    });
    res.json(state);
  } catch (err) {
    console.error('Error fetching state:', err);
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

// GET /api/export -> same as GET /api/state, kept for compatibility
stateRouter.get('/export', async (req, res) => {
  try {
    const trades = await all('SELECT * FROM trades ORDER BY time ASC');
    const history = await all('SELECT * FROM portfolio_snapshots ORDER BY ts ASC');
    const interestBRLMonths = await all('SELECT month, amount, currency FROM interest WHERE currency = ? ORDER BY month DESC', ['BRL']);
    const interestUSDMonths = await all('SELECT month, amount, currency FROM interest WHERE currency = ? ORDER BY month DESC', ['USD']);
    const cash = await get(CASH_SUM_SQL);
    const brlInterest = await get<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?', ['BRL']);
    const usdInterest = await get<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?', ['USD']);
    const cashEntries = await all('SELECT * FROM cash ORDER BY ts ASC');
    const alertsData = await all('SELECT * FROM alerts ORDER BY created_at ASC');
    const scenariosData = await all('SELECT * FROM scenarios ORDER BY created_at ASC');
    res.setHeader('Content-Disposition', 'attachment; filename="portfolio_data.json"');
    res.json({
      trades,
      history,
      interestReaisMonths: interestBRLMonths,
      interestDollarsMonths: interestUSDMonths,
      cashEntries,
      cashReais: cash?.cashReais ?? 0,
      cashDollars: cash?.cashDollars ?? 0,
      interestReais: brlInterest?.total ?? 0,
      interestDollars: usdInterest?.total ?? 0,
      alerts: alertsData,
      scenarios: scenariosData,
    });
  } catch (err) {
    console.error('Error exporting state:', err);
    res.status(500).json({ error: 'Failed to export state' });
  }
});

// POST /api/import -> import JSON payload into DB
stateRouter.post('/import', async (req, res) => {
  try {
    const payload = req.body;
    await run('BEGIN TRANSACTION');
    try {
      // Very simple validation and insertion (non-idempotent). For large imports prefer migration script.
      if (payload.trades && Array.isArray(payload.trades)) {
        for (const t of payload.trades) {
          // Use INSERT OR REPLACE to avoid failing on existing primary keys during imports
          await run('INSERT OR REPLACE INTO trades (id, symbol, side, qty, price, time, profit) VALUES (?, ?, ?, ?, ?, ?, ?)', [t.id ?? null, t.symbol, t.side, t.qty, t.price ?? null, t.time, t.profit ?? null]);
        }
      }
      if (payload.history && Array.isArray(payload.history)) {
        for (const h of payload.history) {
          // Use INSERT OR REPLACE so repeated imports don't error on existing history IDs
          await run('INSERT OR REPLACE INTO portfolio_snapshots (id, t, ts, v, i, p, manual, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [h.id ?? null, h.t ?? null, h.ts ?? null, h.v ?? 0, h.i ?? null, h.p ?? null, h.manual ? 1 : 0, h.note ?? null]);
        }
      }
      // Interest months — BRL
      if (payload.interestReaisMonths && Array.isArray(payload.interestReaisMonths)) {
        for (const m of payload.interestReaisMonths) {
          await run('INSERT OR REPLACE INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [m.month, 'BRL', m.amount, Date.now()]);
        }
      }
      // Interest months — USD
      if (payload.interestDollarsMonths && Array.isArray(payload.interestDollarsMonths)) {
        for (const m of payload.interestDollarsMonths) {
          await run('INSERT OR REPLACE INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [m.month, 'USD', m.amount, Date.now()]);
        }
      }
      // Alerts
      if (payload.alerts && Array.isArray(payload.alerts)) {
        for (const a of payload.alerts) {
          await run(
            'INSERT OR REPLACE INTO alerts (id, symbol, alert_type, threshold, condition, reference_price, is_active, created_at, current_price, previous_price, percentage_change, triggered_at, dismissed_at, is_dismissed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [a.id ?? randomUUID(), a.symbol, a.alert_type, a.threshold, a.condition, a.reference_price ?? null, a.is_active ?? 1, a.created_at ?? Date.now(), a.current_price ?? null, a.previous_price ?? null, a.percentage_change ?? null, a.triggered_at ?? null, a.dismissed_at ?? null, a.is_dismissed ?? 0],
          );
        }
      }
      // Scenarios
      if (payload.scenarios && Array.isArray(payload.scenarios)) {
        for (const s of payload.scenarios) {
          await run(
            'INSERT OR REPLACE INTO scenarios (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [s.id ?? randomUUID(), s.name, s.data, s.created_at ?? Date.now(), s.updated_at ?? null],
          );
        }
      }
      // Cash event log (preferred — preserves full history)
      if (payload.cashEntries && Array.isArray(payload.cashEntries)) {
        await run('DELETE FROM cash');
        for (const e of payload.cashEntries) {
          await run(
            'INSERT OR REPLACE INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)',
            [e.id ?? randomUUID(), e.currency, e.amount, e.description ?? '', e.ts ?? Date.now()],
          );
        }
      } else if (typeof payload.cashReais !== 'undefined' || typeof payload.cashDollars !== 'undefined') {
        // Fallback: legacy export that only has totals
        const cashReais = Number(payload.cashReais) || 0;
        const cashDollars = Number(payload.cashDollars) || 0;
        await run('DELETE FROM cash');
        const entryTs = Date.now();
        if (cashReais !== 0) {
          await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)',
            [randomUUID(), 'BRL', cashReais, 'Imported Balance', entryTs]);
        }
        if (cashDollars !== 0) {
          await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)',
            [randomUUID(), 'USD', cashDollars, 'Imported Balance', entryTs]);
        }
      }
      await run('COMMIT');
    } catch (innerErr) {
      await run('ROLLBACK');
      throw innerErr;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error importing state:', err);
    res.status(500).json({ error: 'Failed to import state' });
  }
});

// DELETE /api/state -> erase all data (use with caution)
stateRouter.delete('/', async (req, res) => {
  try {
    await run('DELETE FROM trades');
    await run('DELETE FROM portfolio_snapshots');
    await run('DELETE FROM interest');
    await run('DELETE FROM cash');
    res.status(204).send();
  } catch (err) {
    console.error('Error erasing state:', err);
    res.status(500).json({ error: 'Failed to erase state' });
  }
});
