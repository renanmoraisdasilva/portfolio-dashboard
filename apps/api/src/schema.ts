import { sqliteTable, text, real, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const trades = sqliteTable(
  'trades',
  {
    id: text('id').primaryKey(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    qty: real('qty').notNull(),
    price: real('price'),
    time: text('time').notNull(),
    /**
     * The `cash` row this trade created, so deleting the trade can reverse it.
     *
     * `POST /api/trades` writes a cash movement for every trade, but
     * `DELETE /api/trades/:id` used to remove only the trade — so a deleted
     * trade's proceeds stayed in the balance permanently, inflating cash,
     * `invested` and `total` forever. The link lives on the trade rather than as
     * a `trade_id` on `cash` because a trade produces at most one cash row,
     * while `cash` also holds hand-entered adjustments that belong to no trade.
     *
     * Null for trades that have no cash entry: the six imported from the fixture
     * (the import path writes trades without cash movements), and any trade
     * restored from a backup taken before this column existed. Deleting those
     * reverses nothing, which is correct — there is nothing of ours to undo.
     */
    cashEntryId: text('cash_entry_id'),
  },
  (t) => [index('idx_trades_time').on(t.time)],
);

export const portfolioSnapshots = sqliteTable(
  'portfolio_snapshots',
  {
    id: text('id').primaryKey(),
    t: text('t'),
    ts: integer('ts'),
    v: real('v'),
    i: real('i'),
    p: real('p'),
    manual: integer('manual'),
    note: text('note'),
    brlusd_rate: real('brlusd_rate'),
  },
  (t) => [index('idx_portfolio_snapshots_ts').on(t.ts)],
);

export const priceCache = sqliteTable('price_cache', {
  symbol: text('symbol').primaryKey(),
  price: real('price'),
  ts: integer('ts'),
  meta: text('meta'),
});

export const assetChartCache = sqliteTable(
  'asset_chart_cache',
  {
    symbol: text('symbol').notNull(),
    days: integer('days').notNull(),
    interval: text('interval').notNull(),
    ts: integer('ts'),
    data: text('data'),
  },
  () => [
    // Composite PK expressed as a unique index (Drizzle handles composite PKs via primaryKey() helper)
  ],
);

export const interestMonths = sqliteTable(
  'interest',
  {
    month: text('month').notNull(),
    currency: text('currency').notNull().default('BRL'),
    amount: real('amount'),
    created_at: integer('created_at'),
  },
  // A month is identified by (month, currency), and until this index existed the
  // table enforced that only by convention. `INSERT OR REPLACE` therefore
  // *appended* a second row instead of replacing one, so editing a month's
  // amount listed it twice and counted it twice, and restoring a backup doubled
  // every month. Both routes now delete before inserting, so nothing creates
  // duplicates - but convention is not an invariant, and the index is.
  //
  // The failure mode is the point: a duplicate insert now fails loudly with a
  // UNIQUE constraint error instead of quietly double-counting income. There
  // were no duplicates to clear when this was added (14 rows, 14 distinct
  // pairs), so the migration is a bare CREATE UNIQUE INDEX and deletes nothing.
  (t) => [uniqueIndex('idx_interest_month_currency').on(t.month, t.currency)],
);

export const cashEntries = sqliteTable(
  'cash',
  {
    id: text('id').primaryKey(),
    currency: text('currency').notNull(),
    amount: real('amount').notNull(),
    description: text('description').notNull().default(''),
    ts: integer('ts').notNull(),
  },
  (t) => [index('idx_cash_ts').on(t.ts)],
);

export const priceTicks = sqliteTable(
  'price_ticks',
  {
    id: text('id').primaryKey(),
    symbol: text('symbol').notNull(),
    price: real('price').notNull(),
    ts: integer('ts').notNull(),
    source: text('source'),
  },
  (t) => [uniqueIndex('uq_price_ticks_symbol_ts').on(t.symbol, t.ts), index('idx_price_ticks_symbol_ts').on(t.symbol, t.ts)],
);

export const scenarios = sqliteTable('scenarios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  data: text('data').notNull(),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at'),
});

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  alert_type: text('alert_type').notNull(),
  threshold: real('threshold').notNull(),
  condition: text('condition').notNull(),
  reference_price: real('reference_price'),
  is_active: integer('is_active').default(1),
  created_at: integer('created_at').notNull(),
  current_price: real('current_price'),
  previous_price: real('previous_price'),
  percentage_change: real('percentage_change'),
  triggered_at: integer('triggered_at'),
  dismissed_at: integer('dismissed_at'),
  is_dismissed: integer('is_dismissed').default(0),
});

export const analyticsSnapshots = sqliteTable(
  'analytics_snapshots',
  {
    id: text('id').primaryKey(),
    computed_at: integer('computed_at').notNull(),
    period: text('period').notNull(),
    return_pct: real('return_pct'),
    max_drawdown_pct: real('max_drawdown_pct'),
    max_drawdown_start: integer('max_drawdown_start'),
    max_drawdown_end: integer('max_drawdown_end'),
    sharpe_ratio: real('sharpe_ratio'),
    allocation_json: text('allocation_json'),
    cost_vs_market_json: text('cost_vs_market_json'),
  },
  (t) => [uniqueIndex('idx_analytics_snapshots_period').on(t.period)],
);
