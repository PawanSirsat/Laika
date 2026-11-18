CREATE TABLE `org_people_sync` (
	`org_id` text PRIMARY KEY NOT NULL,
	`profile_enabled` integer DEFAULT 0 NOT NULL,
	`leavers_enabled` integer DEFAULT 0 NOT NULL,
	`configured_by` text,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error_code` text,
	`last_error` text,
	`last_result_json` text,
	`leavers_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`configured_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "org_people_sync_profile_check" CHECK(profile_enabled IN (0, 1)),
	CONSTRAINT "org_people_sync_leavers_check" CHECK(leavers_enabled IN (0, 1)),
	CONSTRAINT "org_people_sync_leavers_needs_profile_check" CHECK(leavers_enabled <= profile_enabled),
	CONSTRAINT "org_people_sync_last_error_code_check" CHECK(last_error_code IS NULL OR last_error_code IN ('not_connected', 'credentials_rejected', 'not_granted', 'unreachable', 'bad_answer'))
);
--> statement-breakpoint
CREATE INDEX `org_people_sync_configured_by_idx` ON `org_people_sync` (`configured_by`);--> statement-breakpoint
CREATE TABLE `user_directory` (
	`user_id` text PRIMARY KEY NOT NULL,
	`entra_oid` text,
	`job_title` text,
	`department` text,
	`manager_user_id` text,
	`account_enabled` integer,
	`seen_at` integer,
	`missing_since` integer,
	`photo_key` text,
	`photo_type` text,
	`photo_etag` text,
	`photo_updated_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`manager_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_directory_photo_type_check" CHECK(photo_type IS NULL OR photo_type IN ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "user_directory_account_enabled_check" CHECK(account_enabled IS NULL OR account_enabled IN (0, 1)),
	CONSTRAINT "user_directory_photo_check" CHECK((photo_key IS NULL) = (photo_type IS NULL) AND (photo_key IS NULL) = (photo_etag IS NULL) AND (photo_key IS NULL) = (photo_updated_at IS NULL)),
	CONSTRAINT "user_directory_oid_check" CHECK(entra_oid IS NULL OR length(entra_oid) BETWEEN 1 AND 64),
	CONSTRAINT "user_directory_job_title_check" CHECK(job_title IS NULL OR length(job_title) BETWEEN 1 AND 200),
	CONSTRAINT "user_directory_department_check" CHECK(department IS NULL OR length(department) BETWEEN 1 AND 200),
	CONSTRAINT "user_directory_etag_check" CHECK(photo_etag IS NULL OR length(photo_etag) <= 200)
);
--> statement-breakpoint
CREATE INDEX `user_directory_manager_idx` ON `user_directory` (`manager_user_id`);