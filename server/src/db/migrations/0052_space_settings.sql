-- LAI-976, D-103: a space's colour, its two rules — who may create tasks and
-- whether agents may write — and the prefixes it carried before its current
-- one, so an old key keeps resolving after a re-key.
--
-- **Additive only.** drizzle-kit generated a rebuild of `projects`, because a
-- table-level CHECK is a new constraint to it — and its copy step selected the
-- four new columns from the old table, which does not have them. Hand-edited to
-- `ALTER TABLE … ADD` with each CHECK as a column constraint, as 0029 and 0031
-- did: SQLite tests it against every existing row as the column is added, and
-- `projects` — which every task, membership and activity row references — is
-- never dropped and copied. `projects_rules_idx` is drizzle-kit's line as
-- generated: `loadActor` reads the spaces with non-default rules on every
-- request, and the index keeps that a search. The snapshot beside this file
-- is drizzle-kit's, unedited.
ALTER TABLE `projects` ADD `color` text CONSTRAINT "projects_color_check" CHECK(color IS NULL OR color IN ('black', 'violet', 'teal', 'blue', 'amber', 'magenta', 'red', 'green'));--> statement-breakpoint
ALTER TABLE `projects` ADD `task_create_min_role` text DEFAULT 'member' NOT NULL CONSTRAINT "projects_task_create_min_role_check" CHECK(task_create_min_role IN ('member', 'lead'));--> statement-breakpoint
ALTER TABLE `projects` ADD `agents_allowed` integer DEFAULT true NOT NULL CONSTRAINT "projects_agents_allowed_check" CHECK(agents_allowed IN (0, 1));--> statement-breakpoint
ALTER TABLE `projects` ADD `former_prefixes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `projects_rules_idx` ON `projects` (`task_create_min_role`,`agents_allowed`);
