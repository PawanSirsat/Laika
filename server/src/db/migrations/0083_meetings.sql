CREATE TABLE `meeting_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`invited` integer DEFAULT 0 NOT NULL,
	`joined_at` integer,
	`left_at` integer,
	`minutes` integer DEFAULT 0 NOT NULL,
	`time_entry_id` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_attendance_invited_check" CHECK(invited IN (0, 1)),
	CONSTRAINT "meeting_attendance_minutes_check" CHECK(minutes BETWEEN 0 AND 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_attendance_meeting_email_unique` ON `meeting_attendance` (`meeting_id`,`email`);--> statement-breakpoint
CREATE INDEX `meeting_attendance_user_id_idx` ON `meeting_attendance` (`user_id`);--> statement-breakpoint
CREATE INDEX `meeting_attendance_email_idx` ON `meeting_attendance` (`email`);--> statement-breakpoint
CREATE INDEX `meeting_attendance_time_entry_id_idx` ON `meeting_attendance` (`time_entry_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`graph_event_id` text NOT NULL,
	`online_meeting_id` text,
	`title` text NOT NULL,
	`organiser_email` text NOT NULL,
	`join_url` text,
	`scheduled_start` integer NOT NULL,
	`scheduled_end` integer NOT NULL,
	`actual_start` integer,
	`actual_end` integer,
	`has_transcript` integer DEFAULT 0 NOT NULL,
	`project_id` text,
	`synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meetings_has_transcript_check" CHECK(has_transcript IN (0, 1)),
	CONSTRAINT "meetings_title_check" CHECK(length(title) <= 255),
	CONSTRAINT "meetings_scheduled_check" CHECK(scheduled_end >= scheduled_start)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_graph_event_id_unique` ON `meetings` (`graph_event_id`);--> statement-breakpoint
CREATE INDEX `meetings_scheduled_start_idx` ON `meetings` (`scheduled_start`);--> statement-breakpoint
CREATE INDEX `meetings_org_id_idx` ON `meetings` (`org_id`);--> statement-breakpoint
CREATE INDEX `meetings_project_id_idx` ON `meetings` (`project_id`);