import type { AgentClient } from './agent-clients.ts';
import { request } from './client.ts';

/**
 * One person's activity per day — the profile's heatmap (SPEC §6.4, D-079,
 * LAI-751).
 *
 * **Owners and admins, signed in**, exactly the profile's rule: the screen
 * asks only where it already shows the profile. One request per person and
 * range, through the shared GET cache (`client.ts`), so switching between
 * 12 weeks and a year and back asks once each.
 *
 * Every type mirrors `services/people-activity.ts`; `view-type-drift.test.ts`
 * holds the two in step.
 */

export const ACTIVITY_RANGES = ['12w', '52w'] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export interface ActivitySeries {
  /** Distinct commits on a remote; `null` while Developer insights are off (LAI-963). */
  readonly github: readonly number[] | null;
  readonly local_commits: readonly number[] | null;
  readonly prompts: readonly number[] | null;
  readonly sessions: readonly number[] | null;
  /** Board actions on a web session — always there. */
  readonly board_self: readonly number[];
  /** Board actions with their tokens — always there. */
  readonly board_agent: readonly number[];
}

export interface PeopleActivity {
  readonly range: ActivityRange;
  /** `YYYY-MM-DD`; every series has one integer per day from here to `end`. */
  readonly start: string;
  readonly end: string;
  readonly tz: string;
  readonly sharing: { readonly org_enabled: boolean; readonly enabled: boolean };
  readonly series: ActivitySeries;
  /** Days with prompts only. */
  readonly prompts_by_agent: Readonly<Record<string, Partial<Record<AgentClient, number>>>>;
  readonly agents: readonly AgentClient[];
}

export function getPeopleActivity(
  userId: string,
  range: ActivityRange,
  signal?: AbortSignal,
): Promise<PeopleActivity> {
  return request<PeopleActivity>(
    `/people/${encodeURIComponent(userId)}/activity?range=${range}`,
    signal === undefined ? {} : { signal },
  );
}
