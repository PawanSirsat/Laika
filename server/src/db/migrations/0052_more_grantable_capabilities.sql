PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_org_role_grants` (
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
	CONSTRAINT "org_role_grants_capability_check" CHECK(capability IN ('see_people_analytics', 'see_org_activity', 'open_all_projects', 'invite_people', 'deactivate_people', 'create_archive_projects', 'manage_any_tokens', 'change_org_settings')),
	CONSTRAINT "org_role_grants_granted_check" CHECK(granted IN (0, 1))
);
--> statement-breakpoint
-- LAI-985 (D-104 item 6): *Manage people* is split in two. A stored
-- `manage_people` cell becomes `invite_people` and `deactivate_people`, each
-- granted as it was, set by the same person at the same time; every other
-- cell is copied as it stands. The new capabilities get no row and read as
-- their defaults, which are today's behaviour.
INSERT INTO `__new_org_role_grants`("org_id", "org_role", "capability", "granted", "set_by", "updated_at") SELECT "org_id", "org_role", "capability", "granted", "set_by", "updated_at" FROM `org_role_grants` WHERE "capability" <> 'manage_people';--> statement-breakpoint
INSERT INTO `__new_org_role_grants`("org_id", "org_role", "capability", "granted", "set_by", "updated_at") SELECT "org_id", "org_role", 'invite_people', "granted", "set_by", "updated_at" FROM `org_role_grants` WHERE "capability" = 'manage_people';--> statement-breakpoint
INSERT INTO `__new_org_role_grants`("org_id", "org_role", "capability", "granted", "set_by", "updated_at") SELECT "org_id", "org_role", 'deactivate_people', "granted", "set_by", "updated_at" FROM `org_role_grants` WHERE "capability" = 'manage_people';--> statement-breakpoint
DROP TABLE `org_role_grants`;--> statement-breakpoint
ALTER TABLE `__new_org_role_grants` RENAME TO `org_role_grants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `org_role_grants_set_by_idx` ON `org_role_grants` (`set_by`);