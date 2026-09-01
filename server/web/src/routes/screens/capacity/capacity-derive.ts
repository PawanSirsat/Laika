import type { CapacityEntry } from '../../../api/presence.ts';

/**
 * Capacity's client-side derivations — **all of them about presentation**.
 *
 * Nothing here computes a figure the API did not send. `active_sessions`,
 * `in_progress_tasks`, `oldest_in_progress_ms` and `unlisted` arrive decided
 * (LAI-439 AC7); what is missing is only how to say them.
 */

/**
 * `4h`, `3d`, `just now` — the age of the oldest in-progress task.
 *
 * Coarse, because the number answers *"has this been sitting?"* and a
 * minute-accurate figure on a three-day-old task implies a precision nobody
 * needs. `null` in means `undefined` out: **a person with nothing in progress
 * has no age, and `0` would read as "started this instant"**.
 */
export function oldestAge(ms: number | null): string | undefined {
  if (ms === null) return undefined;
  // Server clock, browser clock; a hair either side of zero is normal.
  const elapsed = Math.max(0, ms);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(elapsed / 86_400_000))}d`;
}

/**
 * Who to hand the next task to, best first.
 *
 * **A ranking, not a score** — it reorders what the server sent and invents no
 * number. Fewest in-progress first, then fewest awaiting review, then the person
 * whose oldest task is youngest, then name so the order is stable.
 */
export function byAvailability(people: readonly CapacityEntry[]): readonly CapacityEntry[] {
  return [...people].sort((a, b) => {
    if (a.in_progress_tasks.length !== b.in_progress_tasks.length) {
      return a.in_progress_tasks.length - b.in_progress_tasks.length;
    }
    if (a.tasks_in_review.length !== b.tasks_in_review.length) {
      return a.tasks_in_review.length - b.tasks_in_review.length;
    }
    const aOld = a.oldest_in_progress_ms ?? 0;
    const bOld = b.oldest_in_progress_ms ?? 0;
    if (aOld !== bOld) return aOld - bOld;
    return a.name.localeCompare(b.name);
  });
}

/** Every task id the screen has to resolve, deduped across people. */
export function taskIdsToResolve(people: readonly CapacityEntry[]): readonly string[] {
  const ids = new Set<string>();
  for (const person of people) {
    for (const id of person.in_progress_tasks) ids.add(id);
    for (const id of person.tasks_in_review) ids.add(id);
  }
  return [...ids];
}
