PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`actor_id` text,
	`actor_kind` text NOT NULL,
	`actor_token_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "activity_actor_kind_check" CHECK(actor_kind IN ('user', 'agent', 'system')),
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'comment.added', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'unlisted.logged')),
	CONSTRAINT "activity_system_actor_check" CHECK((actor_id IS NULL) = (actor_kind = 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_activity`("id", "org_id", "project_id", "task_id", "actor_id", "actor_kind", "actor_token_id", "type", "payload_json", "created_at") SELECT "id", "org_id", "project_id", "task_id", "actor_id", "actor_kind", "actor_token_id", "type", "payload_json", "created_at" FROM `activity`;--> statement-breakpoint
DROP TABLE `activity`;--> statement-breakpoint
ALTER TABLE `__new_activity` RENAME TO `activity`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activity_project_created_at_idx` ON `activity` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_task_created_at_idx` ON `activity` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_org_created_at_idx` ON `activity` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_actor_id_idx` ON `activity` (`actor_id`);--> statement-breakpoint
-- Appended by hand after generation (LAI-010), for the same reason as 0003:
-- SQLite drops a table's triggers with the table, and drizzle-kit implements an
-- `activity` change as DROP + rename. Without this the append-only guarantee of
-- SPEC §4.8 disappears again, silently.
CREATE TRIGGER `activity_is_append_only_no_update`
BEFORE UPDATE ON `activity`
BEGIN
	SELECT RAISE(ABORT, 'activity is append-only: UPDATE is not permitted (SPEC 4.8)');
END;--> statement-breakpoint
CREATE TRIGGER `activity_is_append_only_no_delete`
BEFORE DELETE ON `activity`
BEGIN
	SELECT RAISE(ABORT, 'activity is append-only: DELETE is not permitted (SPEC 4.8)');
END;
