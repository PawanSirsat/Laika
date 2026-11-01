import { ApiError } from './errors.ts';

/**
 * What happens to a leaving person's open tasks (D-104 item 5, LAI-986).
 *
 * Deactivating someone and removing them from a space both take it, spelled
 * the same way — `"unassign"`, or `{ reassign_to: <user id> }` — because the
 * server shares one schema between the two (`OpenTasksSchema`). Absent, the
 * server refuses `409 open_tasks` when they hold any, and that refusal is what
 * the offboarding dialog reads to ask.
 */
export type OpenTasksChoice = 'unassign' | { readonly reassign_to: string };

/** The `409`'s details: how many, the keys the caller may read, and how many not. */
export interface OpenTasksHeld {
  readonly count: number;
  readonly keys: readonly string[];
  /** Open tasks in spaces the caller cannot read — counted, never named. */
  readonly hidden: number;
}

/**
 * The `409 open_tasks` refusal, or `undefined` for any other failure.
 *
 * Read off `details` defensively: an envelope that says `open_tasks` but
 * carries no count is still that refusal, with what it did say.
 */
export function openTasksHeld(cause: unknown): OpenTasksHeld | undefined {
  if (!(cause instanceof ApiError) || cause.code !== 'conflict') return undefined;
  const details = cause.details as
    { reason?: unknown; count?: unknown; keys?: unknown; hidden?: unknown } | null | undefined;
  if (details?.reason !== 'open_tasks') return undefined;
  const keys = Array.isArray(details.keys)
    ? details.keys.filter((k): k is string => typeof k === 'string')
    : [];
  const hidden = typeof details.hidden === 'number' ? details.hidden : 0;
  const count = typeof details.count === 'number' ? details.count : keys.length + hidden;
  return { count, keys, hidden };
}

/**
 * Why a reassignment was refused, in words for the dialog — `422` on
 * `open_tasks.reassign_to` with `self`, `inactive`, `no_such_user` or
 * `cannot_hold` (with the tasks the person may not hold). Anything else is
 * the server's own message.
 */
export function reassignRefusal(cause: unknown): string | undefined {
  if (!(cause instanceof ApiError) || cause.code !== 'unprocessable') return undefined;
  const details = cause.details as
    { field?: unknown; reason?: unknown; tasks?: unknown } | null | undefined;
  if (details?.field !== 'open_tasks.reassign_to') return undefined;
  switch (details.reason) {
    case 'self':
      return 'Their tasks cannot go to the person who is leaving. Pick somebody else.';
    case 'inactive':
      return 'That person has been deactivated. Pick somebody active.';
    case 'no_such_user':
      return 'That person no longer exists. Pick somebody else.';
    case 'cannot_hold': {
      const keys = Array.isArray(details.tasks)
        ? details.tasks
            .map((t) => (t as { key?: unknown }).key)
            .filter((k): k is string => typeof k === 'string')
        : [];
      return keys.length === 0
        ? 'That person cannot hold every one of these tasks. Nothing was changed.'
        : `That person is not in the space of ${keys.join(', ')}, so cannot hold ${keys.length === 1 ? 'it' : 'them'}. Nothing was changed.`;
    }
    default:
      return cause.message;
  }
}

/** `3 open tasks: LC-1, LC-2 and 1 in a space you cannot see`. */
export function heldSummary(held: OpenTasksHeld): string {
  const noun = `${String(held.count)} open task${held.count === 1 ? '' : 's'}`;
  const parts = [...held.keys];
  if (held.hidden > 0) {
    parts.push(
      `${String(held.hidden)} in ${held.hidden === 1 ? 'a space' : 'spaces'} you cannot see`,
    );
  }
  if (parts.length === 0) return noun;
  const last = parts.pop();
  return `${noun}: ${parts.length === 0 ? (last ?? '') : `${parts.join(', ')} and ${last ?? ''}`}`;
}
