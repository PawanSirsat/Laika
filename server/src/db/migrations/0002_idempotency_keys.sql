CREATE TABLE `idempotency_keys` (
	`actor_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`actor_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_expires_at_idx` ON `idempotency_keys` (`expires_at`);