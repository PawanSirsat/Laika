CREATE TABLE `email_digest_items` (
	`id` text PRIMARY KEY NOT NULL,
	`digest_id` text NOT NULL,
	`user_id` text NOT NULL,
	`activity_id` text,
	`notice_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`digest_id`) REFERENCES `email_digests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notice_id`) REFERENCES `member_notices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_digest_items_one_source_check" CHECK((activity_id IS NULL) <> (notice_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_digest_items_activity_unique` ON `email_digest_items` (`user_id`,`activity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_digest_items_notice_unique` ON `email_digest_items` (`user_id`,`notice_id`);--> statement-breakpoint
CREATE INDEX `email_digest_items_digest_idx` ON `email_digest_items` (`digest_id`);--> statement-breakpoint
CREATE TABLE `email_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`outbox_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_digests_state_check" CHECK(state IN ('open', 'closed')),
	CONSTRAINT "email_digests_closed_check" CHECK((state = 'closed') = (closed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_digests_one_open_per_person` ON `email_digests` (`user_id`) WHERE state = 'open';--> statement-breakpoint
CREATE INDEX `email_digests_state_idx` ON `email_digests` (`state`,`opened_at`);--> statement-breakpoint
CREATE TABLE `email_watermarks` (
	`source` text PRIMARY KEY NOT NULL,
	`read_to` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_email_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`instant` integer DEFAULT 1 NOT NULL,
	`digest` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_email_prefs_instant_check" CHECK(instant IN (0, 1)),
	CONSTRAINT "user_email_prefs_digest_check" CHECK(digest IN (0, 1))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_email_outbox` (
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
	CONSTRAINT "email_outbox_kind_check" CHECK(kind IN ('test', 'invite', 'password_reset', 'assignment', 'mention', 'digest')),
	CONSTRAINT "email_outbox_state_check" CHECK(state IN ('queued', 'sending', 'sent', 'failed', 'unconfirmed', 'suppressed')),
	CONSTRAINT "email_outbox_suppressed_reason_check" CHECK(suppressed_reason IS NULL OR suppressed_reason IN ('email_off', 'email_not_configured', 'no_address', 'no_public_url', 'too_old', 'superseded', 'pref_off', 'no_access')),
	CONSTRAINT "email_outbox_suppressed_check" CHECK((state = 'suppressed') = (suppressed_reason IS NOT NULL)),
	CONSTRAINT "email_outbox_last_error_check" CHECK(last_error IS NULL OR length(last_error) <= 300)
);
--> statement-breakpoint
INSERT INTO `__new_email_outbox`("id", "kind", "idempotency_key", "recipient_user_id", "to_address", "subject", "body_enc", "state", "suppressed_reason", "attempts", "next_attempt_at", "send_before", "claimed_at", "sent_at", "last_error", "created_by", "created_at", "updated_at") SELECT "id", "kind", "idempotency_key", "recipient_user_id", "to_address", "subject", "body_enc", "state", "suppressed_reason", "attempts", "next_attempt_at", "send_before", "claimed_at", "sent_at", "last_error", "created_by", "created_at", "updated_at" FROM `email_outbox`;--> statement-breakpoint
DROP TABLE `email_outbox`;--> statement-breakpoint
ALTER TABLE `__new_email_outbox` RENAME TO `email_outbox`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `email_outbox_idempotency_key_unique` ON `email_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `email_outbox_due_idx` ON `email_outbox` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_created_at_idx` ON `email_outbox` (`created_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_recipient_idx` ON `email_outbox` (`recipient_user_id`);