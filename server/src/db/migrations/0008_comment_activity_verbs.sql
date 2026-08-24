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
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'unlisted.logged')),
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
-- Appended by hand (LAI-110). Everything above is drizzle-kit's output.
--
-- Changing `activity`'s CHECK constraint means rebuilding the table, and SQLite
-- drops a table's triggers with the table. drizzle-kit does not know about the
-- append-only triggers, so without this block §4.8's guarantee silently ends
-- here. This is the fourth migration to carry a byte-identical copy of it
-- (0003, 0004, 0005), which is why LAI-118 asks for the guarantee to be moved
-- somewhere a rebuild cannot reach.
--
-- `rowid` is also worth knowing about: the SSE stream (§11.5) and the activity
-- feed use it as their monotonic cursor. The INSERT…SELECT below scans in rowid
-- order and `activity` has no deletions, so the values come out unchanged — but
-- a client holding an id from before a rebuild is handled by the
-- `unknown_last_event_id` gap path either way.
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
