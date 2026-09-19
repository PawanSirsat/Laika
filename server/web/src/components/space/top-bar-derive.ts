import { PRIORITIES, type TaskPriority } from '../../api/tasks.ts';
import type { PresenceEntry } from '../../api/presence.ts';

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
 * How many **agent** sessions are live in this space.
 *
 * The design's `Agents 2`. Counted from presence rather than from tasks: the
 * question is who is working now, not what was authored by an agent, and
 * `is_agent` is the server's own answer (§4.2).
 */
export function agentCount(present: readonly PresenceEntry[] | undefined): number {
  return present === undefined ? 0 : present.filter((entry) => entry.is_agent).length;
}
