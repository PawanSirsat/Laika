-- LAI-500 (D-110 item 1, the My day redesign): a person's running timer, one
-- row while it runs. Stopping writes an ordinary `time_entries` row and
-- deletes this one; `time_entries` itself is untouched.
--
-- **Additive only**: one CREATE TABLE. Nothing existing is rebuilt, so nothing
-- that references another table is copied or cascaded. drizzle-kit's output
-- (via the LAI-778 wrapper), unedited but for this header.
CREATE TABLE `time_timers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`kind` text,
	`title` text,
	`tz` text NOT NULL,
	`started_at` integer NOT NULL,
	`resumed_at` integer NOT NULL,
	`paused_at` integer,
	`accumulated_ms` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "time_timers_kind_check" CHECK(kind IS NULL OR kind IN ('meeting', 'call', 'review', 'planning', 'learning', 'support', 'admin', 'other')),
	CONSTRAINT "time_timers_title_check" CHECK(title IS NULL OR length(title) <= 120),
	CONSTRAINT "time_timers_accumulated_check" CHECK(accumulated_ms >= 0),
	CONSTRAINT "time_timers_segment_check" CHECK(resumed_at >= started_at)
);
