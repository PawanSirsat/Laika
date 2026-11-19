import { ApiError } from '../../../api/errors.ts';

/**
 * **Archiving a task, and Trash, in words** (LAI-1353, LAI-1354): what the
 * toasts, the drawer's banners, the confirm and the two shelves say. One
 * place, so they agree, and pure, so `archive-model.test.ts` reads every
 * sentence.
 *
 * An archived task is put away **whole**: off every board, list and queue,
 * read-only, its history kept, and its subtasks with it. Restore puts it
 * back exactly as it was. A deleted task goes to the space's Trash the same
 * way, restorable for {@link TRASH_DAYS} days.
 */

/** The toast after Archive: the key, and that its subtasks went too when it had any. */
export function archivedToast(key: string, subtasks: number): string {
  if (subtasks === 0) return `${key} archived`;
  return `${key} and ${String(subtasks)} ${subtasks === 1 ? 'subtask' : 'subtasks'} archived`;
}

/** The toast after the List's bulk Archive: how many went. */
export function bulkArchivedToast(count: number): string {
  return `${String(count)} ${count === 1 ? 'task' : 'tasks'} archived`;
}

/** The toast after Restore, or after Undo of an Archive. */
export function restoredToast(key: string): string {
  return `${key} is back on the board`;
}

/** `3 Dec`, or `3 Dec 2025` when it is not this year — the board's short date. */
function dayLabel(at: number, now: number): string {
  const when = new Date(at);
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return when.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * The drawer's banner on an archived task: who and when, then what that
 * means — `Archived by Ada on 3 Dec. It is read-only until it is restored.`
 * A name the reader cannot resolve is left out rather than shown as an id.
 */
export function archivedBanner(archivedAt: number, by: string | undefined, now: number): string {
  const who = by === undefined || by === '' ? '' : ` by ${by}`;
  return `Archived${who} on ${dayLabel(archivedAt, now)}. It is read-only until it is restored.`;
}

/** A row of the Archived list: `Ada · 3 Dec`, or the date alone. */
export function archivedRowMeta(archivedAt: number, by: string | undefined, now: number): string {
  const day = dayLabel(archivedAt, now);
  return by === undefined || by === '' ? day : `${by} · ${day}`;
}

/** What was being done when the server refused it. */
export type ShelfAction = 'archive' | 'restore' | 'delete' | 'purge';

const REFUSED: Readonly<Record<ShelfAction, string>> = {
  archive: 'The task could not be archived.',
  restore: 'The task could not be restored.',
  delete: 'The task could not be moved to Trash.',
  purge: 'The task could not be deleted.',
};

/**
 * What to say when Archive, Delete or a Restore is refused. The server's
 * reasons first (a parent still put away, a signed-in-only action), then its
 * own sentence, then a plain fallback — never a status code.
 */
export function archiveRefusal(cause: unknown, action: ShelfAction): string {
  if (cause instanceof ApiError) {
    const reason = (cause.details as { reason?: unknown } | undefined)?.reason;
    if (reason === 'parent_archived')
      return 'Its parent task is archived. Restore the parent first.';
    if (reason === 'parent_deleted')
      return 'Its parent task is in Trash. Restore the parent first.';
    if (cause.message !== '') return cause.message;
  }
  return REFUSED[action];
}

/* ---------------------------------------------------------------- Trash */

/**
 * How long a task stays restorable in Trash (§6.4, LAI-1354); the server's
 * daily job scrubs it after (LAI-1355). The server's figure, said here
 * because the shelf counts the days down.
 */
export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;

/** Whole days left to restore it: {@link TRASH_DAYS} the day it went, never below 0. */
export function trashDaysLeft(deletedAt: number, now: number): number {
  return Math.max(0, TRASH_DAYS - Math.floor((now - deletedAt) / DAY_MS));
}

/** `27 days left`, `1 day left`, or `last day` when none is. */
export function daysLeftLabel(days: number): string {
  if (days <= 0) return 'last day';
  return `${String(days)} ${days === 1 ? 'day' : 'days'} left`;
}

/** The toast after Delete: the key, and its subtasks when it had any. */
export function trashedToast(key: string, subtasks: number): string {
  if (subtasks === 0) return `${key} moved to Trash`;
  return `${key} and ${String(subtasks)} ${subtasks === 1 ? 'subtask' : 'subtasks'} moved to Trash`;
}

/** The List's bulk Delete: how many went. */
export function bulkTrashedToast(count: number): string {
  return `${String(count)} ${count === 1 ? 'task' : 'tasks'} moved to Trash`;
}

/** After a restore from Trash: back on the board, or back in the archive it came from. */
export function untrashedToast(key: string, stillArchived: boolean): string {
  return stillArchived ? `${key} is back in the archive` : restoredToast(key);
}

/** The confirm before Delete: what goes, and that it can come back. */
export function deleteConfirm(
  key: string,
  subtasks: number,
): { readonly title: string; readonly body: string } {
  const withThem =
    subtasks === 0
      ? ''
      : ` with its ${String(subtasks)} ${subtasks === 1 ? 'subtask' : 'subtasks'}`;
  return {
    title: `Move ${key} to Trash?`,
    body: `It leaves the board${withThem}. You can restore it from Trash for ${String(TRASH_DAYS)} days.`,
  };
}

/**
 * The confirm before *Delete now* (LAI-1355): what goes for good, what stays,
 * and that nothing brings it back.
 */
export function purgeConfirm(
  key: string,
  subtasks: number,
): { readonly title: string; readonly body: string } {
  const withThem =
    subtasks === 0
      ? ''
      : `, and its ${String(subtasks)} ${subtasks === 1 ? 'subtask' : 'subtasks'} with it`;
  return {
    title: `Delete ${key} for good?`,
    body: `Its title, description, comments and files are erased now${withThem}, and it cannot be restored. Its key, history and logged time stay.`,
  };
}

/** The toast after *Delete now*: no Undo, because there is none. */
export function purgedToast(key: string, subtasks: number): string {
  if (subtasks === 0) return `${key} deleted for good`;
  return `${key} and ${String(subtasks)} ${subtasks === 1 ? 'subtask' : 'subtasks'} deleted for good`;
}

/** The bulk bar's confirm, in place: `Move 3 tasks to Trash?` */
export function bulkDeleteQuestion(count: number): string {
  return `Move ${String(count)} ${count === 1 ? 'task' : 'tasks'} to Trash?`;
}

/**
 * The drawer's banner on a task in Trash: who, when, how long is left, and
 * that it is read-only.
 */
export function trashBanner(deletedAt: number, by: string | undefined, now: number): string {
  const who = by === undefined || by === '' ? '' : ` by ${by}`;
  const left = trashDaysLeft(deletedAt, now);
  return `Moved to Trash${who} on ${dayLabel(deletedAt, now)} — ${daysLeftLabel(left)} to restore it. It is read-only.`;
}

/** A row of the Trash: `Ada · 3 Dec · 27 days left`. */
export function trashRowMeta(deletedAt: number, by: string | undefined, now: number): string {
  return `${archivedRowMeta(deletedAt, by, now)} · ${daysLeftLabel(trashDaysLeft(deletedAt, now))}`;
}
