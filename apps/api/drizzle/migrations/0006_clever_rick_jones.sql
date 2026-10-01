PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_asset_chart_cache` (
	`symbol` text NOT NULL,
	`days` integer NOT NULL,
	`interval` text NOT NULL,
	`ts` integer,
	`data` text,
	PRIMARY KEY(`symbol`, `days`, `interval`)
);
--> statement-breakpoint
-- Deduplicate BEFORE the copy, not after.
--
-- The table had no key, so every cache miss appended a row and none of them were
-- ever replaced: the live database held 16 rows across 10 distinct keys. Copying
-- that into a table with a primary key raises `UNIQUE constraint failed` and
-- aborts the migration, which stops the server booting (see the `interest`
-- unique-index note in AGENTS.md - same failure mode).
--
-- One row survives per key: the newest by `ts`, since that is the freshest fetch.
-- `rowid` breaks a tie so the statement is deterministic rather than
-- arbitrary - without it SQLite picks whichever row the scan reaches first.
INSERT INTO `__new_asset_chart_cache`("symbol", "days", "interval", "ts", "data")
SELECT "symbol", "days", "interval", "ts", "data"
FROM "asset_chart_cache" AS "old"
WHERE "rowid" IN (
  SELECT "rowid" FROM (
    SELECT "rowid", "ts",
           ROW_NUMBER() OVER (
             PARTITION BY "symbol", "days", "interval"
             ORDER BY "ts" DESC, "rowid" DESC
           ) AS "rn"
    FROM "asset_chart_cache"
  ) WHERE "rn" = 1
);--> statement-breakpoint
DROP TABLE `asset_chart_cache`;--> statement-breakpoint
ALTER TABLE `__new_asset_chart_cache` RENAME TO `asset_chart_cache`;--> statement-breakpoint
PRAGMA foreign_keys=ON;