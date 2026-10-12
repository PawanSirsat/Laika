import { and, asc, eq } from 'drizzle-orm';
import { type Db } from './client.ts';
import { TASK_STATUSES, type TaskStatus } from './enums.ts';
import { newId } from './ids.ts';
import { projectStatuses } from './schema.ts';

/**
 * Project statuses at the bottom layer (LAI-738, D-077).
 *
 * **In `db/` rather than beside the service**, for the reason
 * `db/board-columns.ts` was: something below `services/` needs it.
 * `numbering.ts` inserts tasks and must give each one a `status_id`, and
 * CONVENTIONS §2 makes `db/` import none of the layers above it. So the seed,
 * the labels and "which status does this category mean here" live here, and
 * `services/project-statuses.ts` re-exports what callers look for.
 */

export const STATUS_NAME_MAX = 40;

/**
 * What a category is called when nothing else names it — the six labels the
 * board has always drawn. Used for a new project's statuses, for the
 * migration's default-labelled rows, and in error messages that would
 * otherwise print an enum value at a person.
 */
export const CATEGORY_LABELS: Readonly<Record<TaskStatus, string>> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

export interface StatusSeed {
  name: string;
  category: TaskStatus;
  hidden: boolean;
}

/**
 * What a **new** project gets: one status per category, in the lifecycle's
 * order, with Cancelled hidden (§11.4.1 keeps cancelled work behind a filter).
 */
export const DEFAULT_STATUSES: readonly StatusSeed[] = TASK_STATUSES.map((category) => ({
  name: CATEGORY_LABELS[category],
  category,
  hidden: category === 'cancelled',
}));

/**
 * Write the default statuses for a project that has none.
 *
 * **No `can()`, and that is not an exception to §5's rule** — the same
 * argument `createDefaultBoardColumns` made. Every caller is inside the
 * transaction that has just created the project (`createProject`, first-boot
 * setup) or is the test seed: there is no resource that existed before this
 * call and no actor to ask about it. `createProject` has already answered
 * `project.create`.
 */
export function createDefaultProjectStatuses(db: Db, projectId: string, now: number): void {
  db.insert(projectStatuses)
    .values(
      DEFAULT_STATUSES.map((seed, position) => ({
        id: newId(),
        projectId,
        name: seed.name,
        category: seed.category,
        position,
        hidden: seed.hidden ? 1 : 0,
        createdAt: now,
      })),
    )
    .run();
}

export interface StatusRef {
  id: string;
  name: string;
  category: TaskStatus;
  hidden: boolean;
}

/**
 * The status a bare category means in this project: the first **visible**
 * one by position, or the first of any visibility when every one is hidden
 * (Cancelled, by default).
 *
 * This is how every caller that speaks in categories — MCP's
 * `update_status`, the webhook, `claim`, a REST create with `status` —
 * lands a task in a real column without knowing the project's names.
 *
 * Throws rather than returning `undefined`: a project missing a category is a
 * broken invariant (every project keeps one of each), not an answer.
 */
export function statusForCategory(db: Db, projectId: string, category: TaskStatus): StatusRef {
  const rows = db
    .select({
      id: projectStatuses.id,
      name: projectStatuses.name,
      category: projectStatuses.category,
      hidden: projectStatuses.hidden,
    })
    .from(projectStatuses)
    .where(and(eq(projectStatuses.projectId, projectId), eq(projectStatuses.category, category)))
    .orderBy(asc(projectStatuses.position))
    .all();

  const chosen = rows.find((r) => r.hidden === 0) ?? rows[0];
  if (chosen === undefined) {
    throw new Error(
      `Project ${projectId} has no ${category} status — every project keeps one of each (D-077)`,
    );
  }

  return { ...chosen, hidden: chosen.hidden === 1 };
}
