CREATE TABLE `device_pairing_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`device_id` text,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`code_hash` text NOT NULL,
	`state` text NOT NULL,
	`public_key` text,
	`key_fingerprint` text,
	`claim_nonce` text,
	`claimed_os` text,
	`claimed_cli_version` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	`decided_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_pairing_requests_state_check" CHECK(state IN ('open', 'claimed', 'approved', 'completed', 'denied', 'expired', 'cancelled')),
	CONSTRAINT "device_pairing_requests_kind_check" CHECK(kind IN ('local', 'cloud'))
);
--> statement-breakpoint
CREATE INDEX `device_pairing_requests_owner_state_idx` ON `device_pairing_requests` (`owner_user_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_pairing_requests_code_hash_live_unique` ON `device_pairing_requests` (`code_hash`) WHERE state IN ('open', 'claimed', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX `devices_public_key_unique` ON `devices` (`public_key`) WHERE public_key IS NOT NULL;