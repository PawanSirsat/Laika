CREATE TABLE `project_handoff_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`allow_other_owners` integer DEFAULT false NOT NULL,
	`cross_owner_requires_approval` integer DEFAULT true NOT NULL,
	`max_handoffs` integer DEFAULT 3 NOT NULL,
	`offer_ttl_minutes` integer DEFAULT 30 NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_handoff_policies_max_handoffs_check" CHECK(max_handoffs BETWEEN 0 AND 20),
	CONSTRAINT "project_handoff_policies_offer_ttl_check" CHECK(offer_ttl_minutes BETWEEN 5 AND 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_handoff_policies_project_id_idx` ON `project_handoff_policies` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_handoff_policies_updated_by_idx` ON `project_handoff_policies` (`updated_by`);--> statement-breakpoint
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
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'meeting_review.discarded', 'unlisted.logged', 'sprint.created', 'sprint.updated', 'sprint.deleted', 'sprint.tasks_changed', 'project.context_updated', 'unlisted.promoted', 'unlisted.dismissed', 'user.deactivated', 'user.reactivated', 'user.signed_out', 'org.ownership_transferred', 'heartbeat.pruned', 'task.stale_flagged', 'invite.expired', 'meeting_review.expired', 'task.agent_selected', 'task.claim_expired', 'task.claim_reclaimed', 'task.checkpoint_saved', 'task.handoff_offered', 'task.handoff_approved', 'task.handoff_accepted', 'task.handoff_declined', 'task.handoff_cancelled', 'task.handoff_expired', 'task.recovered')),
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
CREATE INDEX `activity_agent_id_idx` ON `activity` (`agent_id`);--> statement-breakpoint
CREATE TABLE `__new_handoff_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`idempotency_key` text,
	`from_session_id` text,
	`from_claim_generation` integer,
	`to_agent_id` text,
	`checkpoint_id` text,
	`checkpoint_commit_sha` text,
	`reason` text,
	`note_hash` text,
	`requires_approval` integer DEFAULT false NOT NULL,
	`approved_by_user_id` text,
	`approved_at` integer,
	`state` text NOT NULL,
	`expires_at` integer,
	`accepted_session_id` text,
	`accepted_claim_id` text,
	`receiver_commit_sha` text,
	`closed_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `task_checkpoints`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`accepted_claim_id`) REFERENCES `task_claims`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "handoff_offers_kind_check" CHECK(kind IN ('work_request', 'handoff', 'recovery')),
	CONSTRAINT "handoff_offers_state_check" CHECK(state IN ('pending_approval', 'open', 'accepted', 'declined', 'cancelled', 'expired')),
	CONSTRAINT "handoff_offers_closed_reason_check" CHECK(closed_reason IS NULL OR closed_reason IN ('withdrawn', 'reclaimed', 'selection_changed', 'task_closed', 'agent_revoked')),
	CONSTRAINT "handoff_offers_approval_check" CHECK((approved_by_user_id IS NULL) = (approved_at IS NULL)),
	CONSTRAINT "handoff_offers_reason_check" CHECK(reason IS NULL OR length(reason) <= 500)
);
--> statement-breakpoint
INSERT INTO `__new_handoff_offers`("id", "task_id", "kind", "to_agent_id", "state", "closed_reason", "created_by_user_id", "created_at", "closed_at") SELECT "id", "task_id", "kind", "to_agent_id", "state", CASE WHEN "state" = 'cancelled' THEN 'selection_changed' ELSE NULL END, "created_by_user_id", "created_at", "closed_at" FROM `handoff_offers`;--> statement-breakpoint
DROP TABLE `handoff_offers`;--> statement-breakpoint
ALTER TABLE `__new_handoff_offers` RENAME TO `handoff_offers`;--> statement-breakpoint
CREATE INDEX `handoff_offers_task_id_idx` ON `handoff_offers` (`task_id`);--> statement-breakpoint
CREATE INDEX `handoff_offers_to_agent_state_idx` ON `handoff_offers` (`to_agent_id`,`state`);--> statement-breakpoint
CREATE INDEX `handoff_offers_created_by_user_id_idx` ON `handoff_offers` (`created_by_user_id`);--> statement-breakpoint
CREATE INDEX `handoff_offers_from_session_id_idx` ON `handoff_offers` (`from_session_id`);--> statement-breakpoint
CREATE INDEX `handoff_offers_checkpoint_id_idx` ON `handoff_offers` (`checkpoint_id`);--> statement-breakpoint
CREATE INDEX `handoff_offers_approved_by_user_id_idx` ON `handoff_offers` (`approved_by_user_id`);--> statement-breakpoint
CREATE INDEX `handoff_offers_accepted_session_id_idx` ON `handoff_offers` (`accepted_session_id`);--> statement-breakpoint
CREATE INDEX `handoff_offers_accepted_claim_id_idx` ON `handoff_offers` (`accepted_claim_id`);--> statement-breakpoint
CREATE INDEX `handoff_offers_state_expires_idx` ON `handoff_offers` (`state`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_offers_idempotency_key_idx` ON `handoff_offers` (`idempotency_key`) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_offers_one_open_work_request` ON `handoff_offers` (`task_id`) WHERE kind = 'work_request' AND state = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_offers_one_live_handoff` ON `handoff_offers` (`task_id`) WHERE kind IN ('handoff', 'recovery') AND state IN ('pending_approval', 'open');--> statement-breakpoint
ALTER TABLE `tasks` ADD `handoff_count` integer DEFAULT 0 NOT NULL;