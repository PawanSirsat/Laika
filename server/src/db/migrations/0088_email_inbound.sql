CREATE TABLE `email_inbound` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`address_token` text NOT NULL,
	`project_id` text,
	`from_address` text,
	`user_id` text,
	`outcome` text NOT NULL,
	`reason` text,
	`task_id` text,
	`comment_id` text,
	`auth` text,
	`attachment_count` integer DEFAULT 0 NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "email_inbound_outcome_check" CHECK(outcome IN ('task_created', 'comment_added', 'dropped')),
	CONSTRAINT "email_inbound_reason_check" CHECK(reason IS NULL OR reason IN ('switch_off', 'unknown_address', 'own_sender', 'auto_reply', 'spam', 'unauthenticated', 'unknown_sender', 'not_allowed', 'empty', 'refused')),
	CONSTRAINT "email_inbound_reason_needed_check" CHECK((outcome = 'dropped') = (reason IS NOT NULL)),
	CONSTRAINT "email_inbound_message_id_check" CHECK(length(message_id) BETWEEN 1 AND 512),
	CONSTRAINT "email_inbound_from_check" CHECK(from_address IS NULL OR length(from_address) <= 320),
	CONSTRAINT "email_inbound_auth_check" CHECK(auth IS NULL OR length(auth) <= 300),
	CONSTRAINT "email_inbound_attachments_check" CHECK(attachment_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_inbound_message_unique` ON `email_inbound` (`message_id`,`address_token`);--> statement-breakpoint
CREATE INDEX `email_inbound_project_received_idx` ON `email_inbound` (`project_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `email_inbound_received_at_idx` ON `email_inbound` (`received_at`);--> statement-breakpoint
CREATE INDEX `email_inbound_user_id_idx` ON `email_inbound` (`user_id`);--> statement-breakpoint
CREATE INDEX `email_inbound_task_id_idx` ON `email_inbound` (`task_id`);--> statement-breakpoint
CREATE INDEX `email_inbound_comment_id_idx` ON `email_inbound` (`comment_id`);--> statement-breakpoint
CREATE TABLE `email_inbound_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`inbound_id` text NOT NULL,
	`download_token` text,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`attachment_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`inbound_id`) REFERENCES `email_inbound`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "email_inbound_attachments_state_check" CHECK(state IN ('pending', 'stored', 'failed', 'skipped')),
	CONSTRAINT "email_inbound_attachments_reason_check" CHECK(reason IS NULL OR reason IN ('too_large', 'store_off', 'no_api_key', 'fetch_failed', 'store_failed', 'not_needed')),
	CONSTRAINT "email_inbound_attachments_reason_needed_check" CHECK((state IN ('failed', 'skipped')) = (reason IS NOT NULL)),
	CONSTRAINT "email_inbound_attachments_pending_check" CHECK((state = 'pending') = (download_token IS NOT NULL)),
	CONSTRAINT "email_inbound_attachments_filename_check" CHECK(length(filename) BETWEEN 1 AND 255),
	CONSTRAINT "email_inbound_attachments_content_type_check" CHECK(length(content_type) BETWEEN 1 AND 127),
	CONSTRAINT "email_inbound_attachments_size_check" CHECK(size_bytes >= 0),
	CONSTRAINT "email_inbound_attachments_attempts_check" CHECK(attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX `email_inbound_attachments_inbound_idx` ON `email_inbound_attachments` (`inbound_id`);--> statement-breakpoint
CREATE INDEX `email_inbound_attachments_state_idx` ON `email_inbound_attachments` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_inbound_attachments_attachment_idx` ON `email_inbound_attachments` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `org_email_inbound` (
	`org_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`domain` text,
	`token_hash` text,
	`token_last4` text,
	`api_key_enc` text,
	`api_key_last4` text,
	`require_authenticated` integer DEFAULT 1 NOT NULL,
	`authserv_id` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "org_email_inbound_enabled_check" CHECK(enabled IN (0, 1)),
	CONSTRAINT "org_email_inbound_require_authenticated_check" CHECK(require_authenticated IN (0, 1)),
	CONSTRAINT "org_email_inbound_domain_check" CHECK(domain IS NULL OR length(domain) BETWEEN 3 AND 253),
	CONSTRAINT "org_email_inbound_token_check" CHECK((token_hash IS NULL) = (token_last4 IS NULL)),
	CONSTRAINT "org_email_inbound_api_key_check" CHECK((api_key_enc IS NULL) = (api_key_last4 IS NULL)),
	CONSTRAINT "org_email_inbound_authserv_check" CHECK(authserv_id IS NULL OR length(authserv_id) BETWEEN 1 AND 253),
	CONSTRAINT "org_email_inbound_on_check" CHECK(enabled = 0 OR (domain IS NOT NULL AND token_hash IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `org_email_inbound_updated_by_idx` ON `org_email_inbound` (`updated_by`);--> statement-breakpoint
CREATE TABLE `project_inbound_addresses` (
	`project_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_inbound_addresses_token_check" CHECK(length(token) = 12 AND token NOT GLOB '*[^a-z2-7]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_inbound_addresses_token_unique` ON `project_inbound_addresses` (`token`);--> statement-breakpoint
CREATE INDEX `project_inbound_addresses_created_by_idx` ON `project_inbound_addresses` (`created_by`);