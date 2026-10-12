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
-- **It must not fail on any database it meets**, so every constraint on
-- `project_statuses` is met by construction rather than by luck: names are
-- de-duplicated case-insensitively with a scheme that always finds a free name
-- and always fits 40 characters (see `named` below), positions come from
-- ROW_NUMBER, `hidden` is clamped to 0/1, every project — archived or not, with
-- tasks or without — gets all six categories, and so every task finds a status.
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
WITH RECURSIVE
  -- The six categories, the label each gets when it has no column name to
  -- inherit, and their canonical order.
  labels(category, label, ord) AS (
    VALUES ('backlog', 'Backlog', 0), ('todo', 'To do', 1), ('in_progress', 'In progress', 2),
           ('review', 'Review', 3), ('done', 'Done', 4), ('cancelled', 'Cancelled', 5)
  ),
  -- Every mapped status, ranked inside its column: the primary first, then the
  -- canonical order. A column whose primary flag was lost (LAI-618's donor
  -- bug) ranks by canonical order alone, which is what the board drew. Only
  -- rows of projects that exist: a dangling column must not mint a dangling
  -- status. The inner join on `labels` drops any value outside the six.
  mapped AS (
    SELECT c.project_id, c.name AS column_name, c.position AS major,
           CASE WHEN c.hidden = 1 THEN 1 ELSE 0 END AS hidden, s.status AS category,
           ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY s.is_primary DESC, l.ord) AS minor
    FROM `board_columns` c
    JOIN `projects` p ON p.id = c.project_id
    JOIN `board_column_statuses` s ON s.column_id = c.id AND s.project_id = c.project_id
    JOIN labels l ON l.category = s.status
  ),
  -- A one-status column keeps its own name. In a several-status column the
  -- primary takes the column's name and every other status becomes its own,
  -- default-labelled, placed straight after it, hidden if the column was.
  -- An empty column held no status, so it has no category and becomes nothing.
  -- `chosen` = 1 for a name a person chose: it wins any clash (below).
  from_columns AS (
    SELECT m.project_id, m.category,
           CASE WHEN m.minor = 1 THEN coalesce(nullif(trim(CAST(m.column_name AS TEXT)), ''), l.label)
                ELSE l.label END AS base,
           CASE WHEN m.minor = 1 THEN 1 ELSE 0 END AS chosen,
           m.hidden, 0 AS grp, m.major, m.minor
    FROM mapped m JOIN labels l ON l.category = m.category
  ),
  -- A category no column holds — including every category of a project whose
  -- tasks sit in statuses no column showed — gets a hidden, default-labelled
  -- status at the end, so every project has all six and every task a home. A
  -- project with no columns at all (one that predates LAI-266's boot backfill)
  -- gets the six defaults, visible except Cancelled — the board it was drawing.
  -- Archived projects and projects with no tasks are projects like any other.
  missing AS (
    SELECT p.id AS project_id, l.category, l.label AS base, 0 AS chosen,
           CASE WHEN l.category = 'cancelled'
                  OR EXISTS (SELECT 1 FROM `board_columns` c WHERE c.project_id = p.id)
                THEN 1 ELSE 0 END AS hidden,
           1 AS grp, l.ord AS major, 0 AS minor
    FROM `projects` p CROSS JOIN labels l
    WHERE NOT EXISTS (
      SELECT 1 FROM mapped m WHERE m.project_id = p.id AND m.category = l.category
    )
  ),
  everything AS (
    SELECT * FROM from_columns
    UNION ALL
    SELECT * FROM missing
  ),
  -- Position: dense 0..n-1 per project from ROW_NUMBER, so it is unique by
  -- construction whatever the old positions were.
  -- Naming order `k`: names people chose first, by position, then generated
  -- labels — so a generated "Review" never takes a name a lead typed.
  ordered AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY grp, major, minor) - 1 AS position,
           ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY chosen DESC, grp, major, minor) AS k,
           count(*) OVER (PARTITION BY project_id) AS n
    FROM everything
  ),
  -- 2, 3, … one more than the largest project has statuses: enough candidates
  -- that one is always free (below).
  suffixes(k) AS (
    SELECT 2
    UNION ALL
    SELECT k + 1 FROM suffixes WHERE k <= (SELECT coalesce(max(n), 0) FROM ordered)
  ),
  -- ## Names cannot collide, and nothing here can fail the migration
  --
  -- Each project's rows are named one at a time, in `k` order, carrying the
  -- lower-cased names already given as a JSON array (`taken` — JSON so that a
  -- name may contain any character). A row keeps its name if it is free, else
  -- takes the first free of "name (2)", "name (3)", … up to "name (n+1)",
  -- with the name cut so the result fits 40 characters.
  --
  -- **One of those is always free.** At most n-1 names are taken when a row is
  -- named, and the n candidates differ from one another — each ends in its own
  -- "(k)" — so by pigeonhole at least one is not taken. A lead's own "X (2)"
  -- is honoured too: it is named before any generated label, and a later clash
  -- simply moves on to "X (3)". `lower()` is the very function the unique index
  -- uses, so "free" here means free there.
  named(project_id, k, n, category, base, hidden, position, name, taken) AS (
    SELECT o.project_id, o.k, o.n, o.category, o.base, o.hidden, o.position,
           o.base, json_array(lower(o.base))
    FROM ordered o
    WHERE o.k = 1
    UNION ALL
    SELECT o.project_id, o.k, o.n, o.category, o.base, o.hidden, o.position,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM json_each(prev.taken) WHERE json_each.value = lower(o.base)) THEN o.base
      ELSE (
        SELECT substr(o.base, 1, 40 - length(' (' || sfx.k || ')')) || ' (' || sfx.k || ')'
        FROM suffixes sfx
        WHERE sfx.k <= o.n + 1
          AND NOT EXISTS (SELECT 1 FROM json_each(prev.taken) WHERE json_each.value = lower(substr(o.base, 1, 40 - length(' (' || sfx.k || ')')) || ' (' || sfx.k || ')'))
        ORDER BY sfx.k
        LIMIT 1
      )
    END,
    json_insert(prev.taken, '$[#]', lower(CASE
      WHEN NOT EXISTS (SELECT 1 FROM json_each(prev.taken) WHERE json_each.value = lower(o.base)) THEN o.base
      ELSE (
        SELECT substr(o.base, 1, 40 - length(' (' || sfx.k || ')')) || ' (' || sfx.k || ')'
        FROM suffixes sfx
        WHERE sfx.k <= o.n + 1
          AND NOT EXISTS (SELECT 1 FROM json_each(prev.taken) WHERE json_each.value = lower(substr(o.base, 1, 40 - length(' (' || sfx.k || ')')) || ' (' || sfx.k || ')'))
        ORDER BY sfx.k
        LIMIT 1
      )
    END))
    FROM named prev
    JOIN ordered o ON o.project_id = prev.project_id AND o.k = prev.k + 1
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
  named.name,
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