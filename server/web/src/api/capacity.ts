import { request } from './client.ts';

/**
 * Launcher presence and capacity pings (SPEC §4.83, §4.84; D-126, D-117a).
 * Server by LAI-1038, screens by LAI-1102.
 *
 * **Presence is a report, never a command.** A device's launcher says what it
 * is with its agent's own token; the board says `on` only for an enabled
 * report under three minutes old, and nothing here starts, stops or
 * configures a launcher. A **ping** asks the device a question; its answer
 * comes back on the ping's own request and is shown only to whoever pinged
 * and to the agent's owner — never an activity row.
 *
 * Mirrors `server/src/services/agent-capacity.ts`. `test/api/capacity.test.ts`
 * compares the six named shapes' top-level fields, both ways, and the closed
 * word lists word for word; the answer's inner levels (`HarnessReady`,
 * `AnswerBattery`, `AnswerLauncher`) are inline on the server, so no field
 * check reaches them. That comparison lives there rather than in
 * `view-type-drift.test.ts`'s `PAIRS`: the server's census still names these
 * in its `UNPAIRED` list, which is CORE's file, and a `PAIRS` entry would turn
 * that list's staleness check red until it changes too.
 */

/** What the board says of a launcher. `unknown`: it said enabled, too long ago to say now. */
export const LAUNCHER_STATES = ['on', 'off', 'unknown'] as const;
export type LauncherState = (typeof LAUNCHER_STATES)[number];

export interface AutoPickup {
  readonly work_requests: boolean;
  readonly handoffs: boolean;
}

/**
 * One agent's launcher, or a device's — the best of its active tools'
 * (§4.83). Never reported: `off`, with every other field `null`. While the
 * organisation has presence off, both times are `null` and an enabled report
 * is `unknown`.
 */
export interface Launcher {
  readonly state: LauncherState;
  readonly reported_at: number | null;
  readonly started_at: number | null;
  readonly running: number | null;
  readonly max_concurrent: number | null;
  readonly auto_pickup: AutoPickup | null;
  readonly cli_version: string | null;
}

export const BATTERY_STATES = ['ok', 'low', 'unsupported', 'unavailable'] as const;
export const MEMORY_STATES = ['normal', 'warn', 'critical', 'unsupported', 'unavailable'] as const;
export const ANSWERED_BY = ['launcher', 'session'] as const;

/** The launcher as the device itself says, in its answer. */
export type AnswerLauncher =
  | {
      readonly state: 'on';
      readonly auto_pickup: AutoPickup;
      readonly running: number;
      readonly max_concurrent: number;
    }
  | { readonly state: 'off' };

/** Its credential is saved, its command checks out, its session hooks are on. */
export interface HarnessReady {
  readonly credential: boolean;
  readonly argv: boolean;
  readonly hooks: boolean;
}

/** A reading, or the word for why there is none — never a number it did not take. */
export type AnswerBattery =
  | { readonly state: 'ok' | 'low'; readonly percent: number; readonly plugged?: boolean }
  | { readonly state: 'unsupported' | 'unavailable' };

/**
 * A device's answer (§4.84): closed and capped. A reading the device could not
 * take is a word — `unsupported`, `unavailable` — never a number.
 */
export interface CapacityAnswer {
  readonly launcher: AnswerLauncher;
  readonly harness_ready: HarnessReady;
  readonly session_live: boolean;
  readonly battery: AnswerBattery;
  readonly memory: { readonly state: (typeof MEMORY_STATES)[number] };
  readonly cli_version: string;
  readonly answered_by: (typeof ANSWERED_BY)[number];
}

export const CAPACITY_PING_STATES = ['pending', 'answered', 'expired'] as const;
export type CapacityPingState = (typeof CAPACITY_PING_STATES)[number];

/** One ping, as whoever sent it and the agent's owner read it. */
export interface CapacityPing {
  readonly id: string;
  readonly agent_id: string;
  readonly project_id: string;
  readonly task_id: string | null;
  readonly state: CapacityPingState;
  readonly requested_by: {
    readonly user_id: string;
    readonly agent_id: string | null;
  };
  readonly created_at: number;
  /** A ping takes an answer for a minute after it is made. */
  readonly expires_at: number;
  readonly answered_at: number | null;
  readonly answer: CapacityAnswer | null;
}

/** `POST /agents/:id/capacity-pings`: `created` is false for the ping a repeat inside 15 s returned. */
export interface PingResult {
  readonly ping: CapacityPing;
  readonly created: boolean;
}

/** `GET /agents/:id/capacity`: presence, and the newest answer this reader may see. */
export interface AgentCapacity {
  readonly agent_id: string;
  readonly launcher: Launcher;
  readonly latest_answer: CapacityPing | null;
  readonly now: number;
}

/**
 * Does selecting this agent start the work by itself? Only while the board
 * says its launcher is `on` **and** that launcher picks up work requests — a
 * selection is a work request (D-114 item 7, D-117a item 2). Never guessed
 * from `reported_at`: the board's word is the one the launcher acts on.
 */
export function startsOnSelect(launcher: Launcher): boolean {
  return launcher.state === 'on' && launcher.auto_pickup?.work_requests === true;
}

/**
 * How long the screens hold a ping open for its answer. Under the server's
 * ten-second cap, so the request ends on the board's word rather than a
 * proxy's.
 */
export const PING_WAIT_MS = 8_000;

/** An answer older than this is called stale (plan §4). */
export const ANSWER_STALE_MS = 5 * 60_000;

/**
 * How often a screen showing presence reads it again while it is shown
 * (plan §6) — well inside the three minutes a report stays `on`, so nothing
 * on screen says *on* long after the board stopped. It is also read again
 * when the window comes back. A re-read is quiet: it says nothing, and one
 * that fails keeps what is on screen.
 */
export const PRESENCE_REREAD_MS = 60_000;

export interface PingInput {
  /** The project's slug: a ping is asked, and refused, per project. */
  readonly project: string;
  readonly task_id?: string;
  readonly wait_ms?: number;
}

/**
 * Ask the agent's device for its capacity, held up to `wait_ms` for the
 * answer. Anyone who may not ping it here gets the same `404` as an id that
 * names no agent; too many pings are `429 rate_limited`, with the seconds to
 * wait in `details.retry_after_seconds`.
 */
export function pingAgent(
  agentId: string,
  input: PingInput,
  signal?: AbortSignal,
): Promise<PingResult> {
  return request<PingResult>(`/agents/${encodeURIComponent(agentId)}/capacity-pings`, {
    method: 'POST',
    body: input,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** One ping again — to see a late answer, or that it expired. */
export function getCapacityPing(id: string, signal?: AbortSignal): Promise<{ ping: CapacityPing }> {
  return request<{ ping: CapacityPing }>(
    `/capacity-pings/${encodeURIComponent(id)}`,
    signal === undefined ? {} : { signal },
  );
}

/** The agent's launcher and the newest answer this reader may see, in one project. */
export function getAgentCapacity(
  agentId: string,
  project: string,
  signal?: AbortSignal,
): Promise<AgentCapacity> {
  return request<AgentCapacity>(
    `/agents/${encodeURIComponent(agentId)}/capacity?project=${encodeURIComponent(project)}`,
    signal === undefined ? {} : { signal },
  );
}
