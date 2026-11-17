import { PRIORITIES, type TaskPriority } from '../../api/tasks.ts';

/**
 * The pure parts of the space top bar (LAI-251).
 *
 * Split out because this package has no renderer (CONVENTIONS §4): what can be
 * a function is a function, and the component keeps only what a browser has to
 * measure.
 */

/** How many avatars the cluster shows before it counts the rest. The design's. */
export const CLUSTER_LIMIT = 4;

export interface Cluster<T> {
  readonly shown: readonly T[];
  /** People beyond the limit, rendered as the design's `+1` in mono. */
  readonly overflow: number;
}

/**
 * The overlapping avatar cluster.
 *
 * **`+0` is never rendered**: the design shows `+1` beside four avatars because
 * it has five members, and a `+0` beside a complete list is a claim that there
 * is more to see.
 */
export function cluster<T>(members: readonly T[], limit: number = CLUSTER_LIMIT): Cluster<T> {
  return {
    shown: members.slice(0, limit),
    overflow: Math.max(0, members.length - limit),
  };
}

/**
 * The priority cycler's next value.
 *
 * Cycles **through "any" and back**, so the control can always be undone
 * without a second affordance — the design draws one button and no clear.
 * `undefined` is "any priority", which is where the cycle starts and ends.
 */
export function nextPriority(current: TaskPriority | undefined): TaskPriority | undefined {
  if (current === undefined) return PRIORITIES[0];
  const at = PRIORITIES.indexOf(current);
  // An unknown value (a hand-edited URL) behaves like "any" rather than
  // stranding the cycler on a value it cannot leave.
  if (at === -1) return PRIORITIES[0];
  return PRIORITIES[at + 1];
}

/** `Any priority` / `P1` — what the cycler reads right now. */
export function priorityLabel(current: TaskPriority | undefined): string {
  return current === undefined ? 'Any priority' : current.toUpperCase();
}

/**
 * The name of a face that filters by assignee (LAI-1193). The face shows
 * initials only, so its name is the whole of what it does — set as
 * `aria-label`, with the shorter words in its tooltip.
 */
export function memberFilterLabel(name: string, on: boolean): string {
  return on ? `Showing only ${name}'s work — press to clear` : `Show only ${name}'s work`;
}
