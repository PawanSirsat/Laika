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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activity_actor_kind_check" CHECK(actor_kind IN ('user', 'agent', 'system')),
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'meeting_review.discarded', 'unlisted.logged', 'sprint.created', 'sprint.updated', 'sprint.deleted', 'sprint.tasks_changed', 'project.context_updated', 'unlisted.promoted', 'unlisted.dismissed', 'user.deactivated', 'user.reactivated', 'heartbeat.pruned', 'task.stale_flagged', 'invite.expired', 'meeting_review.expired')),
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
CREATE TABLE `__new_meeting_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`transcript_hash` text NOT NULL,
	`proposals_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_reviews_status_check" CHECK(status IN ('pending', 'applied', 'expired', 'discarded'))
);
--> statement-breakpoint
INSERT INTO `__new_meeting_reviews`("id", "project_id", "source", "transcript_hash", "proposals_json", "status", "reviewed_by", "reviewed_at", "expires_at", "created_at") SELECT "id", "project_id", "source", "transcript_hash", "proposals_json", "status", "reviewed_by", "reviewed_at", "expires_at", "created_at" FROM `meeting_reviews`;--> statement-breakpoint
DROP TABLE `meeting_reviews`;--> statement-breakpoint
ALTER TABLE `__new_meeting_reviews` RENAME TO `meeting_reviews`;--> statement-breakpoint
CREATE INDEX `meeting_reviews_project_status_idx` ON `meeting_reviews` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_reviews_reviewed_by_idx` ON `meeting_reviews` (`reviewed_by`);