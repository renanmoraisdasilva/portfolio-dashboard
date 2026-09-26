ALTER TABLE `cash_entries` RENAME TO `cash`;--> statement-breakpoint
DROP INDEX `idx_cash_entries_ts`;--> statement-breakpoint
CREATE INDEX `idx_cash_ts` ON `cash` (`ts`);