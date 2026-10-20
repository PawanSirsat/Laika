-- LAI-815, D-091: an `automated` flag on `token_usage_days` — tokens an
-- automated session spent (an orchestrator's sub-agent, CI,
-- `LAIKA_ACTIVITY_SKIP`), counted for the organisation, the space and the
-- task and never in a per-person figure. Every row already held is a
-- person's, so the column defaults to false.
--
-- **Additive only**: one ADD COLUMN, and the day and project indexes
-- re-created with the flag as their last column so `by_developer` stays a
-- covering read. The table is not rebuilt, so nothing that references it, and
-- nothing it references, is copied or cascaded.
-- drizzle-kit's output (via the LAI-778 wrapper), unedited but for this header.
DROP INDEX `token_usage_days_day_idx`;--> statement-breakpoint
DROP INDEX `token_usage_days_project_day_idx`;--> statement-breakpoint
ALTER TABLE `token_usage_days` ADD `automated` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `token_usage_days_day_idx` ON `token_usage_days` (`day`,`agent`,`model`,`user_id`,`task_id`,`input`,`output`,`cache_write`,`cache_read`,`automated`);--> statement-breakpoint
CREATE INDEX `token_usage_days_project_day_idx` ON `token_usage_days` (`project_id`,`day`,`agent`,`model`,`user_id`,`task_id`,`input`,`output`,`cache_write`,`cache_read`,`automated`) WHERE project_id IS NOT NULL;