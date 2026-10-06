-- LAI-493 / D-066: `parent_task_id`, `due_on`, `planned_start` on `tasks`, with
-- the self-reference CHECK that makes drizzle-kit rebuild the table.
--
-- Hand-edited in one place: the generated INSERT … SELECT named the three new
-- columns in its SELECT list, reading them from the *old* table, which does not
-- have them — "no such column: parent_task_id" on every existing database.
-- They are selected as NULL instead. `migrate.test.ts` migrates a populated
-- pre-rebuild database and checks `PRAGMA foreign_key_check` to prove it.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`acceptance_md` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'p2' NOT NULL,
	`assignee_id` text,
	`sprint_id` text,
	`created_by` text NOT NULL,
	`created_via` text NOT NULL,
	`discovered_from` text,
	`parent_task_id` text,
	`due_on` integer,
	`planned_start` integer,
	`branch` text,
	`external_ref` text,
	`stale_flagged_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_status_check" CHECK(status IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
	CONSTRAINT "tasks_priority_check" CHECK(priority IN ('p1', 'p2', 'p3')),
	CONSTRAINT "tasks_created_via_check" CHECK(created_via IN ('web', 'mcp', 'api', 'webhook', 'meeting')),
	CONSTRAINT "tasks_number_check" CHECK(number > 0),
	CONSTRAINT "tasks_discovered_from_check" CHECK(discovered_from IS NULL OR discovered_from <> id),
	CONSTRAINT "tasks_parent_task_id_check" CHECK(parent_task_id IS NULL OR parent_task_id <> id)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "number", "title", "description_md", "acceptance_md", "status", "priority", "assignee_id", "sprint_id", "created_by", "created_via", "discovered_from", "parent_task_id", "due_on", "planned_start", "branch", "external_ref", "stale_flagged_at", "started_at", "completed_at", "created_at", "updated_at") SELECT "id", "project_id", "number", "title", "description_md", "acceptance_md", "status", "priority", "assignee_id", "sprint_id", "created_by", "created_via", "discovered_from", NULL, NULL, NULL, "branch", "external_ref", "stale_flagged_at", "started_at", "completed_at", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_number_unique` ON `tasks` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `tasks_project_status_idx` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_status_idx` ON `tasks` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_updated_at_idx` ON `tasks` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tasks_sprint_id_idx` ON `tasks` (`sprint_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_by_idx` ON `tasks` (`created_by`);--> statement-breakpoint
CREATE INDEX `tasks_discovered_from_idx` ON `tasks` (`discovered_from`);--> statement-breakpoint
CREATE INDEX `tasks_parent_task_id_idx` ON `tasks` (`parent_task_id`);