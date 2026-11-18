import { ApiError } from '../../../api/errors.ts';

/**
 * **Archiving a task, in words** (LAI-1353): what the toast, the drawer's
 * banner and the Archived list say. One place, so the three agree, and pure,
 * so `archive-model.test.ts` reads every sentence.
 *
 * An archived task is put away **whole**: off every board, list and queue,
 * read-only, its history kept, and its subtasks with it. Restore puts it
 * back exactly as it was.
 */

/** The toast after Archive: the key, and that its subtasks went too when it had any. */
export function archivedToast(key: string, subtasks: number): string {
  if (subtasks === 0) return `${key} archived`;
  return `${key} and ${String(subtasks)} ${subtasks === 1 ? 'subtask' : 'subtasks'} archived`;
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

/**
 * What to say when Archive or Restore is refused. The server's reasons first
 * (`parent_archived`), then its own sentence, then a plain fallback — never
 * a status code.
 */
export function archiveRefusal(cause: unknown, archiving: boolean): string {
  if (cause instanceof ApiError) {
    const reason = (cause.details as { reason?: unknown } | undefined)?.reason;
    if (reason === 'parent_archived')
      return 'Its parent task is archived. Restore the parent first.';
    if (cause.message !== '') return cause.message;
  }
  return archiving ? 'The task could not be archived.' : 'The task could not be restored.';
}
