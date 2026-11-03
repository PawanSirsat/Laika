CREATE TABLE `agent_launcher_reports` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`auto_pickup_work_requests` integer NOT NULL,
	`auto_pickup_handoffs` integer NOT NULL,
	`running` integer NOT NULL,
	`max_concurrent` integer NOT NULL,
	`cli_version` text NOT NULL,
	`started_at` integer,
	`reported_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_launcher_reports_running_check" CHECK(running BETWEEN 0 AND 4),
	CONSTRAINT "agent_launcher_reports_max_concurrent_check" CHECK(max_concurrent BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE `capacity_pings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`agent_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`requested_by_agent_id` text,
	`activity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`answered_at` integer,
	`reply_json` text,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "capacity_pings_answer_check" CHECK((answered_at IS NULL) = (reply_json IS NULL))
);
--> statement-breakpoint
CREATE INDEX `capacity_pings_agent_created_idx` ON `capacity_pings` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `capacity_pings_created_at_idx` ON `capacity_pings` (`created_at`);--> statement-breakpoint
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
	CONSTRAINT "activity_type_check" CHECK(type IN ('org.created', 'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'task.dependency_removed', 'comment.added', 'comment.edited', 'comment.deleted', 'project.created', 'project.updated', 'project.archived', 'member.added', 'member.role_changed', 'member.removed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'meeting_review.discarded', 'unlisted.logged', 'sprint.created', 'sprint.updated', 'sprint.deleted', 'sprint.tasks_changed', 'project.context_updated', 'unlisted.promoted', 'unlisted.dismissed', 'user.deactivated', 'user.reactivated', 'user.signed_out', 'org.ownership_transferred', 'heartbeat.pruned', 'task.stale_flagged', 'invite.expired', 'meeting_review.expired', 'task.agent_selected', 'task.claim_expired', 'task.claim_reclaimed', 'task.checkpoint_saved', 'task.handoff_offered', 'task.handoff_approved', 'task.handoff_accepted', 'task.handoff_declined', 'task.handoff_cancelled', 'task.handoff_expired', 'task.recovered', 'agent.capacity_requested')),
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