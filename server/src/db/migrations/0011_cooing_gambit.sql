CREATE TABLE `comment_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_mentions_comment_user_unique` ON `comment_mentions` (`comment_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `comment_mentions_user_id_idx` ON `comment_mentions` (`user_id`);--> statement-breakpoint
CREATE TABLE `task_watchers` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`watching` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_watchers_task_user_unique` ON `task_watchers` (`task_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `task_watchers_user_id_idx` ON `task_watchers` (`user_id`);