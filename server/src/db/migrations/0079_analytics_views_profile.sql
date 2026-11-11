PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_analytics_views` (
	`id` text PRIMARY KEY NOT NULL,
	`viewer_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`day` text,
	`viewed_at` integer NOT NULL,
	FOREIGN KEY (`viewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytics_views_kind_check" CHECK(kind IN ('time', 'local_activity', 'activity', 'usage', 'developer_setup', 'profile'))
);
--> statement-breakpoint
INSERT INTO `__new_analytics_views`("id", "viewer_id", "subject_id", "kind", "day", "viewed_at") SELECT "id", "viewer_id", "subject_id", "kind", "day", "viewed_at" FROM `analytics_views`;--> statement-breakpoint
DROP TABLE `analytics_views`;--> statement-breakpoint
ALTER TABLE `__new_analytics_views` RENAME TO `analytics_views`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `analytics_views_subject_idx` ON `analytics_views` (`subject_id`,`viewed_at`,`id`);--> statement-breakpoint
CREATE INDEX `analytics_views_viewer_idx` ON `analytics_views` (`viewer_id`);--> statement-breakpoint
CREATE INDEX `analytics_views_viewed_at_idx` ON `analytics_views` (`viewed_at`);