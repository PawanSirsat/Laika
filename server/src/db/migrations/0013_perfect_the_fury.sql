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
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'unlisted.logged', 'sprint.created', 'sprint.updated', 'sprint.deleted', 'sprint.tasks_changed', 'project.context_updated', 'unlisted.promoted', 'unlisted.dismissed', 'user.deactivated', 'user.reactivated')),
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
CREATE INDEX `activity_actor_id_idx` ON `activity` (`actor_id`);