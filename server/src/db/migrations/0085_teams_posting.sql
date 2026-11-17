CREATE TABLE `org_teams_settings` (
	`org_id` text PRIMARY KEY NOT NULL,
	`posting_enabled` integer NOT NULL,
	`notice_cursor` integer NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "org_teams_settings_enabled_check" CHECK(posting_enabled IN (0, 1)),
	CONSTRAINT "org_teams_settings_cursor_check" CHECK(notice_cursor >= 0)
);
--> statement-breakpoint
CREATE INDEX `org_teams_settings_updated_by_idx` ON `org_teams_settings` (`updated_by`);--> statement-breakpoint
CREATE TABLE `project_teams_channels` (
	`project_id` text PRIMARY KEY NOT NULL,
	`webhook_url_enc` text NOT NULL,
	`webhook_host` text NOT NULL,
	`webhook_last4` text NOT NULL,
	`set_by` text,
	`set_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_teams_channels_host_check" CHECK(length(webhook_host) BETWEEN 1 AND 253),
	CONSTRAINT "project_teams_channels_last4_check" CHECK(length(webhook_last4) = 4)
);
--> statement-breakpoint
CREATE INDEX `project_teams_channels_set_by_idx` ON `project_teams_channels` (`set_by`);--> statement-breakpoint
CREATE TABLE `teams_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`event` text,
	`slot` text,
	`title` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text,
	`http_status` integer,
	`attempt` integer NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "teams_posts_kind_check" CHECK(kind IN ('standup', 'digest', 'notice', 'test')),
	CONSTRAINT "teams_posts_event_check" CHECK(event IS NULL OR event IN ('morning', 'evening', 'assigned', 'sent_back', 'in_review', 'done', 'blocked', 'unblocked', 'commented')),
	CONSTRAINT "teams_posts_outcome_check" CHECK(outcome IN ('sending', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "teams_posts_reason_check" CHECK(reason IS NULL OR reason IN ('posting_off', 'too_old', 'burst', 'refused', 'unavailable', 'unreachable', 'no_answer', 'address_unusable')),
	CONSTRAINT "teams_posts_reason_needed_check" CHECK((outcome IN ('sending', 'sent')) = (reason IS NULL)),
	CONSTRAINT "teams_posts_title_check" CHECK(length(title) BETWEEN 1 AND 300),
	CONSTRAINT "teams_posts_attempt_check" CHECK(attempt >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_posts_slot_unique` ON `teams_posts` (`project_id`,`slot`) WHERE slot IS NOT NULL AND outcome IN ('sending', 'sent', 'suppressed');--> statement-breakpoint
CREATE INDEX `teams_posts_project_created_at_idx` ON `teams_posts` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `teams_posts_created_at_idx` ON `teams_posts` (`created_at`);