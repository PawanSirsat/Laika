ALTER TABLE `tasks` ADD `deliverables` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `solves` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `unlocks` text DEFAULT '[]' NOT NULL;