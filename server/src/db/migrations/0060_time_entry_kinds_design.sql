-- LAI-516 (the owner's My day design, amending D-108): a typed entry's kind
-- is one of the design's eight — work, meeting, thinking, research, pairing,
-- review, support, admin. The first eight are mapped, every row kept:
-- call → meeting, planning → thinking, learning → research, other → work;
-- meeting, review, support and admin stay. `time_entries.kind` and
-- `time_entry_revisions.kind` carry no CHECK (the API validates), so they
-- are updated in place; `time_timers.kind` does, so drizzle-kit rebuilds that
-- table, and the old table's CHECK refuses the new names, so the copy into
-- the new table does the mapping (the CASE in its SELECT) rather than an
-- UPDATE before it. `time_entry_revisions` is append-only (§4.49, a trigger
-- refuses UPDATE): the trigger is dropped for the one statement that renames
-- the vocabulary, and `ensureActivityTriggers` puts it back after every
-- migration pass, as it does for every append-only table. drizzle-kit's
-- output (via the LAI-778 wrapper), unedited but for this header, the DROP
-- TRIGGER, the two UPDATEs and the CASE in the copy.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE `time_entries` SET `kind` = CASE `kind` WHEN 'call' THEN 'meeting' WHEN 'planning' THEN 'thinking' WHEN 'learning' THEN 'research' WHEN 'other' THEN 'work' ELSE `kind` END WHERE `kind` IN ('call', 'planning', 'learning', 'other');--> statement-breakpoint
DROP TRIGGER IF EXISTS `time_entry_revisions_is_append_only_no_update`;--> statement-breakpoint
UPDATE `time_entry_revisions` SET `kind` = CASE `kind` WHEN 'call' THEN 'meeting' WHEN 'planning' THEN 'thinking' WHEN 'learning' THEN 'research' WHEN 'other' THEN 'work' ELSE `kind` END WHERE `kind` IN ('call', 'planning', 'learning', 'other');--> statement-breakpoint
CREATE TABLE `__new_time_timers` (
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
	CONSTRAINT "time_timers_kind_check" CHECK(kind IS NULL OR kind IN ('work', 'meeting', 'thinking', 'research', 'pairing', 'review', 'support', 'admin')),
	CONSTRAINT "time_timers_title_check" CHECK(title IS NULL OR length(title) <= 120),
	CONSTRAINT "time_timers_accumulated_check" CHECK(accumulated_ms >= 0),
	CONSTRAINT "time_timers_segment_check" CHECK(resumed_at >= started_at)
);
--> statement-breakpoint
INSERT INTO `__new_time_timers`("user_id", "task_id", "kind", "title", "tz", "started_at", "resumed_at", "paused_at", "accumulated_ms", "updated_at") SELECT "user_id", "task_id", CASE "kind" WHEN 'call' THEN 'meeting' WHEN 'planning' THEN 'thinking' WHEN 'learning' THEN 'research' WHEN 'other' THEN 'work' ELSE "kind" END, "title", "tz", "started_at", "resumed_at", "paused_at", "accumulated_ms", "updated_at" FROM `time_timers`;--> statement-breakpoint
DROP TABLE `time_timers`;--> statement-breakpoint
ALTER TABLE `__new_time_timers` RENAME TO `time_timers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;