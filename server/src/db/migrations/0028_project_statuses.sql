-- LAI-738, D-077: project statuses replace board columns.
--
-- Hand-edited after `drizzle-kit generate`, which wrote this file in two halves
-- (the create and the tasks rebuild, then the drops) so that it never had to
-- ask whether `project_statuses` was a rename of `board_columns`. It is not.
--
-- The order is the whole design:
--   1. create `project_statuses`;
--   2. copy today's columns into it, preserving how the board looks;
--   3. rebuild `tasks` with `status_id` = the first status (by position) of the
--      task's project and category, so no task changes category;
--   4. drop the two board-column tables.
--
-- `runMigrations` switches foreign keys off outside the migrator's
-- transaction, so the `DROP TABLE tasks` below does not cascade-delete
-- dependencies, comments, tags or watchers (LAI-493). The `PRAGMA` lines
-- drizzle-kit writes are no-ops inside that transaction and are kept only
-- because they are what it generates.
--
-- Ids are ULIDs built in SQL: ten Crockford characters of the migration's
-- clock and sixteen of `random()`. `random() & 31` rather than
-- `abs(random()) % 32`, because `abs()` of the smallest 64-bit integer is an
-- overflow error. No CTE is read twice, so no id is generated twice.
CREATE TABLE `project_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`position` integer NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_statuses_category_check" CHECK(category IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
	CONSTRAINT "project_statuses_hidden_check" CHECK(hidden IN (0, 1)),
	CONSTRAINT "project_statuses_name_check" CHECK(length(trim(name)) BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_statuses_project_position_unique` ON `project_statuses` (`project_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_statuses_project_name_unique` ON `project_statuses` (`project_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `project_statuses_project_id_category_unique` ON `project_statuses` (`project_id`,`id`,`category`);--> statement-breakpoint
WITH
  -- The six categories, the label each gets when it has no column name to
  -- inherit, and their canonical order.
  labels(category, label, ord) AS (
    VALUES ('backlog', 'Backlog', 0), ('todo', 'To do', 1), ('in_progress', 'In progress', 2),
           ('review', 'Review', 3), ('done', 'Done', 4), ('cancelled', 'Cancelled', 5)
  ),
  -- Every mapped status, ranked inside its column: the primary first, then the
  -- canonical order. A column whose primary flag was lost (LAI-618's donor
  -- bug) ranks by canonical order alone, which is what the board drew.
  mapped AS (
    SELECT c.project_id, c.name AS column_name, c.position AS major, c.hidden, s.status AS category,
           ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY s.is_primary DESC, l.ord) AS minor
    FROM `board_columns` c
    JOIN `board_column_statuses` s ON s.column_id = c.id AND s.project_id = c.project_id
    JOIN labels l ON l.category = s.status
  ),
  -- A one-status column keeps its own name. In a several-status column the
  -- primary takes the column's name and every other status becomes its own,
  -- default-labelled, placed straight after it, hidden if the column was.
  -- An empty column held no status, so it has no category and becomes nothing.
  from_columns AS (
    SELECT m.project_id, m.category,
           CASE WHEN m.minor = 1 THEN trim(m.column_name) ELSE l.label END AS name,
           m.hidden, 0 AS grp, m.major, m.minor
    FROM mapped m JOIN labels l ON l.category = m.category
  ),
  -- A category no column holds gets a hidden, default-labelled status at the
  -- end, so every project has all six. A project with no columns at all —
  -- one that predates LAI-266's boot backfill — gets the six defaults instead,
  -- visible except Cancelled, which is the board it was already drawing.
  missing AS (
    SELECT p.id AS project_id, l.category, l.label AS name,
           CASE WHEN l.category = 'cancelled'
                  OR EXISTS (SELECT 1 FROM `board_columns` c WHERE c.project_id = p.id)
                THEN 1 ELSE 0 END AS hidden,
           1 AS grp, l.ord AS major, 0 AS minor
    FROM `projects` p CROSS JOIN labels l
    WHERE NOT EXISTS (
      SELECT 1 FROM `board_column_statuses` s WHERE s.project_id = p.id AND s.status = l.category
    )
  ),
  everything AS (
    SELECT * FROM from_columns
    UNION ALL
    SELECT * FROM missing
  ),
  placed AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY grp, major, minor) - 1 AS position
    FROM everything
  ),
  -- A second status called the same thing (case-insensitively) gets " (2)",
  -- the third " (3)". Cut to 34 characters first so the result fits in 40.
  named AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id, lower(name) ORDER BY position) AS dup
    FROM placed
  ),
  clock(ms) AS (
    SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  )
INSERT INTO `project_statuses` (`id`, `project_id`, `name`, `category`, `position`, `hidden`, `created_at`)
SELECT
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 45) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 40) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 35) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 30) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 25) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 20) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 15) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 10) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 5) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((clock.ms >> 0) & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1)
    || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (random() & 31) + 1, 1),
  named.project_id,
  CASE WHEN named.dup = 1 THEN named.name
       ELSE substr(named.name, 1, 34) || ' (' || named.dup || ')' END,
  named.category,
  named.position,
  named.hidden,
  clock.ms
FROM named CROSS JOIN clock;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`acceptance_md` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`status_id` text NOT NULL,
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
	`position` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`,`status_id`,`status`) REFERENCES `project_statuses`(`project_id`,`id`,`category`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_status_check" CHECK(status IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
	CONSTRAINT "tasks_priority_check" CHECK(priority IN ('p1', 'p2', 'p3')),
	CONSTRAINT "tasks_created_via_check" CHECK(created_via IN ('web', 'mcp', 'api', 'webhook', 'meeting')),
	CONSTRAINT "tasks_number_check" CHECK(number > 0),
	CONSTRAINT "tasks_discovered_from_check" CHECK(discovered_from IS NULL OR discovered_from <> id),
	CONSTRAINT "tasks_parent_task_id_check" CHECK(parent_task_id IS NULL OR parent_task_id <> id)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "number", "title", "description_md", "acceptance_md", "status", "status_id", "priority", "assignee_id", "sprint_id", "created_by", "created_via", "discovered_from", "parent_task_id", "due_on", "planned_start", "branch", "external_ref", "stale_flagged_at", "position", "started_at", "completed_at", "created_at", "updated_at") SELECT "id", "project_id", "number", "title", "description_md", "acceptance_md", "status", (SELECT ps.id FROM `project_statuses` ps WHERE ps.project_id = `tasks`.project_id AND ps.category = `tasks`.status ORDER BY ps.position LIMIT 1), "priority", "assignee_id", "sprint_id", "created_by", "created_via", "discovered_from", "parent_task_id", "due_on", "planned_start", "branch", "external_ref", "stale_flagged_at", "position", "started_at", "completed_at", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
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
CREATE INDEX `tasks_parent_task_id_idx` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_position_unique` ON `tasks` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_status_id_idx` ON `tasks` (`status_id`);--> statement-breakpoint
DROP TABLE `board_column_statuses`;--> statement-breakpoint
DROP TABLE `board_columns`;