import type { Task } from './tasks.ts';

/**
 * Date-only values (D-066): unix-ms at a **UTC midnight**, the shape a sprint's
 * `starts_on` has carried since §4.15 and that `due_on` / `planned_start` now
 * share. Moved here from `sprints/sprint-derive.ts` so the task view and the
 * sprint form speak one dialect; sprint-derive re-exports the two it had.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` (what `<input type="date">` speaks) → unix-ms at UTC midnight. */
export function dateInputToMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** unix-ms → `YYYY-MM-DD`, read in UTC so it round-trips `dateInputToMs`. */
export function msToDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The UTC midnight that starts the day `now` falls in. */
export function startOfUtcDay(now: number): number {
  return now - (now % DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `12 Jul 2026` — the short form a Details row shows. Read in UTC, like the value. */
export function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''} ${String(d.getUTCFullYear())}`;
}

/** `12 Jul` — a card's form, where a year is a width the footer cannot give. */
export function dateLabelShort(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''}`;
}

/**
 * Past its due date and still open.
 *
 * `done` and `cancelled` are never overdue — finished late is finished, and
 * dropped work has no date to miss. A task due **today** is not overdue until
 * tomorrow: the comparison is strict against the start of today, so the whole
 * due day counts as on time.
 */
export function isOverdue(task: Pick<Task, 'due_on' | 'status'>, now: number): boolean {
  if (task.due_on === null) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  return task.due_on < startOfUtcDay(now);
}
