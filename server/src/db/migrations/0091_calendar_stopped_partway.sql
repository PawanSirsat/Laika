PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_org_calendar_source` (
	`org_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`secret_enc` text NOT NULL,
	`secret_last4` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`rules_json` text DEFAULT '[]' NOT NULL,
	`configured_by` text,
	`configured_at` integer NOT NULL,
	`last_test_at` integer,
	`last_test_roles_json` text,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error_code` text,
	`last_error` text,
	`last_result_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`configured_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "org_calendar_source_enabled_check" CHECK(enabled IN (0, 1)),
	CONSTRAINT "org_calendar_source_last_error_code_check" CHECK(last_error_code IS NULL OR last_error_code IN ('credentials_rejected', 'not_granted', 'unreachable', 'bad_answer', 'stopped_partway')),
	CONSTRAINT "org_calendar_source_test_check" CHECK((last_test_at IS NULL) = (last_test_roles_json IS NULL)),
	CONSTRAINT "org_calendar_source_tenant_check" CHECK(length(tenant_id) BETWEEN 1 AND 100),
	CONSTRAINT "org_calendar_source_client_check" CHECK(length(client_id) = 36)
);
--> statement-breakpoint
INSERT INTO `__new_org_calendar_source`("org_id", "tenant_id", "client_id", "secret_enc", "secret_last4", "enabled", "rules_json", "configured_by", "configured_at", "last_test_at", "last_test_roles_json", "last_attempt_at", "last_success_at", "last_error_code", "last_error", "last_result_json", "updated_at") SELECT "org_id", "tenant_id", "client_id", "secret_enc", "secret_last4", "enabled", "rules_json", "configured_by", "configured_at", "last_test_at", "last_test_roles_json", "last_attempt_at", "last_success_at", "last_error_code", "last_error", "last_result_json", "updated_at" FROM `org_calendar_source`;--> statement-breakpoint
DROP TABLE `org_calendar_source`;--> statement-breakpoint
ALTER TABLE `__new_org_calendar_source` RENAME TO `org_calendar_source`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `org_calendar_source_configured_by_idx` ON `org_calendar_source` (`configured_by`);