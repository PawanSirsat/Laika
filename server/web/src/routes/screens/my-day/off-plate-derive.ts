import { DAY_MS, isOverdue, startOfUtcDay } from '../../../api/date-only.ts';
import type { TaskStatus, TaskSummary } from '../../../api/tasks.ts';

/**
 * *On your plate* while time tracking is off (LAI-1130, the audit's V2): My
 * day has no day to show, so it shows the reader's open work instead — what
 * is overdue, then what is due soon, then what is in progress, then the rest
 * — rather than a card that only leads to a setting most readers cannot
 * change.
 *
 * `GET /tasks` filters by assignee and one status, and **not by due date**,
 * so the order is made here over the rows it answered. Every figure is the
 * server's; only the order is this file's.
 */

/** The open kinds of work read, one `GET /tasks` each. `done` and `cancelled` are never on a plate. */
export const OFF_PLATE_STATUSES: readonly TaskStatus[] = [
  'in_progress',
  'review',
  'todo',
  'backlog',
];

/** How far ahead *due soon* looks, in days from the start of today (UTC, as `due_on` is). */
export const DUE_SOON_DAYS = 7;

/** At most this many rows; the rest are one link to the Work page. */
export const OFF_PLATE_CAP = 12;

export type OffPlateKind = 'overdue' | 'soon' | 'progress' | 'open';

export interface OffPlateRow {
  readonly task: TaskSummary;
  readonly kind: OffPlateKind;
}

const RANK: Readonly<Record<OffPlateKind, number>> = { overdue: 0, soon: 1, progress: 2, open: 3 };

export function offPlateKind(task: TaskSummary, now: number): OffPlateKind {
  if (isOverdue(task, now)) return 'overdue';
  if (task.due_on !== null && task.due_on < startOfUtcDay(now) + DUE_SOON_DAYS * DAY_MS) {
    return 'soon';
  }
  return task.status === 'in_progress' ? 'progress' : 'open';
}

/**
 * The reader's open tasks in plate order: overdue (earliest due first), due
 * soon (earliest first), in progress, then the rest (each most recently
 * changed first). A task listed twice is drawn once; finished work is never
 * drawn, whatever was asked.
 */
export function offPlate(tasks: readonly TaskSummary[], now: number): readonly OffPlateRow[] {
  const seen = new Set<string>();
  const rows: OffPlateRow[] = [];
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled' || seen.has(task.id)) continue;
    seen.add(task.id);
    rows.push({ task, kind: offPlateKind(task, now) });
  }
  return rows.sort((a, b) => {
    const byKind = RANK[a.kind] - RANK[b.kind];
    if (byKind !== 0) return byKind;
    if (a.kind === 'overdue' || a.kind === 'soon') {
      const byDue = (a.task.due_on ?? 0) - (b.task.due_on ?? 0);
      if (byDue !== 0) return byDue;
    }
    return b.task.updated_at - a.task.updated_at;
  });
}
