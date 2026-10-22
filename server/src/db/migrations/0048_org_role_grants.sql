CREATE TABLE `org_role_grants` (
	`org_id` text NOT NULL,
	`org_role` text NOT NULL,
	`capability` text NOT NULL,
	`granted` integer NOT NULL,
	`set_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `org_role`, `capability`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "org_role_grants_org_role_check" CHECK(org_role IN ('admin', 'member', 'viewer')),
	CONSTRAINT "org_role_grants_capability_check" CHECK(capability IN ('see_people_analytics', 'see_org_activity', 'open_all_projects', 'manage_people', 'change_org_settings')),
	CONSTRAINT "org_role_grants_granted_check" CHECK(granted IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `org_role_grants_set_by_idx` ON `org_role_grants` (`set_by`);