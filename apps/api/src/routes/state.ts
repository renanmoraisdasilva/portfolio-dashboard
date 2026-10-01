import { Router } from 'express';
import { all, get, run } from '../db';
import { randomUUID } from 'node:crypto';

/**
 * Backup and restore for `portfolio.db`.
 *
 * `GET /api/state` was retired: the Vue views read `/trades`, `/cash` and
 * `/interest/months`, so the aggregation duplicated endpoints that already
 * existed and needed its own 10-second cache to hide the cost. What is left
 * cannot be expressed granularly — an export spans nine tables and an import
 * replaces them inside one transaction — so it keeps its `/api/state/*` paths
 * rather than pretending to be per-resource endpoints.
 *
 * This is the app's only backup mechanism, so "all of my data" means all of it
 * that cannot be re-derived: everything except `price_ticks`, which is fetched
 * from Yahoo and Coinbase and is 28 MB of the 30 MB file. Excluding it is not
 * only principle - including it would exceed the 10 MB body limit that
 * `express.json` imposes on the import, so the app could no longer restore its
 * own backup.
 *
 * `__drizzle_migrations` is deliberately not exported. It records which schema
 * migrations have run, and restoring it would make the database claim a
 * migration history it does not have; a restore into a fresh database gets the
 * real one when the app boots.
 */
export const stateRouter = Router();

/** Bumped when the payload shape changes, so an old file is recognisable. */
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
    // The three tables an earlier export left out. Without them a restore came
    // back with no current prices (every position valued zero until the worker
    // refetched), no cached chart series, and no analytics until the next daily
    // job. They are small next to `history` and cannot be re-derived without
    // re-fetching, so they belong in the backup.
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
  try {
    const payload = req.body;
    await run('BEGIN TRANSACTION');
    try {
      // Every table the export carries is *replaced*, not merged. It used to be a
      // mixture: `cash` and `interest` were cleared first while `trades` and
      // `history` were inserted row by row, so anything in the database that the
      // backup did not contain survived. A tool labelled "restore" that cannot
      // remove a trade or a snapshot is a merge wearing a restore's name, and
      // restoring an older backup after a mistake left the mistake in place.
      //
      // A key that is absent or not an array leaves its table untouched, so a
      // partial payload cannot silently empty a table.
      const replace = async (table: string, key: string, insert: () => Promise<void>) => {
        if (!Array.isArray(payload[key])) return;
        await run(`DELETE FROM ${table}`);
        await insert();
      };

      await replace('trades', 'trades', async () => {
        for (const t of payload.trades) {
          // No `profit` column: it was dropped in migration 0003, and writing it
          // made every restore fail with "table trades has no column named
          // profit". Exported backups may still carry the field; it is ignored.
          //
          // `cash_entry_id` is restored so that deleting a restored trade still
          // reverses its cash movement. It is null in backups taken before that
          // column existed, and nulling it is safe: there is no link to follow,
          // so nothing is reversed.
          await run(
            'INSERT OR REPLACE INTO trades (id, symbol, side, qty, price, time, cash_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [t.id ?? null, t.symbol, t.side, t.qty, t.price ?? null, t.time, t.cash_entry_id ?? t.cashEntryId ?? null],
          );
        }
      });

      await replace('portfolio_snapshots', 'history', async () => {
        // `brlusd_rate` was missing from this column list while the export sent
        // it (`SELECT *`), so a restore silently nulled the exchange rate on
        // every snapshot: 0% null before a restore, 100% after. `analyticsService`
        // reads that column to convert BRL interest at the rate of the following
        // snapshot and falls back to today's rate when it is null, so the
        // analytics came out of a restore converted at the wrong rate. The
        // candles are unaffected - the high/low of each one comes from `v` and
        // `p` - which is why this hid. `?? null` keeps older backups importable.
        for (const h of payload.history) {
          await run(
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
      // One wholesale DELETE for both currencies, not one per currency.
      //
      // Clearing `WHERE currency = 'BRL'` and then `WHERE currency = 'USD'`
      // replaced only those two. A row in any third currency survived every
      // restore, which contradicts the contract this endpoint documents — "every
      // table the payload carries is replaced" — and it failed quietly, which is
      // the only way a stale row survives a restore at all.
      //
      // The delete is guarded on *either* months key being present, because the
      // two are independent halves of one table: clearing both when only the BRL
      // half arrived would drop USD months the backup never mentioned. Same rule
      // as `replace()` above — a key that is absent leaves its table alone.
      const hasBrlMonths = Array.isArray(payload.interestReaisMonths);
      const hasUsdMonths = Array.isArray(payload.interestDollarsMonths);
      if (hasBrlMonths || hasUsdMonths) {
        await run('DELETE FROM interest');
        // `Date.now()` is read once so every restored row shares a `created_at`,
        // rather than drifting by a millisecond per iteration.
        const now = Date.now();
        for (const m of hasBrlMonths ? payload.interestReaisMonths : []) {
          await run('INSERT INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
            m.month,
            'BRL',
            m.amount,
            now,
          ]);
        }
        for (const m of hasUsdMonths ? payload.interestDollarsMonths : []) {
          await run('INSERT INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)', [
            m.month,
            'USD',
            m.amount,
            now,
          ]);
        }
      }
      await replace('alerts', 'alerts', async () => {
        for (const a of payload.alerts) {
          await run(
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

      await replace('scenarios', 'scenarios', async () => {
        for (const s of payload.scenarios) {
          await run('INSERT OR REPLACE INTO scenarios (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
            s.id ?? randomUUID(),
            s.name,
            s.data,
            s.created_at ?? Date.now(),
            s.updated_at ?? null,
          ]);
        }
      });

      // The three tables added to the export in version 2. Absent from a
      // version 1 backup, in which case `replace` leaves the table alone.
      await replace('price_cache', 'priceCache', async () => {
        for (const p of payload.priceCache) {
          await run('INSERT OR REPLACE INTO price_cache (symbol, price, ts, meta) VALUES (?, ?, ?, ?)', [
            p.symbol,
            p.price,
            p.ts ?? null,
            p.meta ?? null,
          ]);
        }
      });

      await replace('asset_chart_cache', 'assetChartCache', async () => {
        for (const c of payload.assetChartCache) {
          await run('INSERT OR REPLACE INTO asset_chart_cache (symbol, days, interval, ts, data) VALUES (?, ?, ?, ?, ?)', [
            c.symbol,
            c.days,
            c.interval,
            c.ts ?? null,
            c.data ?? null,
          ]);
        }
      });

      await replace('analytics_snapshots', 'analyticsSnapshots', async () => {
        for (const a of payload.analyticsSnapshots) {
          await run(
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
        await run('DELETE FROM cash');
        for (const e of payload.cashEntries) {
          await run('INSERT OR REPLACE INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
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
        await run('DELETE FROM cash');
        const entryTs = Date.now();
        if (cashReais !== 0) {
          await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
            randomUUID(),
            'BRL',
            cashReais,
            'Imported Balance',
            entryTs,
          ]);
        }
        if (cashDollars !== 0) {
          await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
            randomUUID(),
            'USD',
            cashDollars,
            'Imported Balance',
            entryTs,
          ]);
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

// `DELETE /api/state` - "Erase All" - is gone. It deleted trades, snapshots,
// interest and cash while leaving `price_ticks`, alerts, scenarios and
// analytics_snapshots behind, so it was a misnomer as well as a total loss with
// no way back. Restoring a backup is now a true replace, which covers the
// "start from a known state" case the button was there for.
