CREATE TABLE `agent_session_context_deliveries` (
	`session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`delivered_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `project_id`),
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_session_context_deliveries_project_id_idx` ON `agent_session_context_deliveries` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_context_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`author_id` text,
	`agent_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_context_revisions_revision_check" CHECK(revision >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_context_revisions_project_revision_unique` ON `project_context_revisions` (`project_id`,`revision`);--> statement-breakpoint
ALTER TABLE `projects` ADD `context_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- LAI-555: every project whose context document is not empty gets it as
-- revision 1, written by whoever last edited it (null when no edit was
-- recorded) at that time, or at the project's `updated_at`. `context_md`
-- stays as it was, so rolling back loses nothing. runMigrations registers
-- laika_new_id, the same ULID a request mints.
INSERT INTO `project_context_revisions` (`id`, `project_id`, `revision`, `body`, `author_id`, `agent_id`, `created_at`)
SELECT laika_new_id(), p.`id`, 1, p.`context_md`,
	(SELECT a.`actor_id` FROM `activity` a
		WHERE a.`project_id` = p.`id`
			AND a.`type` IN ('project.context_updated', 'project.updated')
			AND a.`payload_json` LIKE '%"context_md"%'
		ORDER BY a.`created_at` DESC, a.rowid DESC LIMIT 1),
	NULL,
	COALESCE(
		(SELECT a.`created_at` FROM `activity` a
			WHERE a.`project_id` = p.`id`
				AND a.`type` IN ('project.context_updated', 'project.updated')
				AND a.`payload_json` LIKE '%"context_md"%'
			ORDER BY a.`created_at` DESC, a.rowid DESC LIMIT 1),
		p.`updated_at`)
FROM `projects` p
WHERE p.`context_md` <> '';
--> statement-breakpoint
UPDATE `projects` SET `context_revision` = 1 WHERE `context_md` <> '';
