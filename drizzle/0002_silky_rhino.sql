CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_version` integer NOT NULL,
	`workflow_body` text NOT NULL,
	`status` text NOT NULL,
	`current_stage_index` integer NOT NULL,
	`max_iterations` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_runs_work_item` ON `runs` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `stage_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`stage_index` integer NOT NULL,
	`status` text NOT NULL,
	`iteration` integer NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stage_exec_run` ON `stage_executions` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stage_exec_run_stage` ON `stage_executions` (`run_id`,`stage_index`);