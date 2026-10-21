-- LAI-831 (owner-direct, My day v2): two tables of a person's own time.
-- `time_breaks` holds a gap they waved away as a break (CHIEF's addition D) —
-- never counted as time. `time_undo` holds, for a couple of minutes, what a
-- change to their drafts or entries replaced, so Undo restores it exactly
-- (addition B). SPEC §4 for both is LAI-836.
--
-- **Additive only**: two CREATE TABLEs and their indexes. Nothing existing is
-- rebuilt, so nothing that references another table is copied or cascaded.
-- drizzle-kit's output (via the LAI-778 wrapper), unedited but for this header.
CREATE TABLE `time_breaks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`tz` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "time_breaks_span_check" CHECK(ended_at > started_at)
);
--> statement-breakpoint
CREATE INDEX `time_breaks_user_day_idx` ON `time_breaks` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `time_breaks_day_idx` ON `time_breaks` (`day`);--> statement-breakpoint
CREATE TABLE `time_undo` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject` text NOT NULL,
	`change` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `time_undo_user_subject_idx` ON `time_undo` (`user_id`,`subject`);--> statement-breakpoint
CREATE INDEX `time_undo_created_at_idx` ON `time_undo` (`created_at`);