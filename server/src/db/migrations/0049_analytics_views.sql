CREATE TABLE `analytics_views` (
	`id` text PRIMARY KEY NOT NULL,
	`viewer_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`day` text,
	`viewed_at` integer NOT NULL,
	FOREIGN KEY (`viewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytics_views_kind_check" CHECK(kind IN ('time', 'local_activity', 'activity', 'usage'))
);
--> statement-breakpoint
CREATE INDEX `analytics_views_subject_idx` ON `analytics_views` (`subject_id`,`viewed_at`,`id`);--> statement-breakpoint
CREATE INDEX `analytics_views_viewer_idx` ON `analytics_views` (`viewer_id`);--> statement-breakpoint
CREATE INDEX `analytics_views_viewed_at_idx` ON `analytics_views` (`viewed_at`);