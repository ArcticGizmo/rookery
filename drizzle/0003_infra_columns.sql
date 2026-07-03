ALTER TABLE `runs` ADD `infra_template` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `infra_teardown` integer DEFAULT true NOT NULL;