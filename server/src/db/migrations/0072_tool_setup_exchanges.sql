CREATE TABLE `agent_client_reports` (
	`agent_id` text NOT NULL,
	`source` text NOT NULL,
	`token_id` text,
	`cli_version` text,
	`cli_commit` text,
	`protocol` integer,
	`capabilities_json` text,
	`harness_version` text,
	`client_name` text,
	`client_slug` text,
	`client_version` text,
	`reported_at` integer,
	PRIMARY KEY(`agent_id`, `source`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_client_reports_source_check" CHECK(source IN ('cli', 'mcp_initialize'))
);
--> statement-breakpoint
CREATE TABLE `tool_setup_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`purpose` text NOT NULL,
	`challenge` text NOT NULL,
	`state` text NOT NULL,
	`minted_token_id` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`minted_token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tool_setup_exchanges_state_check" CHECK(state IN ('open', 'redeemed', 'expired', 'cancelled')),
	CONSTRAINT "tool_setup_exchanges_purpose_check" CHECK(purpose IN ('install', 'rotate'))
);
--> statement-breakpoint
CREATE INDEX `tool_setup_exchanges_owner_state_idx` ON `tool_setup_exchanges` (`owner_user_id`,`state`);--> statement-breakpoint
CREATE INDEX `tool_setup_exchanges_agent_id_idx` ON `tool_setup_exchanges` (`agent_id`);