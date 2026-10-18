-- LAI-773, D-084 items 9–10, D-087: token usage, phase 3 — admin prices
-- over the dated table (`org_model_prices`), soft budgets and the alerts they
-- raise (`token_budgets`, `token_alerts`, `token_alert_dismissals`), the
-- OpenTelemetry fallback matched to session files by one-way session key
-- (`token_session_days`, `token_telemetry_series`, `token_session_skips`, and
-- a partial index for the rows it adds to `token_usage_days`), and the
-- developer's own plan limit and the arrival rate it reads (`plan_limits`,
-- `token_arrivals`).
--
-- **Additive only**: nine CREATE TABLEs, their indexes and one new index on
-- `token_usage_days`. Nothing is rebuilt, copied, altered or dropped.
-- drizzle-kit's output (via the LAI-778 wrapper), unedited but for this header.
CREATE TABLE `org_model_prices` (
	`org_id` text NOT NULL,
	`model` text NOT NULL,
	`input` real NOT NULL,
	`output` real NOT NULL,
	`cache_write` real NOT NULL,
	`cache_read` real NOT NULL,
	`set_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `model`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "org_model_prices_range_check" CHECK(input >= 0 AND input <= 10000 AND output >= 0 AND output <= 10000 AND cache_write >= 0 AND cache_write <= 10000 AND cache_read >= 0 AND cache_read <= 10000)
);
--> statement-breakpoint
CREATE INDEX `org_model_prices_set_by_idx` ON `org_model_prices` (`set_by`);--> statement-breakpoint
CREATE TABLE `plan_limits` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan_kind` text NOT NULL,
	`limit_window` text NOT NULL,
	`limit_tokens` integer NOT NULL,
	`week_reset_day` integer,
	`week_reset_minute` integer,
	`tz` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_limits_plan_kind_check" CHECK(plan_kind IN ('claude-pro', 'claude-max-5x', 'claude-max-20x', 'other')),
	CONSTRAINT "plan_limits_limit_window_check" CHECK(limit_window IN ('5h', 'day', 'week')),
	CONSTRAINT "plan_limits_limit_check" CHECK(limit_tokens > 0 AND limit_tokens <= 1000000000000),
	CONSTRAINT "plan_limits_reset_check" CHECK((week_reset_day IS NULL OR week_reset_day BETWEEN 0 AND 6) AND (week_reset_minute IS NULL OR week_reset_minute BETWEEN 0 AND 1439) AND ((limit_window = 'week') = (week_reset_day IS NOT NULL AND week_reset_minute IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE `token_alert_dismissals` (
	`alert_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`alert_id`, `user_id`),
	FOREIGN KEY (`alert_id`) REFERENCES `token_alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `token_alert_dismissals_user_idx` ON `token_alert_dismissals` (`user_id`);--> statement-breakpoint
CREATE TABLE `token_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`sprint_id` text,
	`subject_id` text NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`threshold` integer NOT NULL,
	`limit_tokens` integer NOT NULL,
	`tokens` integer NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "token_alerts_kind_check" CHECK(kind IN ('budget', 'runaway')),
	CONSTRAINT "token_alerts_scope_check" CHECK(scope IN ('task', 'sprint', 'project')),
	CONSTRAINT "token_alerts_threshold_check" CHECK((kind = 'budget' AND threshold IN (80, 100)) OR (kind = 'runaway' AND threshold = 95)),
	CONSTRAINT "token_alerts_recipient_check" CHECK((kind = 'runaway') = (user_id IS NOT NULL) AND (kind = 'budget' OR scope = 'task'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_alerts_budget_unique` ON `token_alerts` (`subject_id`,`period`,`threshold`,`limit_tokens`) WHERE kind = 'budget';--> statement-breakpoint
CREATE INDEX `token_alerts_subject_idx` ON `token_alerts` (`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `token_alerts_project_idx` ON `token_alerts` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `token_alerts_user_idx` ON `token_alerts` (`user_id`,`created_at`) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `token_alerts_task_idx` ON `token_alerts` (`task_id`);--> statement-breakpoint
CREATE INDEX `token_alerts_sprint_idx` ON `token_alerts` (`sprint_id`);--> statement-breakpoint
CREATE TABLE `token_arrivals` (
	`user_id` text NOT NULL,
	`bucket_ms` integer NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `bucket_ms`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "token_arrivals_tokens_check" CHECK(tokens >= 0)
);
--> statement-breakpoint
CREATE INDEX `token_arrivals_bucket_idx` ON `token_arrivals` (`bucket_ms`);--> statement-breakpoint
CREATE TABLE `token_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`task_id` text,
	`sprint_id` text,
	`tokens` integer NOT NULL,
	`set_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "token_budgets_scope_check" CHECK(scope IN ('task', 'sprint', 'project')),
	CONSTRAINT "token_budgets_tokens_check" CHECK(tokens > 0 AND tokens <= 1000000000000),
	CONSTRAINT "token_budgets_subject_check" CHECK((scope = 'task') = (task_id IS NOT NULL) AND (scope = 'sprint') = (sprint_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_budgets_task_unique` ON `token_budgets` (`task_id`) WHERE task_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `token_budgets_sprint_unique` ON `token_budgets` (`sprint_id`) WHERE sprint_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `token_budgets_project_unique` ON `token_budgets` (`project_id`) WHERE scope = 'project';--> statement-breakpoint
CREATE INDEX `token_budgets_project_idx` ON `token_budgets` (`project_id`);--> statement-breakpoint
CREATE INDEX `token_budgets_set_by_idx` ON `token_budgets` (`set_by`);--> statement-breakpoint
CREATE TABLE `token_session_days` (
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`collector_id` text DEFAULT '' NOT NULL,
	`day` text NOT NULL,
	`session_key` text NOT NULL,
	`model` text NOT NULL,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cache_write` integer DEFAULT 0 NOT NULL,
	`cache_read` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`, `source`, `collector_id`, `session_key`, `model`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "token_session_days_source_check" CHECK(source IN ('files', 'telemetry')),
	CONSTRAINT "token_session_days_counts_check" CHECK(input >= 0 AND output >= 0 AND cache_write >= 0 AND cache_read >= 0)
);
--> statement-breakpoint
CREATE INDEX `token_session_days_day_idx` ON `token_session_days` (`day`);--> statement-breakpoint
CREATE TABLE `token_session_skips` (
	`user_id` text NOT NULL,
	`session_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `session_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `token_session_skips_created_at_idx` ON `token_session_skips` (`created_at`);--> statement-breakpoint
CREATE TABLE `token_telemetry_series` (
	`user_id` text NOT NULL,
	`series_key` text NOT NULL,
	`last_value` real DEFAULT 0 NOT NULL,
	`last_end_ms` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `series_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `token_telemetry_series_updated_at_idx` ON `token_telemetry_series` (`updated_at`);--> statement-breakpoint
CREATE INDEX `token_usage_days_telemetry_idx` ON `token_usage_days` (`day`,`model`,`input`,`output`,`cache_write`,`cache_read`) WHERE collector_id = 'telemetry';