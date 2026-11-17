CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`comment_id` text,
	`uploaded_by` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_key` text NOT NULL,
	`state` text NOT NULL,
	`inline` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	`deleted_at` integer,
	`deleted_by` text,
	`purged_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "attachments_state_check" CHECK(state IN ('pending', 'ready')),
	CONSTRAINT "attachments_inline_check" CHECK(inline IN (0, 1)),
	CONSTRAINT "attachments_filename_check" CHECK(length(filename) BETWEEN 1 AND 255),
	CONSTRAINT "attachments_content_type_check" CHECK(length(content_type) BETWEEN 1 AND 127),
	CONSTRAINT "attachments_size_check" CHECK(size_bytes >= 1),
	CONSTRAINT "attachments_ready_check" CHECK((state = 'ready') = (ready_at IS NOT NULL)),
	CONSTRAINT "attachments_purged_check" CHECK(purged_at IS NULL OR deleted_at IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_storage_key_unique` ON `attachments` (`storage_key`);--> statement-breakpoint
CREATE INDEX `attachments_task_id_idx` ON `attachments` (`task_id`);--> statement-breakpoint
CREATE INDEX `attachments_comment_id_idx` ON `attachments` (`comment_id`);--> statement-breakpoint
CREATE INDEX `attachments_state_created_at_idx` ON `attachments` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `attachments_project_id_idx` ON `attachments` (`project_id`);--> statement-breakpoint
CREATE INDEX `attachments_uploaded_by_idx` ON `attachments` (`uploaded_by`);--> statement-breakpoint
CREATE INDEX `attachments_deleted_by_idx` ON `attachments` (`deleted_by`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`actor_id` text,
	`actor_kind` text NOT NULL,
	`actor_token_id` text,
	`agent_id` text,
	`agent_session_id` text,
	`session_harness` text,
	`session_harness_version` text,
	`session_model` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activity_actor_kind_check" CHECK(actor_kind IN ('user', 'agent', 'system')),
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'meeting_review.discarded', 'unlisted.logged', 'sprint.created', 'sprint.updated', 'sprint.deleted', 'sprint.tasks_changed', 'project.context_updated', 'unlisted.promoted', 'unlisted.dismissed', 'user.deactivated', 'user.reactivated', 'user.signed_out', 'org.ownership_transferred', 'heartbeat.pruned', 'task.stale_flagged', 'invite.expired', 'meeting_review.expired', 'task.agent_selected', 'task.claim_expired', 'task.claim_reclaimed', 'task.checkpoint_saved', 'task.handoff_offered', 'task.handoff_approved', 'task.handoff_accepted', 'task.handoff_declined', 'task.handoff_cancelled', 'task.handoff_expired', 'task.recovered', 'agent.capacity_requested', 'attachment.added', 'attachment.removed')),
	CONSTRAINT "activity_system_actor_check" CHECK((actor_id IS NULL) = (actor_kind = 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_activity`("id", "org_id", "project_id", "task_id", "actor_id", "actor_kind", "actor_token_id", "agent_id", "agent_session_id", "session_harness", "session_harness_version", "session_model", "type", "payload_json", "created_at") SELECT "id", "org_id", "project_id", "task_id", "actor_id", "actor_kind", "actor_token_id", "agent_id", "agent_session_id", "session_harness", "session_harness_version", "session_model", "type", "payload_json", "created_at" FROM `activity`;--> statement-breakpoint
DROP TABLE `activity`;--> statement-breakpoint
ALTER TABLE `__new_activity` RENAME TO `activity`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activity_project_created_at_idx` ON `activity` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_task_created_at_idx` ON `activity` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_org_created_at_idx` ON `activity` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_actor_id_idx` ON `activity` (`actor_id`);--> statement-breakpoint
CREATE INDEX `activity_agent_id_idx` ON `activity` (`agent_id`);