CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`ical_uid` text,
	`entry_id` text NOT NULL,
	`entry_revision_synced` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_events_revision_check" CHECK(entry_revision_synced >= 1),
	CONSTRAINT "calendar_events_event_id_check" CHECK(length(event_id) BETWEEN 1 AND 512)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_user_event_unique` ON `calendar_events` (`user_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_entry_id_unique` ON `calendar_events` (`entry_id`);--> statement-breakpoint
CREATE TABLE `org_calendar_source` (
	`org_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`secret_enc` text NOT NULL,
	`secret_last4` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`rules_json` text DEFAULT '[]' NOT NULL,
	`configured_by` text,
	`configured_at` integer NOT NULL,
	`last_test_at` integer,
	`last_test_roles_json` text,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error_code` text,
	`last_error` text,
	`last_result_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`configured_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "org_calendar_source_enabled_check" CHECK(enabled IN (0, 1)),
	CONSTRAINT "org_calendar_source_last_error_code_check" CHECK(last_error_code IS NULL OR last_error_code IN ('credentials_rejected', 'not_granted', 'unreachable', 'bad_answer')),
	CONSTRAINT "org_calendar_source_test_check" CHECK((last_test_at IS NULL) = (last_test_roles_json IS NULL)),
	CONSTRAINT "org_calendar_source_tenant_check" CHECK(length(tenant_id) BETWEEN 1 AND 100),
	CONSTRAINT "org_calendar_source_client_check" CHECK(length(client_id) = 36)
);
--> statement-breakpoint
CREATE INDEX `org_calendar_source_configured_by_idx` ON `org_calendar_source` (`configured_by`);--> statement-breakpoint
-- Added by hand after generation (LAI-1316).
--
-- `time_entry_revisions_is_append_only_no_delete` reads `time_entries` in its
-- WHEN clause, and SQLite refuses the RENAME below while any trigger names a
-- table that is not there ("error in trigger …: no such table"). It is dropped
-- for the rebuild; `ensureActivityTriggers` creates it again straight after
-- the migrations, as it checks it on every boot, and the two triggers on
-- `time_entries` itself go with the old table and come back the same way.
DROP TRIGGER IF EXISTS `time_entry_revisions_is_append_only_no_delete`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_time_entries` (
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
	`kind` text,
	`title` text,
	`description` text,
	`folder` text,
	`branch` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "time_entries_source_check" CHECK(source IN ('draft', 'manual', 'import', 'calendar')),
	CONSTRAINT "time_entries_minutes_check" CHECK(minutes BETWEEN 1 AND 1440),
	CONSTRAINT "time_entries_revision_check" CHECK(revision >= 1),
	CONSTRAINT "time_entries_note_check" CHECK(note IS NULL OR length(note) <= 280),
	CONSTRAINT "time_entries_span_check" CHECK((started_at IS NULL AND ended_at IS NULL) OR (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at > started_at))
);
--> statement-breakpoint
INSERT INTO `__new_time_entries`("id", "user_id", "task_id", "project_id", "day", "tz", "started_at", "ended_at", "minutes", "source", "source_ref", "note", "kind", "title", "description", "folder", "branch", "revision", "deleted_at", "created_at", "updated_at") SELECT "id", "user_id", "task_id", "project_id", "day", "tz", "started_at", "ended_at", "minutes", "source", "source_ref", "note", "kind", "title", "description", "folder", "branch", "revision", "deleted_at", "created_at", "updated_at" FROM `time_entries`;--> statement-breakpoint
DROP TABLE `time_entries`;--> statement-breakpoint
ALTER TABLE `__new_time_entries` RENAME TO `time_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `time_entries_user_day_idx` ON `time_entries` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `time_entries_task_id_idx` ON `time_entries` (`task_id`);--> statement-breakpoint
CREATE INDEX `time_entries_project_day_idx` ON `time_entries` (`project_id`,`day`);--> statement-breakpoint
CREATE INDEX `time_entries_day_idx` ON `time_entries` (`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_source_ref_unique` ON `time_entries` (`user_id`,`source`,`source_ref`) WHERE "time_entries"."source_ref" IS NOT NULL;