PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_id` text,
	`body_md` text NOT NULL,
	`created_via` text NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "comments_created_via_check" CHECK(created_via IN ('web', 'mcp', 'api', 'webhook', 'meeting'))
);
--> statement-breakpoint
INSERT INTO `__new_comments`("id", "task_id", "author_id", "body_md", "created_via", "edited_at", "deleted_at", "created_at", "updated_at") SELECT "id", "task_id", "author_id", "body_md", "created_via", "edited_at", "deleted_at", "created_at", "updated_at" FROM `comments`;--> statement-breakpoint
DROP TABLE `comments`;--> statement-breakpoint
ALTER TABLE `__new_comments` RENAME TO `comments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `comments_task_created_at_idx` ON `comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_author_id_idx` ON `comments` (`author_id`);