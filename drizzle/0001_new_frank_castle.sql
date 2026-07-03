CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`name` text NOT NULL,
	`local_path` text NOT NULL,
	`remote_url` text,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_repos_work_item` ON `repos` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `spec_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_hash` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_spec_versions_work_item` ON `spec_versions` (`work_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spec_versions_work_item_version` ON `spec_versions` (`work_item_id`,`version`);--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
