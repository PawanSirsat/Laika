CREATE TABLE `board_column_statuses` (
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`column_id` text NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `status`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`column_id`) REFERENCES `board_columns`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "board_column_statuses_status_check" CHECK(status IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
	CONSTRAINT "board_column_statuses_is_primary_check" CHECK(is_primary IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `board_column_statuses_column_id_idx` ON `board_column_statuses` (`column_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_column_statuses_one_primary` ON `board_column_statuses` (`column_id`) WHERE is_primary = 1;--> statement-breakpoint
CREATE TABLE `board_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "board_columns_hidden_check" CHECK(hidden IN (0, 1)),
	CONSTRAINT "board_columns_name_check" CHECK(length(trim(name)) BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_columns_project_position_unique` ON `board_columns` (`project_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_columns_project_name_unique` ON `board_columns` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_columns_project_id_unique` ON `board_columns` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `board_columns_project_id_idx` ON `board_columns` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `board_hide_done_days` integer;