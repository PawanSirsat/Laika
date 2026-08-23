CREATE TABLE `activity` (
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
	CONSTRAINT "activity_actor_kind_check" CHECK(actor_kind IN ('user', 'agent')),
	CONSTRAINT "activity_type_check" CHECK(type IN ('task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.dependency_added', 'comment.added', 'project.created', 'member.added', 'member.role_changed', 'token.created', 'token.revoked', 'heartbeat.session', 'webhook.commit', 'webhook.received', 'meeting.applied', 'unlisted.logged'))
);
--> statement-breakpoint
CREATE INDEX `activity_project_created_at_idx` ON `activity` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_task_created_at_idx` ON `activity` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_org_created_at_idx` ON `activity` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_actor_id_idx` ON `activity` (`actor_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body_md` text NOT NULL,
	`created_via` text NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "comments_created_via_check" CHECK(created_via IN ('web', 'mcp', 'api', 'webhook', 'meeting'))
);
--> statement-breakpoint
CREATE INDEX `comments_task_created_at_idx` ON `comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_author_id_idx` ON `comments` (`author_id`);--> statement-breakpoint
CREATE TABLE `heartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_id` text,
	`repo` text NOT NULL,
	`branch` text NOT NULL,
	`matched_task_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `heartbeats_user_created_at_idx` ON `heartbeats` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `heartbeats_matched_task_id_idx` ON `heartbeats` (`matched_task_id`);--> statement-breakpoint
CREATE INDEX `heartbeats_token_id_idx` ON `heartbeats` (`token_id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text,
	`org_role` text NOT NULL,
	`project_id` text,
	`project_role` text,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invites_org_role_check" CHECK(org_role IN ('owner', 'admin', 'member', 'viewer')),
	CONSTRAINT "invites_project_role_check" CHECK(project_role IS NULL OR project_role IN ('lead', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_org_id_idx` ON `invites` (`org_id`);--> statement-breakpoint
CREATE INDEX `invites_email_idx` ON `invites` (`email`);--> statement-breakpoint
CREATE INDEX `invites_project_id_idx` ON `invites` (`project_id`);--> statement-breakpoint
CREATE INDEX `invites_created_by_idx` ON `invites` (`created_by`);--> statement-breakpoint
CREATE INDEX `invites_accepted_by_idx` ON `invites` (`accepted_by`);--> statement-breakpoint
CREATE TABLE `meeting_reviews` (
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
	CONSTRAINT "meeting_reviews_status_check" CHECK(status IN ('pending', 'applied', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `meeting_reviews_project_status_idx` ON `meeting_reviews` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_reviews_reviewed_by_idx` ON `meeting_reviews` (`reviewed_by`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`invite_only` integer DEFAULT 1 NOT NULL,
	`ai_provider` text,
	`ai_base_url` text,
	`ai_api_key_enc` text,
	`smtp_json_enc` text,
	`github_webhook_secret_enc` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "orgs_ai_provider_check" CHECK(ai_provider IS NULL OR ai_provider IN ('anthropic', 'openai_compatible')),
	CONSTRAINT "orgs_invite_only_check" CHECK(invite_only IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `project_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_memberships_role_check" CHECK(role IN ('lead', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_memberships_project_user_unique` ON `project_memberships` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_memberships_user_id_idx` ON `project_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`prefix` text NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`context_md` text DEFAULT '' NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "projects_visibility_check" CHECK(visibility IN ('public', 'private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_org_prefix_unique` ON `projects` (`org_id`,`prefix`);--> statement-breakpoint
CREATE INDEX `projects_org_id_idx` ON `projects` (`org_id`);--> statement-breakpoint
CREATE TABLE `sprints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`goal` text,
	`starts_on` integer NOT NULL,
	`ends_on` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sprints_status_check" CHECK(status IN ('planned', 'active', 'completed')),
	CONSTRAINT "sprints_dates_check" CHECK(ends_on > starts_on)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sprints_project_name_unique` ON `sprints` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `sprints_project_starts_on_idx` ON `sprints` (`project_id`,`starts_on`);--> statement-breakpoint
CREATE INDEX `sprints_project_status_idx` ON `sprints` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_dependencies_no_self_check" CHECK(task_id <> depends_on_task_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_dependencies_pair_unique` ON `task_dependencies` (`task_id`,`depends_on_task_id`);--> statement-breakpoint
CREATE INDEX `task_dependencies_depends_on_idx` ON `task_dependencies` (`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'p2' NOT NULL,
	`assignee_id` text,
	`sprint_id` text,
	`created_by` text NOT NULL,
	`created_via` text NOT NULL,
	`discovered_from` text,
	`branch` text,
	`external_ref` text,
	`stale_flagged_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tasks_status_check" CHECK(status IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
	CONSTRAINT "tasks_priority_check" CHECK(priority IN ('p1', 'p2', 'p3')),
	CONSTRAINT "tasks_created_via_check" CHECK(created_via IN ('web', 'mcp', 'api', 'webhook', 'meeting')),
	CONSTRAINT "tasks_number_check" CHECK(number > 0),
	CONSTRAINT "tasks_discovered_from_check" CHECK(discovered_from IS NULL OR discovered_from <> id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_number_unique` ON `tasks` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `tasks_project_status_idx` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_status_idx` ON `tasks` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_updated_at_idx` ON `tasks` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tasks_sprint_id_idx` ON `tasks` (`sprint_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_by_idx` ON `tasks` (`created_by`);--> statement-breakpoint
CREATE INDEX `tasks_discovered_from_idx` ON `tasks` (`discovered_from`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text NOT NULL,
	`project_ids_json` text,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tokens_scope_check" CHECK(scope IN ('full', 'read_only'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_token_hash_unique` ON `tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `tokens_user_id_idx` ON `tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `unlisted_work` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_id` text,
	`repo` text NOT NULL,
	`note` text NOT NULL,
	`promoted_task_id` text,
	`dismissed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promoted_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `unlisted_work_user_created_at_idx` ON `unlisted_work` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `unlisted_work_promoted_task_id_idx` ON `unlisted_work` (`promoted_task_id`);--> statement-breakpoint
CREATE INDEX `unlisted_work_token_id_idx` ON `unlisted_work` (`token_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`org_role` text NOT NULL,
	`avatar_color` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_org_role_check" CHECK(org_role IN ('owner', 'admin', 'member', 'viewer')),
	CONSTRAINT "users_is_active_check" CHECK(is_active IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
-- Appended by hand after generation (LAI-003).
--
-- SPEC §4.8: activity is append-only, "no updates, no deletes, ever". The
-- repository layer in src/db/activity.ts offers no mutation path, but absence of
-- a method is not enforcement — it protects only callers who use the repository.
-- These triggers make the guarantee hold for anything that reaches the database,
-- including a future migration script or a console session.
--
-- drizzle-kit will not regenerate these; migrations are forward-only, so they
-- persist. Any later migration that needs to rewrite `activity` must drop and
-- recreate them deliberately.
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
