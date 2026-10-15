-- LAI-751, D-079: the activity heatmap's three tables, the two consent
-- switches and the scope, and the board rollup filled from the log.
--
-- **Additive only.** drizzle-kit generated rebuilds of `orgs` and `users`
-- here, because a table-level CHECK is a new constraint to it. Hand-edited to
-- `ALTER TABLE … ADD` with each CHECK as a column constraint, as 0029 did for
-- `profile_kind`: SQLite tests it against every existing row as the column is
-- added, and `users` — which most of the schema references — is never dropped
-- and copied. The snapshot beside this file is drizzle-kit's, unedited.
CREATE TABLE `board_activity_days` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`by_self` integer DEFAULT 0 NOT NULL,
	`by_agents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `local_activity_days` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`collector_id` text NOT NULL,
	`prompts` integer DEFAULT 0 NOT NULL,
	`prompts_by_agent` text DEFAULT '{}' NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`commits_local` integer DEFAULT 0 NOT NULL,
	`tz` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`, `collector_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `local_activity_days_day_idx` ON `local_activity_days` (`day`);--> statement-breakpoint
CREATE TABLE `pushed_commit_keys` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pushed_commit_keys_user_day_idx` ON `pushed_commit_keys` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `pushed_commit_keys_day_idx` ON `pushed_commit_keys` (`day`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `developer_insights` integer DEFAULT 0 NOT NULL CONSTRAINT "orgs_developer_insights_check" CHECK(developer_insights IN (0, 1));--> statement-breakpoint
ALTER TABLE `users` ADD `share_local_activity` integer DEFAULT 0 NOT NULL CONSTRAINT "users_share_local_activity_check" CHECK(share_local_activity IN (0, 1));--> statement-breakpoint
ALTER TABLE `users` ADD `local_activity_scope` text DEFAULT 'agent-repos' NOT NULL CONSTRAINT "users_local_activity_scope_check" CHECK(local_activity_scope IN ('agent-repos', 'laika-repos'));--> statement-breakpoint
-- The board rollup from the log as it stands, in one set-based statement
-- (§4.22). From here on `appendActivity` adds to it in the same transaction as
-- each row it writes, so the two never disagree. UTC days: Laika has no
-- organisation time zone. System rows have no person and are not counted.
INSERT INTO `board_activity_days` (`user_id`, `day`, `by_self`, `by_agents`)
SELECT `actor_id`,
	date(`created_at` / 1000, 'unixepoch'),
	sum(`actor_kind` = 'user'),
	sum(`actor_kind` = 'agent')
FROM `activity`
WHERE `actor_id` IS NOT NULL AND `actor_kind` IN ('user', 'agent')
GROUP BY `actor_id`, date(`created_at` / 1000, 'unixepoch');
