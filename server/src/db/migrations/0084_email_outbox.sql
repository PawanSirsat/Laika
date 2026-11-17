CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`recipient_user_id` text,
	`to_address` text,
	`subject` text NOT NULL,
	`body_enc` text,
	`state` text NOT NULL,
	`suppressed_reason` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`send_before` integer NOT NULL,
	`claimed_at` integer,
	`sent_at` integer,
	`last_error` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "email_outbox_kind_check" CHECK(kind IN ('test', 'invite', 'password_reset')),
	CONSTRAINT "email_outbox_state_check" CHECK(state IN ('queued', 'sending', 'sent', 'failed', 'unconfirmed', 'suppressed')),
	CONSTRAINT "email_outbox_suppressed_reason_check" CHECK(suppressed_reason IS NULL OR suppressed_reason IN ('email_off', 'email_not_configured', 'no_address', 'no_public_url', 'too_old', 'superseded')),
	CONSTRAINT "email_outbox_suppressed_check" CHECK((state = 'suppressed') = (suppressed_reason IS NOT NULL)),
	CONSTRAINT "email_outbox_last_error_check" CHECK(last_error IS NULL OR length(last_error) <= 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_outbox_idempotency_key_unique` ON `email_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `email_outbox_due_idx` ON `email_outbox` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_created_at_idx` ON `email_outbox` (`created_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_recipient_idx` ON `email_outbox` (`recipient_user_id`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `smtp_settings` text;--> statement-breakpoint
ALTER TABLE `orgs` ADD `email_enabled` integer DEFAULT 0 NOT NULL;