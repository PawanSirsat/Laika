CREATE TABLE `agent_time_days` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`session_key` text NOT NULL,
	`kind` text NOT NULL,
	`seconds` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`, `session_key`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_time_days_kind_check" CHECK(kind IN ('user', 'cli')),
	CONSTRAINT "agent_time_days_seconds_check" CHECK(seconds >= 0)
);
--> statement-breakpoint
CREATE INDEX `agent_time_days_user_session_idx` ON `agent_time_days` (`user_id`,`session_key`);--> statement-breakpoint
CREATE INDEX `agent_time_days_day_idx` ON `agent_time_days` (`day`);--> statement-breakpoint
CREATE TABLE `org_time_settings` (
	`org_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "org_time_settings_mode_check" CHECK(mode IN ('off', 'manual', 'drafts'))
);
--> statement-breakpoint
CREATE TABLE `time_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`collector_id` text DEFAULT '' NOT NULL,
	`day` text NOT NULL,
	`tz` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`minutes` integer NOT NULL,
	`task_key` text,
	`task_id` text,
	`project_id` text,
	`general` integer DEFAULT 0 NOT NULL,
	`signals` text DEFAULT '{}' NOT NULL,
	`note` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`entry_id` text,
	`origin_id` text,
	`origin_task` text,
	`origin_started_at` integer,
	`origin_ended_at` integer,
	`origin_minutes` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "time_drafts_source_check" CHECK(source IN ('collector', 'agent')),
	CONSTRAINT "time_drafts_state_check" CHECK(state IN ('pending', 'confirmed', 'dismissed')),
	CONSTRAINT "time_drafts_minutes_check" CHECK(minutes BETWEEN 1 AND 1440),
	CONSTRAINT "time_drafts_general_check" CHECK(general IN (0, 1)),
	CONSTRAINT "time_drafts_span_check" CHECK((started_at IS NULL AND ended_at IS NULL) OR (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at > started_at)),
	CONSTRAINT "time_drafts_note_check" CHECK(note IS NULL OR length(note) <= 200),
	CONSTRAINT "time_drafts_origin_check" CHECK((origin_id IS NULL AND origin_task IS NULL AND origin_started_at IS NULL AND origin_ended_at IS NULL AND origin_minutes IS NULL) OR (origin_id IS NOT NULL AND origin_started_at IS NOT NULL AND origin_ended_at > origin_started_at AND origin_minutes BETWEEN 1 AND 1440))
);
--> statement-breakpoint
CREATE INDEX `time_drafts_user_day_idx` ON `time_drafts` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `time_drafts_task_id_idx` ON `time_drafts` (`task_id`);--> statement-breakpoint
CREATE INDEX `time_drafts_project_id_idx` ON `time_drafts` (`project_id`);--> statement-breakpoint
CREATE INDEX `time_drafts_entry_id_idx` ON `time_drafts` (`entry_id`);--> statement-breakpoint
CREATE INDEX `time_drafts_day_idx` ON `time_drafts` (`day`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`day` text NOT NULL,
	`tz` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`minutes` integer NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`note` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "time_entries_source_check" CHECK(source IN ('draft', 'manual', 'import')),
	CONSTRAINT "time_entries_minutes_check" CHECK(minutes BETWEEN 1 AND 1440),
	CONSTRAINT "time_entries_revision_check" CHECK(revision >= 1),
	CONSTRAINT "time_entries_note_check" CHECK(note IS NULL OR length(note) <= 280),
	CONSTRAINT "time_entries_span_check" CHECK((started_at IS NULL AND ended_at IS NULL) OR (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at > started_at))
);
--> statement-breakpoint
CREATE INDEX `time_entries_user_day_idx` ON `time_entries` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `time_entries_task_id_idx` ON `time_entries` (`task_id`);--> statement-breakpoint
CREATE INDEX `time_entries_project_day_idx` ON `time_entries` (`project_id`,`day`);--> statement-breakpoint
CREATE INDEX `time_entries_day_idx` ON `time_entries` (`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_source_ref_unique` ON `time_entries` (`user_id`,`source`,`source_ref`) WHERE "time_entries"."source_ref" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `time_entry_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`revision` integer NOT NULL,
	`change` text NOT NULL,
	`changed_by` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`day` text NOT NULL,
	`tz` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`minutes` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_entry_revisions_change_check" CHECK(change IN ('created', 'edited', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entry_revisions_entry_revision_unique` ON `time_entry_revisions` (`entry_id`,`revision`);--> statement-breakpoint
CREATE INDEX `time_entry_revisions_changed_by_idx` ON `time_entry_revisions` (`changed_by`);--> statement-breakpoint
CREATE TABLE `token_session_tasks` (
	`user_id` text NOT NULL,
	`collector_id` text NOT NULL,
	`day` text NOT NULL,
	`session_key` text NOT NULL,
	`task_id` text NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`, `collector_id`, `session_key`, `task_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "token_session_tasks_tokens_check" CHECK(tokens >= 0)
);
--> statement-breakpoint
CREATE INDEX `token_session_tasks_task_id_idx` ON `token_session_tasks` (`task_id`);--> statement-breakpoint
CREATE INDEX `token_session_tasks_day_idx` ON `token_session_tasks` (`day`);--> statement-breakpoint
CREATE TABLE `user_time_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`draft_my_time` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_time_settings_draft_my_time_check" CHECK(draft_my_time IN (0, 1))
);
