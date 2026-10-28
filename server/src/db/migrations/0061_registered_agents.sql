CREATE TABLE `agent_project_grants` (
	`agent_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `project_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_project_grants_scope_check" CHECK(scope IN ('full', 'read_only'))
);
--> statement-breakpoint
CREATE INDEX `agent_project_grants_project_id_idx` ON `agent_project_grants` (`project_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`harness` text NOT NULL,
	`device_label` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`last_seen_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agents_status_check" CHECK(status IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX `agents_org_id_idx` ON `agents` (`org_id`);--> statement-breakpoint
CREATE INDEX `agents_owner_user_id_idx` ON `agents` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `tokens` ADD `agent_id` text REFERENCES agents(id) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `tokens_agent_id_idx` ON `tokens` (`agent_id`);