CREATE TABLE `hr_people` (
	`external_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`department_ref` text,
	`designation_ref` text,
	`employment_type` text,
	`matched_by` text NOT NULL,
	`seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "hr_people_matched_by_check" CHECK(matched_by IN ('email', 'owner', 'none')),
	CONSTRAINT "hr_people_name_check" CHECK(length(name) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_people_user_id_unique` ON `hr_people` (`user_id`) WHERE "hr_people"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `leave_days` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`person_ref` text NOT NULL,
	`day` text NOT NULL,
	`part` text NOT NULL,
	`type_name` text,
	`status` text NOT NULL,
	`source_ref` text NOT NULL,
	`application_ref` text,
	`hash` text NOT NULL,
	`synced_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_ref`) REFERENCES `hr_people`(`external_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "leave_days_part_check" CHECK(part IN ('full', 'first_half', 'second_half')),
	CONSTRAINT "leave_days_status_check" CHECK(status IN ('approved', 'pending')),
	CONSTRAINT "leave_days_type_name_check" CHECK(type_name IS NULL OR length(type_name) <= 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leave_days_source_ref_unique` ON `leave_days` (`source_ref`);--> statement-breakpoint
CREATE INDEX `leave_days_user_day_idx` ON `leave_days` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `leave_days_person_ref_idx` ON `leave_days` (`person_ref`);--> statement-breakpoint
CREATE TABLE `org_holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`scope_json` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "org_holidays_source_check" CHECK(source IN ('manual', 'clan')),
	CONSTRAINT "org_holidays_label_check" CHECK(length(label) BETWEEN 1 AND 120),
	CONSTRAINT "org_holidays_origin_check" CHECK((source = 'clan' AND source_ref IS NOT NULL AND created_by IS NULL) OR (source = 'manual' AND source_ref IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_holidays_source_ref_unique` ON `org_holidays` (`source`,`source_ref`) WHERE "org_holidays"."source_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `org_holidays_manual_day_unique` ON `org_holidays` (`day`) WHERE "org_holidays"."source" = 'manual' AND "org_holidays"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `org_holidays_day_idx` ON `org_holidays` (`day`);--> statement-breakpoint
CREATE INDEX `org_holidays_created_by_idx` ON `org_holidays` (`created_by`);--> statement-breakpoint
CREATE TABLE `org_hr_source` (
	`org_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`base_url` text NOT NULL,
	`account_name` text NOT NULL,
	`account_email` text,
	`token_enc` text NOT NULL,
	`token_last4` text NOT NULL,
	`token_expires_at` integer,
	`pending_expires_at` integer,
	`sees_everyone` integer NOT NULL,
	`sees_departments` integer NOT NULL,
	`connected_by` text,
	`connected_at` integer NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error_code` text,
	`last_error` text,
	`last_result_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "org_hr_source_provider_check" CHECK(provider IN ('clan')),
	CONSTRAINT "org_hr_source_status_check" CHECK(status IN ('pending_2fa', 'connected')),
	CONSTRAINT "org_hr_source_pending_check" CHECK((status = 'pending_2fa') = (pending_expires_at IS NOT NULL)),
	CONSTRAINT "org_hr_source_last_error_code_check" CHECK(last_error_code IS NULL OR last_error_code IN ('token_rejected', 'unreachable', 'bad_answer')),
	CONSTRAINT "org_hr_source_sees_check" CHECK(sees_everyone IN (0, 1) AND sees_departments IN (0, 1)),
	CONSTRAINT "org_hr_source_account_name_check" CHECK(length(account_name) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX `org_hr_source_connected_by_idx` ON `org_hr_source` (`connected_by`);