/**
 * "Who is working on what, right now."
 *
 * **No API.** The `heartbeats` table exists and is migrated — `user_id`,
 * `token_id`, `repo`, `branch`, `matched_task_id` — but it has **no reader, no
 * writer and no route**. It is an empty table. The only mention outside the
 * schema is a rate-limit path prefix reserving budget for an endpoint that was
 * never built.
 *
 * Replace with: `GET /api/v1/presence` (or whatever LAI-207 settles on).
 *
 * Keyed off real people from `GET /users` so the faces and colours are genuine
 * even though the activity is not — a presence strip full of invented names
 * would be harder to read past than one showing real colleagues.
 */
import { DEMO_ENABLED } from './enabled.ts';

export type PresenceState = 'live' | 'active' | 'idle' | 'away';

export interface DemoPresence {
  readonly state: PresenceState;
  /** `laika-core · LAI-142`, or `last seen 2h` when away. */
  readonly where: string;
  /** An agent session is streaming under this person right now. */
  readonly agentLive: boolean;
}

const PATTERN: readonly Omit<DemoPresence, 'where'>[] = [
  { state: 'live', agentLive: true },
  { state: 'live', agentLive: true },
  { state: 'active', agentLive: false },
  { state: 'idle', agentLive: false },
  { state: 'away', agentLive: false },
];

const WHERE: readonly string[] = [
  'laika-core · working',
  'laika-web · working',
  'laika-core · working',
  'idle 12m',
  'last seen 2h',
];

/** Assigns each person a slot in the design's pattern, in list order. */
export function demoPresenceFor(index: number): DemoPresence | undefined {
  // D-032: off unless deliberately enabled — see `demo/enabled.ts`.
  if (!DEMO_ENABLED) return undefined;

  const slot = PATTERN[index % PATTERN.length];
  if (slot === undefined) return undefined;
  return { state: slot.state, agentLive: slot.agentLive, where: WHERE[index % WHERE.length] ?? '' };
}

export function demoPresenceNote(people: number, agents: number): string {
  // D-032: off unless deliberately enabled — see `demo/enabled.ts`.
  if (!DEMO_ENABLED) return '';

  const s = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${s(agents, 'agent session')} live · ${s(people, 'person')} active`.replace(
    'persons',
    'people',
  );
}
