CREATE TABLE `user_availability` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text,
	`hours_per_week` integer,
	`note` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`work_days` text DEFAULT '[]' NOT NULL,
	`work_start` text,
	`work_end` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_availability_status_check" CHECK(status IS NULL OR status IN ('open', 'capacity')),
	CONSTRAINT "user_availability_hours_check" CHECK(hours_per_week IS NULL OR hours_per_week BETWEEN 1 AND 80),
	CONSTRAINT "user_availability_note_check" CHECK(note IS NULL OR length(note) BETWEEN 1 AND 140),
	CONSTRAINT "user_availability_work_hours_check" CHECK((work_start IS NULL AND work_end IS NULL) OR (work_start GLOB '[0-2][0-9]:[0-5][0-9]' AND work_end GLOB '[0-2][0-9]:[0-5][0-9]' AND work_end > work_start))
);
--> statement-breakpoint
CREATE TABLE `user_away_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`from_day` text NOT NULL,
	`to_day` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_away_periods_range_check" CHECK(to_day >= from_day)
);
--> statement-breakpoint
CREATE INDEX `user_away_periods_user_to_idx` ON `user_away_periods` (`user_id`,`to_day`);--> statement-breakpoint
CREATE INDEX `user_away_periods_to_day_idx` ON `user_away_periods` (`to_day`);