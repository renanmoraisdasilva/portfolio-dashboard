CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`alert_type` text NOT NULL,
	`threshold` real NOT NULL,
	`condition` text NOT NULL,
	`reference_price` real,
	`is_active` integer DEFAULT 1,
	`created_at` integer NOT NULL,
	`current_price` real,
	`previous_price` real,
	`percentage_change` real,
	`triggered_at` integer,
	`dismissed_at` integer,
	`is_dismissed` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `analytics_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`computed_at` integer NOT NULL,
	`period` text NOT NULL,
	`return_pct` real,
	`max_drawdown_pct` real,
	`max_drawdown_start` integer,
	`max_drawdown_end` integer,
	`sharpe_ratio` real,
	`allocation_json` text,
	`cost_vs_market_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_analytics_snapshots_period` ON `analytics_snapshots` (`period`);--> statement-breakpoint
CREATE TABLE `asset_chart_cache` (
	`symbol` text NOT NULL,
	`days` integer NOT NULL,
	`interval` text NOT NULL,
	`ts` integer,
	`data` text
);
--> statement-breakpoint
CREATE TABLE `cash_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`currency` text NOT NULL,
	`amount` real NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cash_entries_ts` ON `cash_entries` (`ts`);--> statement-breakpoint
CREATE TABLE `interest_months` (
	`month` text NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`amount` real,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`t` text,
	`ts` integer,
	`v` real,
	`i` real,
	`p` real,
	`manual` integer,
	`note` text,
	`brlusd_rate` real
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_snapshots_ts` ON `portfolio_snapshots` (`ts`);--> statement-breakpoint
CREATE TABLE `price_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`price` real,
	`ts` integer,
	`meta` text
);
--> statement-breakpoint
CREATE TABLE `price_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`price` real NOT NULL,
	`ts` integer NOT NULL,
	`source` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_price_ticks_symbol_ts` ON `price_ticks` (`symbol`,`ts`);--> statement-breakpoint
CREATE INDEX `idx_price_ticks_symbol_ts` ON `price_ticks` (`symbol`,`ts`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`qty` real NOT NULL,
	`price` real,
	`time` text NOT NULL,
	`profit` real
);
--> statement-breakpoint
CREATE INDEX `idx_trades_time` ON `trades` (`time`);