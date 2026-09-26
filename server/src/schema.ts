/**
 * Drizzle ORM schema for portfolio.db
 *
 * This file is the single source of truth for the portfolio database schema.
 * - Add a new column here, run `npm run db:generate`, commit the migration file.
 * - Never add ad-hoc ALTER TABLE calls to db.ts — create a migration instead.
 *
 * Finance and vocabulary databases are out of scope for now (still use their
 * own init() functions in financeDb.ts / vocabularyService.ts).
 */

import { sqliteTable, text, real, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// trades — immutable append-only event log
// ---------------------------------------------------------------------------
export const trades = sqliteTable('trades', {
  id:     text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  side:   text('side').notNull(),
  qty:    real('qty').notNull(),
  price:  real('price'),
  time:   text('time').notNull(),
}, (t) => [
  index('idx_trades_time').on(t.time),
]);

// ---------------------------------------------------------------------------
// portfolio_snapshots — materialized view: portfolio value over time
// ---------------------------------------------------------------------------
export const portfolioSnapshots = sqliteTable('portfolio_snapshots', {
  id:         text('id').primaryKey(),
  t:          text('t'),
  ts:         integer('ts'),
  v:          real('v'),
  i:          real('i'),
  p:          real('p'),
  manual:     integer('manual'),
  note:       text('note'),
  brlusd_rate: real('brlusd_rate'),
}, (t) => [
  index('idx_portfolio_snapshots_ts').on(t.ts),
]);

// ---------------------------------------------------------------------------
// price_cache — write-through cache: latest price per symbol
// ---------------------------------------------------------------------------
export const priceCache = sqliteTable('price_cache', {
  symbol: text('symbol').primaryKey(),
  price:  real('price'),
  ts:     integer('ts'),
  meta:   text('meta'),
});

// ---------------------------------------------------------------------------
// asset_chart_cache — serialised price series blob per (symbol, days, interval)
// ---------------------------------------------------------------------------
export const assetChartCache = sqliteTable('asset_chart_cache', {
  symbol:   text('symbol').notNull(),
  days:     integer('days').notNull(),
  interval: text('interval').notNull(),
  ts:       integer('ts'),
  data:     text('data'),
}, (t) => [
  // Composite PK expressed as a unique index (Drizzle handles composite PKs via primaryKey() helper)
]);

// ---------------------------------------------------------------------------
// interest — BRL / USD monthly interest entries
// ---------------------------------------------------------------------------
export const interestMonths = sqliteTable('interest', {
  month:      text('month').notNull(),
  currency:   text('currency').notNull().default('BRL'),
  amount:     real('amount'),
  created_at: integer('created_at'),
});

// ---------------------------------------------------------------------------
// cash — append-only ledger; balance = SUM(amount) by currency
// ---------------------------------------------------------------------------
export const cashEntries = sqliteTable('cash', {
  id:          text('id').primaryKey(),
  currency:    text('currency').notNull(),
  amount:      real('amount').notNull(),
  description: text('description').notNull().default(''),
  ts:          integer('ts').notNull(),
}, (t) => [
  index('idx_cash_ts').on(t.ts),
]);

// ---------------------------------------------------------------------------
// price_ticks — immutable price event log (append-only)
// ---------------------------------------------------------------------------
export const priceTicks = sqliteTable('price_ticks', {
  id:     text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  price:  real('price').notNull(),
  ts:     integer('ts').notNull(),
  source: text('source'),
}, (t) => [
  uniqueIndex('uq_price_ticks_symbol_ts').on(t.symbol, t.ts),
  index('idx_price_ticks_symbol_ts').on(t.symbol, t.ts),
]);

// ---------------------------------------------------------------------------
// scenarios — saved simulation snapshots
// ---------------------------------------------------------------------------
export const scenarios = sqliteTable('scenarios', {
  id:         text('id').primaryKey(),
  name:       text('name').notNull(),
  data:       text('data').notNull(),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at'),
});

// ---------------------------------------------------------------------------
// alerts — price alert rules + latest trigger state (denormalised)
// ---------------------------------------------------------------------------
export const alerts = sqliteTable('alerts', {
  id:               text('id').primaryKey(),
  symbol:           text('symbol').notNull(),
  alert_type:       text('alert_type').notNull(),
  threshold:        real('threshold').notNull(),
  condition:        text('condition').notNull(),
  reference_price:  real('reference_price'),
  is_active:        integer('is_active').default(1),
  created_at:       integer('created_at').notNull(),
  current_price:    real('current_price'),
  previous_price:   real('previous_price'),
  percentage_change: real('percentage_change'),
  triggered_at:     integer('triggered_at'),
  dismissed_at:     integer('dismissed_at'),
  is_dismissed:     integer('is_dismissed').default(0),
});

// ---------------------------------------------------------------------------
// analytics_snapshots — pre-computed analytics per period (batch job output)
// ---------------------------------------------------------------------------
export const analyticsSnapshots = sqliteTable('analytics_snapshots', {
  id:                  text('id').primaryKey(),
  computed_at:         integer('computed_at').notNull(),
  period:              text('period').notNull(),
  return_pct:          real('return_pct'),
  max_drawdown_pct:    real('max_drawdown_pct'),
  max_drawdown_start:  integer('max_drawdown_start'),
  max_drawdown_end:    integer('max_drawdown_end'),
  sharpe_ratio:        real('sharpe_ratio'),
  allocation_json:     text('allocation_json'),
  cost_vs_market_json: text('cost_vs_market_json'),
}, (t) => [
  uniqueIndex('idx_analytics_snapshots_period').on(t.period),
]);
