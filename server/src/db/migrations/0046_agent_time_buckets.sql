CREATE TABLE `agent_time_buckets` (
	`user_id` text NOT NULL,
	`session_key` text NOT NULL,
	`bucket` integer NOT NULL,
	`seconds` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `session_key`, `bucket`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_time_buckets_seconds_check" CHECK(seconds >= 0 AND seconds <= 300)
);
--> statement-breakpoint
CREATE INDEX `agent_time_buckets_user_bucket_idx` ON `agent_time_buckets` (`user_id`,`bucket`);