-- LAI-501 (D-110 item 2, the My day redesign): a person's note on one of
-- their days, the design's "Note for your manager". One row per person and
-- day; written with Confirm day or alone; read with the day.
--
-- **Additive only**: one CREATE TABLE and its index. Nothing existing is
-- rebuilt, so nothing that references another table is copied or cascaded.
-- drizzle-kit's output (via the LAI-778 wrapper), unedited but for this header.
CREATE TABLE `time_day_notes` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "time_day_notes_note_check" CHECK(length(note) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX `time_day_notes_day_idx` ON `time_day_notes` (`day`);