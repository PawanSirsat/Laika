import { and, eq, inArray } from 'drizzle-orm';
import { activityActor, type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { projects, tasks, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { can } from '../policy/can.ts';
import { canBeMentioned } from './mentions.ts';
import { OPEN_STATUSES } from './tasks.ts';

/**
 * Offboarding asks (D-104 item 5, LAI-986).
 *
 * Removing someone from a space, or deactivating them, used to leave their
 * open tasks assigned to a person who could no longer see them — work that
 * looks owned and is not. Both paths now take `open_tasks`:
 *
 * - `'unassign'` — every open task they hold in scope loses its assignee;
 * - `{ reassign_to }` — every one goes to that person, who must be able to
 *   hold **each** of them (LAI-962's rule, `canBeMentioned`), or nothing moves
 *   and the refusal names every task that could not — those the caller may
 *   read, with `hidden` counting the rest, as the `409` does.
 *
 * Without it, and with open tasks in scope, the answer is `409` with the
 * count and the keys, so a screen can ask. "Open" is LAI-974's
 * `OPEN_STATUSES` — not done, not cancelled — so the question and the
 * figures on the overview count the same thing.
 *
 * ## Whose authority
 *
 * The removal's or the deactivation's, already asked by the caller before
 * this runs: handing back somebody's work is part of taking them off it, not
 * a separate `task.assign_other` per task. What the caller is **shown** is
 * still bounded by what they can read: the `409` counts every open task but
 * lists only the keys in spaces the caller may read, and `hidden` says how
 * many it left out. The `422`'s refused tasks are filtered the same way.
 *
 * ## No new verb
 *
 * Each moved task writes `task.assigned` (§5: a reassignment is
 * `task.assigned`), with `via: 'offboarding'`. A seventh verb would be three
 * owners (CLAUDE.md §4.4) for something the existing one already says.
 */

export type OpenTasksChoice = 'unassign' | { reassign_to: string };

export interface OpenTask {
  id: string;
  projectId: string;
  key: string;
  orgId: string;
}

/** The open tasks `userId` holds — in one space, or (no `projectId`) anywhere. */
export function openTasksHeldBy(db: Db, userId: string, projectId?: string): OpenTask[] {
  return db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      number: tasks.number,
      prefix: projects.prefix,
      orgId: projects.orgId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.assigneeId, userId),
        inArray(tasks.status, [...OPEN_STATUSES]),
        ...(projectId === undefined ? [] : [eq(tasks.projectId, projectId)]),
      ),
    )
    .all()
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      key: `${row.prefix}-${String(row.number)}`,
      orgId: row.orgId,
    }))
    .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
}

/**
 * Everything that could refuse, asked before anything is written: the `409`
 * when no choice was given, and every reason a reassignment cannot land.
 */
export function assertOffboardingChoice(
  db: Db,
  actor: ResolvedActor,
  leavingUserId: string,
  open: readonly OpenTask[],
  choice: OpenTasksChoice | undefined,
): void {
  if (open.length === 0) return;

  // What the caller is shown, in the `409` and the `422` alike: keys only in
  // spaces they may read, and `hidden` for the rest.
  const readable = (t: OpenTask): boolean =>
    can(withProject(actor, t.projectId), 'project.read', { projectId: t.projectId });

  if (choice === undefined) {
    const shown = open.filter(readable);
    throw new ApiError(
      'conflict',
      `They hold ${String(open.length)} open task${open.length === 1 ? '' : 's'}; say whether to unassign or reassign them`,
      {
        reason: 'open_tasks',
        count: open.length,
        keys: shown.map((t) => t.key),
        hidden: open.length - shown.length,
      },
    );
  }

  if (choice === 'unassign') return;

  const target = choice.reassign_to;
  if (target === leavingUserId) {
    throw new ApiError('unprocessable', 'Open tasks cannot be reassigned to the person leaving', {
      field: 'open_tasks.reassign_to',
      reason: 'self',
    });
  }

  const person = db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, target))
    .get();
  if (person?.isActive !== 1) {
    throw new ApiError('unprocessable', 'Open tasks can only be reassigned to an active person', {
      field: 'open_tasks.reassign_to',
      reason: person === undefined ? 'no_such_user' : 'inactive',
    });
  }

  const refused = open.filter((t) => !canBeMentioned(db, target, t.projectId));
  if (refused.length > 0) {
    const shown = refused.filter(readable);
    throw new ApiError(
      'unprocessable',
      'That person cannot hold every one of these tasks; nothing was changed',
      {
        field: 'open_tasks.reassign_to',
        reason: 'cannot_hold',
        tasks: shown.map((t) => ({ key: t.key, reason: 'not_on_project' as const })),
        hidden: refused.length - shown.length,
      },
    );
  }
}

/**
 * Apply an already-checked choice. Runs inside the caller's transaction, so a
 * failure anywhere after it rolls these writes back with the rest.
 */
export function applyOffboardingChoice(
  db: Db,
  actor: ResolvedActor,
  leavingUserId: string,
  open: readonly OpenTask[],
  choice: OpenTasksChoice | undefined,
  now: number,
): void {
  if (open.length === 0 || choice === undefined) return;
  const to = choice === 'unassign' ? null : choice.reassign_to;

  for (const t of open) {
    db.update(tasks).set({ assigneeId: to, updatedAt: now }).where(eq(tasks.id, t.id)).run();

    appendActivity(db, {
      orgId: t.orgId,
      projectId: t.projectId,
      taskId: t.id,
      ...activityActor(actor),
      type: 'task.assigned',
      payload: { from: leavingUserId, to, via: 'offboarding' },
      now,
    });
  }
}
