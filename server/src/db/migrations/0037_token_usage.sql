-- LAI-769, D-084: agents' token usage per day, as each machine's collector
-- last reported it — per person, machine, day, agent, model and (when known)
-- task, the four counts and nothing else.
--
-- **Additive only**: one CREATE TABLE and its indexes; no existing table is
-- altered, rebuilt or copied. drizzle-kit's output, unedited but for this
-- header.
CREATE TABLE `token_usage_days` (
	`user_id` text NOT NULL,
	`collector_id` text NOT NULL,
	`day` text NOT NULL,
	`agent` text NOT NULL,
	`model` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cache_write` integer DEFAULT 0 NOT NULL,
	`cache_read` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "token_usage_days_counts_check" CHECK(input >= 0 AND output >= 0 AND cache_write >= 0 AND cache_read >= 0)
);
--> statement-breakpoint
CREATE INDEX `token_usage_days_user_day_idx` ON `token_usage_days` (`user_id`,`day`,`collector_id`);--> statement-breakpoint
CREATE INDEX `token_usage_days_day_idx` ON `token_usage_days` (`day`,`agent`,`model`,`user_id`,`task_id`,`input`,`output`,`cache_write`,`cache_read`);--> statement-breakpoint
CREATE INDEX `token_usage_days_project_day_idx` ON `token_usage_days` (`project_id`,`day`,`agent`,`model`,`user_id`,`task_id`,`input`,`output`,`cache_write`,`cache_read`) WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `token_usage_days_task_idx` ON `token_usage_days` (`task_id`,`day`) WHERE task_id IS NOT NULL;