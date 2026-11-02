CREATE TABLE `project_repo_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`agent_id` text,
	`project_id` text NOT NULL,
	`repo_key` text NOT NULL,
	`repo_label` text,
	`instructions_path` text,
	`block_found` integer NOT NULL,
	`template_revision` integer,
	`project_match` integer,
	`prefix_match` integer,
	`source` text NOT NULL,
	`checked_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_repo_setups_source_check" CHECK(source IN ('self_reported_browser', 'local_check'))
);
--> statement-breakpoint
CREATE INDEX `project_repo_setups_owner_project_idx` ON `project_repo_setups` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `project_repo_setups_agent_id_idx` ON `project_repo_setups` (`agent_id`);