import { DEMO_ENABLED } from './enabled.ts';

/**
 * The agent runtime the drawer draws and Laika does not have (D-032, LAI-284).
 *
 * The owner asked for a richer task panel and said the agentic-runtime parts
 * could be dummy. Most of what they listed turned out to be **real** and is
 * wired to the API — dependencies, watchers, the claim, the agent's name in
 * provenance, the `AGENT` badge on a comment. Three things are not, and they
 * are here:
 *
 * 1. **The claim's expiry.** `POST /tasks/:id/claim` is a compare-and-swap that
 *    sets `assignee_id` where it is null. It has **no TTL**: nothing expires a
 *    claim, and no column stores a deadline. A panel reading *"until 14:32"*
 *    would invent a promise the server never made — somebody would wait for a
 *    lock to lapse that never lapses. That is why this says the hour comes from
 *    nowhere and the screen says so too.
 * 2. **The agent's version and token scope.** `created_by_client` is real and
 *    names the client (`mira-cli`); its *version* is not stored anywhere, and
 *    the token's scope is not exposed on a task.
 * 3. **Handing work to an agent.** There is no endpoint that dispatches a task
 *    to a runtime. The button is drawn and refuses, rather than appearing to
 *    work.
 *
 * Every value is derived from the task's own id so a panel does not reshuffle
 * on each render, and `DEMO_ENABLED` keeps the whole file out of a production
 * build — `not-in-bundle.test.ts` proves it.
 *
 * Delete this file the day a task carries a claim deadline and a runtime has an
 * endpoint.
 */

/** Stable per task, so two renders agree. */
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 9973;
  return h;
}

export interface DemoClaimLock {
  /** When the claim would lapse, if claims lapsed. */
  readonly until: number;
  /** `14:32`, ready to render. */
  readonly label: string;
}

/**
 * A deadline for a claim that has none.
 *
 * `undefined` unless the task is actually claimed — a lock on an unassigned
 * task would be a second invention on top of the first.
 */
export function demoClaimLock(
  task: { readonly id: string; readonly assignee_id: string | null },
  now: number,
): DemoClaimLock | undefined {
  if (!DEMO_ENABLED) return undefined;
  if (task.assignee_id === null) return undefined;

  // 20–80 minutes out, stable per task.
  const minutes = 20 + (hash(task.id) % 60);
  const until = now + minutes * 60_000;
  /*
   * **Formatted by hand, not with `toLocaleTimeString`.**
   *
   * Its options object carries the literal `'2-digit'`, and a string literal in
   * this directory **reaches the production bundle** — `DEMO_ENABLED` is a
   * runtime value, not a build-time constant the minifier can fold, so the early
   * return above removes the *behaviour* and not the *text*.
   * `not-in-bundle.test.ts` caught exactly that. Digits and a colon are
   * everywhere in the app already, so nothing distinctive is left behind.
   */
  const at = new Date(until);
  const pad = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));
  return { until, label: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}

export interface DemoAgentBuild {
  /** `v0.4.2` — not stored anywhere. */
  readonly version: string;
  /** The token's scope, which a task does not carry. */
  readonly scope: 'full' | 'read_only';
}

/**
 * The version and scope behind a named client.
 *
 * `undefined` when there is no client to describe — `created_by_client` is
 * `null` for a browser session, and inventing a version for a person would be
 * worse than saying nothing.
 */
export function demoAgentBuild(
  createdByClient: string | null,
  taskId: string,
): DemoAgentBuild | undefined {
  if (!DEMO_ENABLED) return undefined;
  if (createdByClient === null) return undefined;

  const h = hash(taskId);
  return {
    version: `v0.${String(3 + (h % 3))}.${String(h % 9)}`,
    scope: h % 4 === 0 ? 'read_only' : 'full',
  };
}

/**
 * Whether to offer the button at all. There is no endpoint behind it.
 *
 * **The refusal's wording is not here.** A sentence in this directory is a
 * string literal in the production bundle (see the note above), and it is the
 * *screen's* explanation rather than demo data anyway — the panel owns it.
 */
export const DEMO_HANDOFF_ENABLED = DEMO_ENABLED;
