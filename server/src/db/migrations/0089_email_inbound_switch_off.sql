PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_email_inbound_attachments` (
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
	CONSTRAINT "email_inbound_attachments_reason_check" CHECK(reason IS NULL OR reason IN ('too_large', 'store_off', 'no_api_key', 'fetch_failed', 'store_failed', 'not_needed', 'switch_off')),
	CONSTRAINT "email_inbound_attachments_reason_needed_check" CHECK((state IN ('failed', 'skipped')) = (reason IS NOT NULL)),
	CONSTRAINT "email_inbound_attachments_pending_check" CHECK((state = 'pending') = (download_token IS NOT NULL)),
	CONSTRAINT "email_inbound_attachments_filename_check" CHECK(length(filename) BETWEEN 1 AND 255),
	CONSTRAINT "email_inbound_attachments_content_type_check" CHECK(length(content_type) BETWEEN 1 AND 127),
	CONSTRAINT "email_inbound_attachments_size_check" CHECK(size_bytes >= 0),
	CONSTRAINT "email_inbound_attachments_attempts_check" CHECK(attempts >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_email_inbound_attachments`("id", "inbound_id", "download_token", "filename", "content_type", "size_bytes", "state", "reason", "attachment_id", "attempts", "created_at", "finished_at") SELECT "id", "inbound_id", "download_token", "filename", "content_type", "size_bytes", "state", "reason", "attachment_id", "attempts", "created_at", "finished_at" FROM `email_inbound_attachments`;--> statement-breakpoint
DROP TABLE `email_inbound_attachments`;--> statement-breakpoint
ALTER TABLE `__new_email_inbound_attachments` RENAME TO `email_inbound_attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `email_inbound_attachments_inbound_idx` ON `email_inbound_attachments` (`inbound_id`);--> statement-breakpoint
CREATE INDEX `email_inbound_attachments_state_idx` ON `email_inbound_attachments` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_inbound_attachments_attachment_idx` ON `email_inbound_attachments` (`attachment_id`);