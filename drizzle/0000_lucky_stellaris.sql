CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`run_id` text,
	`stage_id` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `idx_events_run_id` ON `events` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_events_ts` ON `events` (`ts`);