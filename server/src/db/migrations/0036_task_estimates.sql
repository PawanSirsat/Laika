-- LAI-771, D-085: sizes and build-time forecasts — an append-only history of
-- estimates, and four pointers on `tasks` to the rows in force.
--
-- **Additive only**: one CREATE TABLE and its indexes, four nullable
-- `ALTER TABLE tasks ADD` columns and their indexes. `tasks` is not rebuilt,
-- copied or dropped (D-078 item 7, LAI-493). drizzle-kit's output, unedited
-- but for this header.
--
-- **Numbered 0036 on purpose**: 0035 is reserved for LAI-769 (D-084), built in
-- parallel. Whichever of the two reaches master second regenerates its
-- migration, snapshot and journal entry on top of the other's — never a rename.
CREATE TABLE `task_estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`source` text NOT NULL,
	`level` text,
	`weight` real,
	`build_p50_ms` integer,
	`build_p80_ms` integer,
	`subtasks` integer DEFAULT 0 NOT NULL,
	`inputs_hash` text,
	`model_version` text,
	`factors_json` text DEFAULT '{}' NOT NULL,
	`set_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_estimates_source_check" CHECK(source IN ('model', 'person')),
	CONSTRAINT "task_estimates_level_check" CHECK(level IS NULL OR level IN ('XS', 'S', 'M', 'L', 'XL')),
	CONSTRAINT "task_estimates_level_present_check" CHECK(level IS NOT NULL OR source = 'person'),
	CONSTRAINT "task_estimates_set_by_check" CHECK((source = 'person') = (set_by IS NOT NULL)),
	CONSTRAINT "task_estimates_subtasks_check" CHECK(subtasks >= 0)
);
--> statement-breakpoint
CREATE INDEX `task_estimates_task_created_at_idx` ON `task_estimates` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_estimates_set_by_idx` ON `task_estimates` (`set_by`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `estimate_id` text REFERENCES task_estimates(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `estimate_at_start_id` text REFERENCES task_estimates(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `size_override_id` text REFERENCES task_estimates(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `estimate_hash` text;--> statement-breakpoint
CREATE INDEX `tasks_estimate_id_idx` ON `tasks` (`estimate_id`);--> statement-breakpoint
CREATE INDEX `tasks_estimate_at_start_id_idx` ON `tasks` (`estimate_at_start_id`);--> statement-breakpoint
CREATE INDEX `tasks_size_override_id_idx` ON `tasks` (`size_override_id`);