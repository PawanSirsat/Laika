import { and, count, countDistinct, eq, isNull, sum } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { tasks, timeDrafts, timeEntries } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { taskAgentMinutes } from './agent-time.ts';

/**
 * The confirmed time on one task (§6.4, LAI-1122, the intent of LAI-812): the
 * task panel's *Time logged · 2 h 10 min by 2 people*.
 *
 * **Confirmed time only.** `time_entries` holds nothing else — a draft lives
 * in `time_drafts` until its person confirms it, and is theirs alone (D-088
 * item 3), so it is never read here; a person's delete keeps the row with
 * `deleted_at`, and a deleted entry is not counted.
 *
 * **Totals, never per person.** D-088 gives per-person hours to owners and
 * admins on their own screens; a member sees project totals. So this answers
 * the minutes, how many entries, and how many people — a count, never who —
 * to anyone who may read the task (`project.read`, as the task itself is).
 *
 * **Two figures beside it, never added to it** (the panel's *Tracked on this
 * task*, owner, 2026-11-10): the agent minutes tied to the card, which are not
 * anybody's time (D-088 item 8: minutes, never hours), and the caller's *own*
 * drafts on it, which only they read and only on a web session (D-088 item 3)
 * — `null` to a token, so a token learns nothing about anyone's drafts.
 */
export interface TaskTimeView {
  /** Every live confirmed entry on the task, summed. */
  total_minutes: number;
  /** How many distinct people those entries are from. */
  people: number;
  /** How many entries. */
  entries: number;
  /** Agent (`cli`) minutes tied to the card, every person and day — kept apart. */
  agent_minutes: number;
  /** The caller's own pending drafts on the card; `null` unless on a web session. */
  my_draft_minutes: number | null;
}

export function getTaskTime(db: Db, actor: ResolvedActor, taskId: string): TaskTimeView {
  const task = db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  assertCan(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId });

  const row = db
    .select({
      minutes: sum(timeEntries.minutes),
      people: countDistinct(timeEntries.userId),
      entries: count(),
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.taskId, task.id), isNull(timeEntries.deletedAt)))
    .get();
  // Pending only: a confirmed draft is an entry above, a dismissed one is nothing.
  const drafted = can(actor, 'time_drafts.read_own')
    ? Number(
        db
          .select({ minutes: sum(timeDrafts.minutes) })
          .from(timeDrafts)
          .where(
            and(
              eq(timeDrafts.userId, actor.userId),
              eq(timeDrafts.taskId, task.id),
              eq(timeDrafts.state, 'pending'),
            ),
          )
          .get()?.minutes ?? 0,
      )
    : null;
  return {
    // `sum` is a string, or null over no rows.
    total_minutes: Number(row?.minutes ?? 0),
    people: row?.people ?? 0,
    entries: row?.entries ?? 0,
    agent_minutes: taskAgentMinutes(db, task.id),
    my_draft_minutes: drafted,
  };
}
