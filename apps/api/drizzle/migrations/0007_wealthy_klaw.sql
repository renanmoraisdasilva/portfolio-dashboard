PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`alert_type` text NOT NULL,
	`threshold` real NOT NULL,
	`condition` text NOT NULL,
	`reference_price` real,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`current_price` real,
	`previous_price` real,
	`percentage_change` real,
	`triggered_at` integer,
	`dismissed_at` integer,
	`is_dismissed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- COALESCE the two flags, because the columns are NOT NULL in the new table and
-- a row that predates this migration can hold NULL: the copy below would abort
-- with `NOT NULL constraint failed` and stop the server booting.
--
--   `is_active`      NULL -> 1  the column's own default; NULL there meant "not
--                             yet enabled", and the query filters on `= 1`, so
--                             such a row was invisible either way.
--   `is_dismissed`   NULL -> 0  NOT DISMISSED. This is the one that matters.
--                             `checkAndTriggerAlerts` compares `is_dismissed = 0`
--                             to decide whether an alert has already fired;
--                             NULL compared false, so the alert looked un-fired
--                             forever and re-notified on every 8-minute cycle.
INSERT INTO `__new_alerts`("id", "symbol", "alert_type", "threshold", "condition", "reference_price", "is_active", "created_at", "current_price", "previous_price", "percentage_change", "triggered_at", "dismissed_at", "is_dismissed")
SELECT "id", "symbol", "alert_type", "threshold", "condition", "reference_price", COALESCE("is_active", 1), "created_at", "current_price", "previous_price", "percentage_change", "triggered_at", "dismissed_at", COALESCE("is_dismissed", 0) FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;