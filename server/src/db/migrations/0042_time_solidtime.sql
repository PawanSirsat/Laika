CREATE TABLE `solidtime_entries` (
	`solidtime_id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`user_id` text,
	`entry_id` text,
	`entry_revision` integer,
	`hash` text NOT NULL,
	`started_at` integer NOT NULL,
	`day` text NOT NULL,
	`minutes` integer NOT NULL,
	`project_id` text,
	`task_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "solidtime_entries_minutes_check" CHECK(minutes BETWEEN 1 AND 1440),
	CONSTRAINT "solidtime_entries_twin_check" CHECK((user_id IS NULL AND entry_id IS NULL AND entry_revision IS NULL) OR (user_id IS NOT NULL AND entry_id IS NOT NULL AND entry_revision >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solidtime_entries_entry_id_unique` ON `solidtime_entries` (`entry_id`) WHERE "solidtime_entries"."entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `solidtime_entries_member_started_idx` ON `solidtime_entries` (`member_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `solidtime_entries_user_id_idx` ON `solidtime_entries` (`user_id`);--> statement-breakpoint
CREATE INDEX `solidtime_entries_project_id_idx` ON `solidtime_entries` (`project_id`);--> statement-breakpoint
CREATE INDEX `solidtime_entries_task_id_idx` ON `solidtime_entries` (`task_id`);--> statement-breakpoint
CREATE INDEX `solidtime_entries_day_idx` ON `solidtime_entries` (`day`);--> statement-breakpoint
CREATE TABLE `solidtime_people` (
	`solidtime_member_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solidtime_people_user_id_unique` ON `solidtime_people` (`user_id`);--> statement-breakpoint
CREATE INDEX `solidtime_people_confirmed_by_idx` ON `solidtime_people` (`confirmed_by`);--> statement-breakpoint
CREATE TABLE `solidtime_projects` (
	`solidtime_project_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`push` integer DEFAULT 0 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "solidtime_projects_push_check" CHECK(push IN (0, 1)),
	CONSTRAINT "solidtime_projects_name_check" CHECK(length(name) BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE INDEX `solidtime_projects_project_id_idx` ON `solidtime_projects` (`project_id`);--> statement-breakpoint
CREATE INDEX `solidtime_projects_updated_by_idx` ON `solidtime_projects` (`updated_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `solidtime_projects_push_unique` ON `solidtime_projects` (`project_id`) WHERE "solidtime_projects"."push" = 1;--> statement-breakpoint
ALTER TABLE `org_time_settings` ADD `closed_through` text;