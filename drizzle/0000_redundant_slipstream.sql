CREATE TABLE `approach_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`flight_id` text,
	`stage_id` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `idx_events_flight_id` ON `events` (`flight_id`);--> statement-breakpoint
CREATE INDEX `idx_events_ts` ON `events` (`ts`);--> statement-breakpoint
CREATE TABLE `flights` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`approach_id` text NOT NULL,
	`approach_version` integer NOT NULL,
	`approach_body` text NOT NULL,
	`status` text NOT NULL,
	`current_stage_index` integer NOT NULL,
	`max_iterations` integer NOT NULL,
	`max_verification_cycles` integer DEFAULT 2 NOT NULL,
	`infra_template` text,
	`infra_teardown` integer DEFAULT true NOT NULL,
	`execution_mode` text,
	`work_branch` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flights_brief` ON `flights` (`brief_id`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`name` text NOT NULL,
	`local_path` text NOT NULL,
	`remote_url` text,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_repos_brief` ON `repos` (`brief_id`);--> statement-breakpoint
CREATE TABLE `spec_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_hash` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_spec_versions_brief` ON `spec_versions` (`brief_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spec_versions_brief_version` ON `spec_versions` (`brief_id`,`version`);--> statement-breakpoint
CREATE TABLE `stage_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`flight_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`stage_index` integer NOT NULL,
	`status` text NOT NULL,
	`iteration` integer NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stage_exec_flight` ON `stage_executions` (`flight_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stage_exec_flight_stage` ON `stage_executions` (`flight_id`,`stage_index`);