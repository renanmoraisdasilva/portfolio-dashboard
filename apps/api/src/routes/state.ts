import { Router } from 'express';
import { all, get, runSync, transaction } from '../db';
import { randomUUID } from 'node:crypto';
import { validateImportPayload } from './statePayload';

export const stateRouter = Router();

const EXPORT_FORMAT_VERSION = 2;

const CASH_SUM_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN currency='BRL' THEN amount ELSE 0 END), 0) AS cashReais,
    COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END), 0) AS cashDollars
  FROM cash
`;

stateRouter.get('/export', async (req, res) => {
  try {
    const trades = await all('SELECT * FROM trades ORDER BY time ASC');
    const history = await all('SELECT * FROM portfolio_snapshots ORDER BY ts ASC');
    const interestBRLMonths = await all('SELECT month, amount, currency FROM interest WHERE currency = ? ORDER BY month DESC', [
      'BRL',
    ]);
    const interestUSDMonths = await all('SELECT month, amount, currency FROM interest WHERE currency = ? ORDER BY month DESC', [
      'USD',
    ]);
    const cash = await get(CASH_SUM_SQL);
    const brlInterest = await get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?',
      ['BRL'],
    );
    const usdInterest = await get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?',
      ['USD'],
    );
    const cashEntries = await all('SELECT * FROM cash ORDER BY ts ASC');
    const alertsData = await all('SELECT * FROM alerts ORDER BY created_at ASC');
    const scenariosData = await all('SELECT * FROM scenarios ORDER BY created_at ASC');
    const priceCacheData = await all('SELECT * FROM price_cache ORDER BY symbol ASC');
    const assetChartCacheData = await all('SELECT * FROM asset_chart_cache ORDER BY symbol ASC');
    const analyticsData = await all('SELECT * FROM analytics_snapshots ORDER BY computed_at ASC');
    res.setHeader('Content-Disposition', 'attachment; filename="portfolio_data.json"');
    res.json({
      formatVersion: EXPORT_FORMAT_VERSION,
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
      priceCache: priceCacheData,
      assetChartCache: assetChartCacheData,
      analyticsSnapshots: analyticsData,
    });
  } catch (err) {
    console.error('Error exporting state:', err);
    res.status(500).json({ error: 'Failed to export state' });
  }
});

stateRouter.post('/import', async (req, res) => {
  const { problems, omitted } = validateImportPayload(req.body);
  if (problems.length > 0) {
    res.status(400).json({
      error: 'Import payload is not a valid backup',
      problems,
      omitted,
    });
    return;
  }

  try {
    const payload = req.body;

    transaction(() => {
      const replace = (table: string, key: string, insert: () => void) => {
        if (!Array.isArray(payload[key])) return;
        runSync(`DELETE FROM ${table}`);
        insert();
      };

      replace('trades', 'trades', () => {
        for (const t of payload.trades) {
          runSync(
            'INSERT OR REPLACE INTO trades (id, symbol, side, qty, price, time, cash_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [t.id ?? null, t.symbol, t.side, t.qty, t.price ?? null, t.time, t.cash_entry_id ?? t.cashEntryId ?? null],
          );
        }
      });

      replace('portfolio_snapshots', 'history', () => {
        for (const h of payload.history) {
          runSync(
            'INSERT OR REPLACE INTO portfolio_snapshots (id, t, ts, v, i, p, manual, note, brlusd_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              h.id ?? null,
              h.t ?? null,
              h.ts ?? null,
              h.v ?? 0,
              h.i ?? null,
              h.p ?? null,
              h.manual ? 1 : 0,
              h.note ?? null,
              h.brlusd_rate ?? null,
            ],
          );
        }
      });
      const hasBrlMonths = Array.isArray(payload.interestReaisMonths);
      const hasUsdMonths = Array.isArray(payload.interestDollarsMonths);
      if (hasBrlMonths || hasUsdMonths) {
        runSync('DELETE FROM interest');
        const now = Date.now();
        for (const m of hasBrlMonths ? payload.interestReaisMonths : []) {
          runSync('INSERT INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
            m.month,
            'BRL',
            m.amount,
            now,
          ]);
        }
        for (const m of hasUsdMonths ? payload.interestDollarsMonths : []) {
          runSync('INSERT INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
            m.month,
            'USD',
            m.amount,
            now,
          ]);
        }
      }
      replace('alerts', 'alerts', () => {
        for (const a of payload.alerts) {
          runSync(
            'INSERT OR REPLACE INTO alerts (id, symbol, alert_type, threshold, condition, reference_price, is_active, created_at, current_price, previous_price, percentage_change, triggered_at, dismissed_at, is_dismissed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              a.id ?? randomUUID(),
              a.symbol,
              a.alert_type,
              a.threshold,
              a.condition,
              a.reference_price ?? null,
              a.is_active ?? 1,
              a.created_at ?? Date.now(),
              a.current_price ?? null,
              a.previous_price ?? null,
              a.percentage_change ?? null,
              a.triggered_at ?? null,
              a.dismissed_at ?? null,
              a.is_dismissed ?? 0,
            ],
          );
        }
      });

      replace('scenarios', 'scenarios', () => {
        for (const s of payload.scenarios) {
          runSync('INSERT OR REPLACE INTO scenarios (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
            s.id ?? randomUUID(),
            s.name,
            s.data,
            s.created_at ?? Date.now(),
            s.updated_at ?? null,
          ]);
        }
      });

      replace('price_cache', 'priceCache', () => {
        for (const p of payload.priceCache) {
          runSync('INSERT OR REPLACE INTO price_cache (symbol, price, ts, meta) VALUES (?, ?, ?, ?)', [
            p.symbol,
            p.price,
            p.ts ?? null,
            p.meta ?? null,
          ]);
        }
      });

      replace('asset_chart_cache', 'assetChartCache', () => {
        for (const c of payload.assetChartCache) {
          runSync('INSERT OR REPLACE INTO asset_chart_cache (symbol, days, interval, ts, data) VALUES (?, ?, ?, ?, ?)', [
            c.symbol,
            c.days,
            c.interval,
            c.ts ?? null,
            c.data ?? null,
          ]);
        }
      });

      replace('analytics_snapshots', 'analyticsSnapshots', () => {
        for (const a of payload.analyticsSnapshots) {
          runSync(
            'INSERT OR REPLACE INTO analytics_snapshots (id, computed_at, period, return_pct, max_drawdown_pct, max_drawdown_start, max_drawdown_end, sharpe_ratio, allocation_json, cost_vs_market_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              a.id ?? randomUUID(),
              a.computed_at ?? Date.now(),
              a.period,
              a.return_pct ?? null,
              a.max_drawdown_pct ?? null,
              a.max_drawdown_start ?? null,
              a.max_drawdown_end ?? null,
              a.sharpe_ratio ?? null,
              a.allocation_json ?? null,
              a.cost_vs_market_json ?? null,
            ],
          );
        }
      });
      if (payload.cashEntries && Array.isArray(payload.cashEntries)) {
        runSync('DELETE FROM cash');
        for (const e of payload.cashEntries) {
          runSync('INSERT OR REPLACE INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
            e.id ?? randomUUID(),
            e.currency,
            e.amount,
            e.description ?? '',
            e.ts ?? Date.now(),
          ]);
        }
      } else if (typeof payload.cashReais !== 'undefined' || typeof payload.cashDollars !== 'undefined') {
        const cashReais = Number(payload.cashReais) || 0;
        const cashDollars = Number(payload.cashDollars) || 0;
        runSync('DELETE FROM cash');
        const entryTs = Date.now();
        if (cashReais !== 0) {
          runSync('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
            randomUUID(),
            'BRL',
            cashReais,
            'Imported Balance',
            entryTs,
          ]);
        }
        if (cashDollars !== 0) {
          runSync('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
            randomUUID(),
            'USD',
            cashDollars,
            'Imported Balance',
            entryTs,
          ]);
        }
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error importing state:', err);
    res.status(500).json({ error: 'Failed to import state' });
  }
});
