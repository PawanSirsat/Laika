CREATE TABLE `agent_checkpoint_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`given_by_user_id` text NOT NULL,
	`given_at` integer NOT NULL,
	`withdrawn_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`given_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_checkpoint_consents_agent_id_idx` ON `agent_checkpoint_consents` (`agent_id`);--> statement-breakpoint
CREATE TABLE `checkpoint_ref_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`checkpoint_ref_id` text,
	`repo` text NOT NULL,
	`ref` text NOT NULL,
	`delivery_id` text NOT NULL,
	`before_sha` text NOT NULL,
	`after_sha` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`checkpoint_ref_id`) REFERENCES `checkpoint_refs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoint_ref_transitions_delivery_id_idx` ON `checkpoint_ref_transitions` (`delivery_id`);--> statement-breakpoint
CREATE INDEX `checkpoint_ref_transitions_ref_id_idx` ON `checkpoint_ref_transitions` (`checkpoint_ref_id`);--> statement-breakpoint
CREATE INDEX `checkpoint_ref_transitions_repo_ref_idx` ON `checkpoint_ref_transitions` (`repo`,`ref`);--> statement-breakpoint
CREATE TABLE `checkpoint_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`checkpoint_id` text NOT NULL,
	`revision` integer NOT NULL,
	`ref` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `task_checkpoints`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "checkpoint_refs_state_check" CHECK(state IN ('pending', 'verified', 'ref_deleted', 'uncertain')),
	CONSTRAINT "checkpoint_refs_revision_check" CHECK(revision >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoint_refs_checkpoint_revision_idx` ON `checkpoint_refs` (`checkpoint_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoint_refs_ref_idx` ON `checkpoint_refs` (`ref`);--> statement-breakpoint
CREATE TABLE `task_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`claim_generation` integer NOT NULL,
	`repo` text NOT NULL,
	`branch` text NOT NULL,
	`remote_ref` text NOT NULL,
	`commit_sha` text NOT NULL,
	`manifest` text NOT NULL,
	`summary` text,
	`summary_commit_sha` text,
	`context_revision` integer,
	`created_at` integer NOT NULL,
	`verified_at` integer,
	`verification` text NOT NULL,
	`idempotency_key` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "task_checkpoints_verification_check" CHECK(verification IN ('pending', 'verified', 'ref_deleted', 'uncertain')),
	CONSTRAINT "task_checkpoints_generation_check" CHECK(claim_generation >= 1),
	CONSTRAINT "task_checkpoints_commit_sha_check" CHECK(length(commit_sha) = 40),
	CONSTRAINT "task_checkpoints_summary_check" CHECK((summary IS NULL) = (summary_commit_sha IS NULL))
);
--> statement-breakpoint
CREATE INDEX `task_checkpoints_task_created_idx` ON `task_checkpoints` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_checkpoints_session_id_idx` ON `task_checkpoints` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_checkpoints_idempotency_key_idx` ON `task_checkpoints` (`idempotency_key`);--> statement-breakpoint
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
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'meeting_review.discarded', 'unlisted.logged', 'sprint.created', 'sprint.updated', 'sprint.deleted', 'sprint.tasks_changed', 'project.context_updated', 'unlisted.promoted', 'unlisted.dismissed', 'user.deactivated', 'user.reactivated', 'user.signed_out', 'org.ownership_transferred', 'heartbeat.pruned', 'task.stale_flagged', 'invite.expired', 'meeting_review.expired', 'task.agent_selected', 'task.claim_expired', 'task.claim_reclaimed', 'task.checkpoint_saved')),
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