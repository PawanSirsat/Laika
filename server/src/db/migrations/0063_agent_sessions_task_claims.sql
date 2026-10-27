CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`token_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_heartbeat_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	`client_version` text,
	`model` text,
	`context_revision_seen` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_sessions_end_reason_check" CHECK(end_reason IS NULL OR end_reason IN ('ended', 'agent_revoked')),
	CONSTRAINT "agent_sessions_end_check" CHECK((ended_at IS NULL) = (end_reason IS NULL))
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_id_idx` ON `agent_sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_token_id_idx` ON `agent_sessions` (`token_id`);--> statement-breakpoint
CREATE TABLE `task_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`generation` integer NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_claims_state_check" CHECK(state IN ('active', 'paused', 'released', 'expired', 'transferred')),
	CONSTRAINT "task_claims_generation_check" CHECK(generation >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_claims_task_generation_idx` ON `task_claims` (`task_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_claims_one_live_per_task` ON `task_claims` (`task_id`) WHERE state IN ('active', 'paused');--> statement-breakpoint
CREATE INDEX `task_claims_session_id_idx` ON `task_claims` (`session_id`);--> statement-breakpoint
CREATE INDEX `task_claims_agent_id_idx` ON `task_claims` (`agent_id`);--> statement-breakpoint
CREATE INDEX `task_claims_state_lease_idx` ON `task_claims` (`state`,`lease_expires_at`);--> statement-breakpoint
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
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activity_actor_kind_check" CHECK(actor_kind IN ('user', 'agent', 'system')),
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'meeting_review.discarded', 'unlisted.logged', 'sprint.created', 'sprint.updated', 'sprint.deleted', 'sprint.tasks_changed', 'project.context_updated', 'unlisted.promoted', 'unlisted.dismissed', 'user.deactivated', 'user.reactivated', 'user.signed_out', 'org.ownership_transferred', 'heartbeat.pruned', 'task.stale_flagged', 'invite.expired', 'meeting_review.expired', 'task.agent_selected', 'task.claim_expired', 'task.claim_reclaimed')),
	CONSTRAINT "activity_system_actor_check" CHECK((actor_id IS NULL) = (actor_kind = 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_activity`("id", "org_id", "project_id", "task_id", "actor_id", "actor_kind", "actor_token_id", "agent_id", "type", "payload_json", "created_at") SELECT "id", "org_id", "project_id", "task_id", "actor_id", "actor_kind", "actor_token_id", "agent_id", "type", "payload_json", "created_at" FROM `activity`;--> statement-breakpoint
DROP TABLE `activity`;--> statement-breakpoint
ALTER TABLE `__new_activity` RENAME TO `activity`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activity_project_created_at_idx` ON `activity` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_task_created_at_idx` ON `activity` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_org_created_at_idx` ON `activity` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_actor_id_idx` ON `activity` (`actor_id`);--> statement-breakpoint
CREATE INDEX `activity_agent_id_idx` ON `activity` (`agent_id`);