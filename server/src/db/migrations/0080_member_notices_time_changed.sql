PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_member_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`subject` text,
	`message` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "member_notices_kind_check" CHECK(kind IN ('added_to_space', 'tool_revoked', 'device_unpaired', 'token_revoked', 'time_changed')),
	CONSTRAINT "member_notices_subject_check" CHECK(subject IS NULL OR length(subject) <= 120),
	CONSTRAINT "member_notices_message_check" CHECK(message IS NULL OR length(message) <= 500)
);
--> statement-breakpoint
INSERT INTO `__new_member_notices`("id", "user_id", "actor_user_id", "kind", "project_id", "task_id", "subject", "message", "created_at", "read_at") SELECT "id", "user_id", "actor_user_id", "kind", "project_id", "task_id", "subject", "message", "created_at", "read_at" FROM `member_notices`;--> statement-breakpoint
DROP TABLE `member_notices`;--> statement-breakpoint
ALTER TABLE `__new_member_notices` RENAME TO `member_notices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `member_notices_user_idx` ON `member_notices` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `member_notices_created_at_idx` ON `member_notices` (`created_at`);