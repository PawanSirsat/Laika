-- LAI-772, D-085: size and forecasts, phase 2 — what a claimant said at claim
-- (an append-only history, `task_claim_estimates`), and the token forecast on
-- every estimate (`task_estimates.tokens_p50` / `tokens_p80`).
--
-- **Additive only**: one CREATE TABLE and its index, two nullable
-- `ALTER TABLE task_estimates ADD` columns. Nothing is rebuilt, copied or
-- dropped. The table's three append-only triggers ride `ensureActivityTriggers`
-- at boot, as `task_estimates`' do. drizzle-kit's output (via the LAI-778
-- wrapper), unedited but for this header. Built as 0038 in parallel with
-- LAI-780's `0038_tasks_external_ref_index`, which reached master first; this
-- one was regenerated on top of it, never renamed.
CREATE TABLE `task_claim_estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`level` text,
	`confidence` text,
	`client_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "task_claim_estimates_level_check" CHECK(level IS NULL OR level IN ('XS', 'S', 'M', 'L', 'XL')),
	CONSTRAINT "task_claim_estimates_confidence_check" CHECK(confidence IS NULL OR confidence IN ('green', 'yellow', 'red')),
	CONSTRAINT "task_claim_estimates_present_check" CHECK(level IS NOT NULL OR confidence IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `task_claim_estimates_task_created_at_idx` ON `task_claim_estimates` (`task_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `task_estimates` ADD `tokens_p50` integer;--> statement-breakpoint
ALTER TABLE `task_estimates` ADD `tokens_p80` integer;