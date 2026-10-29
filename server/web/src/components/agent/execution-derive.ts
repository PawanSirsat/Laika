import type { ActivityEvent, ActivitySession } from '../../api/activity.ts';
import { agentLine, sessionWords } from '../../api/agent-session.ts';
import {
  agentDevice,
  agentLabel,
  selectedHarness,
  UNNAMED_AGENT,
  type AgentNaming,
  type SelectedAgent,
} from '../../api/selected-agent.ts';
import { pageClock, receivedAt } from '../../api/claim-receipt.ts';
import type { TaskLiveClaim, TaskSummary } from '../../api/tasks.ts';
import { clockTime } from '../../api/time-label.ts';
import type { ExecutionState } from './agent-states.ts';
import type { AgentChipProps } from './AgentChip.tsx';
import type { PanelAgent, PanelClaim } from './ExecutionPanel.tsx';

/**
 * What the board can say about a task's execution **from what the server
 * serves today** (LAI-543, proposal §6).
 *
 * Two sources, both real:
 *
 * 1. **The task view.** `selected_agent` (LAI-535) and the status category.
 *    An agent picked for a task that has not started is *Waiting for agent*:
 *    the work request is open and nothing has claimed it. The moment an
 *    agent's session claims it the task moves to `in_progress` (§5), so the
 *    state goes with it. A person who moves the task themselves also ends it,
 *    which understates rather than invents.
 * 2. **The task's activity.** A claim is recorded on the row that took it
 *    (`task.status_changed` with `via: 'claim'` and `claim_generation`, or
 *    `task.updated` with `field: 'claim'`), and LAI-541's two verbs record it
 *    lapsing and being taken back. That is a **history**, not a heartbeat.
 *
 * 3. **The live claim** (LAI-568, LAI-597). Every task read carries `claim` —
 *    the task's `active` or `paused` claim, its session's `last_heartbeat_at`,
 *    and `suspect_after_ms` — or null. A claim checking in is *Working*; one
 *    whose heartbeat is `suspect_after_ms` old, or that the server already
 *    served `suspect`, is *Connection lost*. **Heartbeats write no activity**,
 *    so nothing re-reads the task when a session goes quiet: the claim is
 *    aged from the server's own age of it plus the time elapsed on this page
 *    ({@link heartbeatAge}), and a card left open moves from one to the other
 *    without a request.
 *
 * A claim null or absent — a view served before LAI-568 — is the answer from
 * the first two sources, unchanged.
 */

/** Statuses an agent's claim has not reached yet. */
const NOT_STARTED: ReadonlySet<string> = new Set(['backlog', 'todo']);

/**
 * **The browser's clock is never compared with the server's** (LAI-597
 * review). A browser five minutes ahead would call every fresh claim lost, one
 * behind would keep a dead one *Working* for five minutes too long. So a claim
 * is aged by two numbers that each come from one clock:
 *
 * - `heartbeat_age_ms` — the heartbeat's age **by the server's clock** when it
 *   served the read;
 * - the time elapsed **on this page's monotonic clock** (`performance.now()`)
 *   since this copy of the claim reached it.
 *
 * Each claim copy is stamped **when its response arrives**, by the request
 * client (`stampClaims` in `api/claim-receipt.ts`) — shown or hidden, drawn or not — never when a
 * screen first draws it. A re-read brings a new object, a new server age and
 * a new stamp. A copy that never came through the client (a fixture) has no
 * stamp and ages by the server's figure alone. A view from before the server
 * sent its age reads as 0 at receipt — never a guess from the wall clock.
 */

/** The heartbeat's age at `now` ({@link pageClock}): the server's age plus what elapsed here since it arrived. */
export function heartbeatAge(claim: TaskLiveClaim, now: number): number {
  const arrived = receivedAt(claim);
  return (claim.heartbeat_age_ms ?? 0) + (arrived === undefined ? 0 : Math.max(0, now - arrived));
}

/**
 * How long from `now` until this claim stops counting as checking in, or
 * `undefined` when the server already served it `suspect` — nothing left to
 * wait for. Zero once it has passed.
 */
export function msUntilSuspect(claim: TaskLiveClaim, now: number): number | undefined {
  if (claim.connection === 'suspect') return undefined;
  return Math.max(0, claim.suspect_after_ms - heartbeatAge(claim, now));
}

/**
 * Whether the live claim is checking in at `now` ({@link pageClock}). A
 * heartbeat exactly `suspect_after_ms` old is already suspect — the server's
 * own boundary (`services/claims.ts`), so the two never disagree.
 */
export function liveConnection(claim: TaskLiveClaim, now: number): 'live' | 'suspect' {
  const left = msUntilSuspect(claim, now);
  return left !== undefined && left > 0 ? 'live' : 'suspect';
}

/**
 * An age in words, as `timeLabel` words its first day — *just now*, *4 min
 * ago*, *3 h ago* — and *over a day ago* past that, because an age carries no
 * date to print.
 */
export function ageWords(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${String(Math.floor(ms / 60_000))} min ago`;
  if (ms < 86_400_000) return `${String(Math.floor(ms / 3_600_000))} h ago`;
  return 'over a day ago';
}

/**
 * The card's one state, or `null` for none.
 *
 * A live claim decides first: *Working* or *Connection lost*, at `now` on
 * {@link pageClock}. Without one, an agent picked for a task not started is
 * *Waiting for agent*.
 */
export function cardExecutionState(
  task: Pick<TaskSummary, 'status' | 'selected_agent' | 'claim'>,
  now: number = pageClock(),
): ExecutionState | null {
  const claim = task.claim ?? null;
  if (claim !== null) {
    return liveConnection(claim, now) === 'live' ? 'working' : 'connection_lost';
  }
  if (task.selected_agent?.status !== 'active') return null;
  return NOT_STARTED.has(task.status) ? 'waiting_for_agent' : null;
}

/** One claim fact, read from the row that recorded it. */
export interface ClaimFact {
  readonly kind: 'taken' | 'reclaimed' | 'expired';
  readonly generation: number;
  /** Null when the row did not name it — the status change records only the generation. */
  readonly sessionId: string | null;
  readonly agentId: string | null;
  readonly at: number;
  /**
   * What the claiming session said ran (D-118, LAI-586): the row's own
   * snapshot, or — on an expiry, which the system writes — the snapshot of
   * the take it ended. Null on a row older than the snapshot.
   */
  readonly session: ActivitySession | null;
}

/** The latest claim a task's activity records, or what ended it. */
export type ClaimHistory =
  | { readonly kind: 'none' }
  /** The last claim row is a take or a reclaim, and nothing has moved the task out of progress since. */
  | { readonly kind: 'recorded'; readonly fact: ClaimFact }
  /** The last claim row is `task.claim_expired`. Never restored by itself. */
  | { readonly kind: 'expired'; readonly fact: ClaimFact }
  /** The task left `in_progress` after its last claim, which ends it (LAI-541). */
  | { readonly kind: 'released'; readonly fact: ClaimFact };

function record(payload: unknown): Readonly<Record<string, unknown>> {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The claim this row records, if it records one. */
export function claimFactOf(event: ActivityEvent): ClaimFact | undefined {
  const p = record(event.payload);
  const agentId = event.agent_id ?? null;
  const session = event.agent_session ?? null;

  if (event.type === 'task.claim_expired' && typeof p.generation === 'number') {
    return {
      kind: 'expired',
      generation: p.generation,
      sessionId: str(p.session_id),
      agentId: str(p.agent_id) ?? agentId,
      at: event.created_at,
      session,
    };
  }
  if (event.type === 'task.claim_reclaimed' && typeof p.generation === 'number') {
    return {
      kind: 'reclaimed',
      generation: p.generation,
      sessionId: str(p.session_id),
      agentId: str(p.agent_id) ?? agentId,
      at: event.created_at,
      session,
    };
  }
  if (
    event.type === 'task.status_changed' &&
    p.via === 'claim' &&
    typeof p.claim_generation === 'number'
  ) {
    return {
      kind: 'taken',
      generation: p.claim_generation,
      sessionId: session?.id ?? null,
      agentId,
      at: event.created_at,
      session,
    };
  }
  if (event.type === 'task.updated' && p.field === 'claim') {
    const to = record(p.to);
    if (typeof to.generation !== 'number') return undefined;
    return {
      kind: 'taken',
      generation: to.generation,
      sessionId: str(to.session_id) ?? session?.id ?? null,
      agentId,
      at: event.created_at,
      session,
    };
  }
  return undefined;
}

/** A status change that takes the task out of progress, which releases a claim. */
function leavesProgress(event: ActivityEvent): boolean {
  if (event.type !== 'task.status_changed') return false;
  const p = record(event.payload);
  return p.from === 'in_progress' && p.to !== 'in_progress';
}

/**
 * The rows in the order they were written, oldest first, whatever order they
 * arrive in — the feed is newest first, and a test may hand them oldest first.
 *
 * **By `seq`, not by time and id.** `seq` is the server's `rowid`, strictly
 * increasing in insert order (`server/src/db/activity.ts`), so an expiry and a
 * reclaim written in the same millisecond still replay in the order they
 * happened. The row id is a ULID, random within a millisecond, so it cannot
 * break that tie (LAI-543 review). If any row arrives without a numeric `seq`,
 * the whole list falls back to `created_at` — one key for every pair, so the
 * comparison stays consistent.
 */
function inWriteOrder(events: readonly ActivityEvent[]): ActivityEvent[] {
  const bySeq = events.every((event) => typeof event.seq === 'number');
  return [...events].sort(bySeq ? (a, b) => a.seq - b.seq : (a, b) => a.created_at - b.created_at);
}

/**
 * A row with no snapshot of its own keeps the one of the claim it follows,
 * **when it is that claim** — the same generation. An expiry is the system's
 * row and carries no session; what ran is still the take's.
 */
function inheritSession(fact: ClaimFact, before: ClaimHistory): ClaimFact {
  if (fact.session !== null || before.kind === 'none') return fact;
  const prior = before.fact;
  if (prior.generation !== fact.generation || prior.session === null) return fact;
  if (fact.sessionId !== null && fact.sessionId !== prior.session.id) return fact;
  return { ...fact, session: prior.session, sessionId: fact.sessionId ?? prior.session.id };
}

/** The task's claim history, replayed in write order ({@link inWriteOrder}). */
export function claimHistory(events: readonly ActivityEvent[]): ClaimHistory {
  const ordered = inWriteOrder(events);
  let state: ClaimHistory = { kind: 'none' };
  for (const event of ordered) {
    const read = claimFactOf(event);
    if (read !== undefined) {
      const fact = inheritSession(read, state);
      state = fact.kind === 'expired' ? { kind: 'expired', fact } : { kind: 'recorded', fact };
      continue;
    }
    // Leaving progress releases a live claim, and makes an expired one old news.
    if ((state.kind === 'recorded' || state.kind === 'expired') && leavesProgress(event)) {
      state = { kind: 'released', fact: state.fact };
    }
  }
  return state;
}

/** Is this live frame one that changes what the drawer's execution panel says? */
export function changesExecution(event: Pick<ActivityEvent, 'type' | 'payload'>): boolean {
  if (event.type === 'task.claim_expired' || event.type === 'task.claim_reclaimed') return true;
  if (event.type === 'task.agent_selected' || event.type === 'task.status_changed') return true;
  return event.type === 'task.updated' && record(event.payload).field === 'claim';
}

/** A registered agent as the panel's chip draws it. */
export function panelAgentOf(agent: SelectedAgent): PanelAgent {
  return { client: selectedHarness(agent), device: agentDevice(agent), owner: agent.owner.name };
}

/** An agent this reader can name, as a chip; its owner only when it is known. */
function chipOf(agent: AgentNaming, owner: string | undefined): AgentChipProps {
  return { client: selectedHarness(agent), device: agentDevice(agent), owner };
}

const CLAIM_VERBS: Readonly<
  Record<ClaimHistory['kind'], Readonly<Record<ClaimFact['kind'], string>>>
> = {
  none: { taken: '', reclaimed: '', expired: '' },
  recorded: { taken: 'took it', reclaimed: 'reclaimed it', expired: '' },
  expired: { taken: '', reclaimed: '', expired: 'its claim expired' },
  released: {
    taken: 'took it; released when the task left In progress',
    reclaimed: 'reclaimed it; released when the task left In progress',
    expired: 'its claim expired; the task has since left In progress',
  },
};

/** What the drawer's execution panel shows, from the task and its activity. */
export interface ExecutionView {
  readonly state: ExecutionState | null;
  readonly intended: PanelAgent | null;
  readonly claim: PanelClaim | undefined;
  readonly claimExpired: boolean;
  readonly generation: number | null;
  /**
   * The session holding the live claim (LAI-597): a chip when its agent can be
   * named, else words. `undefined` when the read carried no live claim — the
   * panel then leaves the row out rather than say *No session*.
   */
  readonly session: AgentChipProps | string | undefined;
  /** Its last heartbeat, worded as of `now`: *just now*, *3 min ago*. */
  readonly lastSeen: string | undefined;
  /** Its last heartbeat, as a time, for the full date. */
  readonly lastSeenAt: number | undefined;
  /** `claim.session_id`, under Details. */
  readonly liveSessionId: string | undefined;
  /**
   * The holding agent and what its session said ran, in one line (D-118,
   * LAI-593): *Claude Code · Belka · Codex · gpt-5.5*. `undefined` when the
   * session reported neither harness nor model — the chip alone then.
   */
  readonly sessionLine: string | undefined;
  /** The holding session's self-reported harness version, under Details. */
  readonly sessionHarnessVersion: string | null;
  /** The holding session's self-reported model, under Details. */
  readonly sessionModel: string | null;
}

/** What the live claim's session said about itself, as an activity row's snapshot is read. */
function liveSnapshot(claim: TaskLiveClaim): ActivitySession {
  return {
    id: claim.session_id,
    harness: claim.harness ?? null,
    harness_version: claim.harness_version ?? null,
    model: claim.model ?? null,
  };
}

/** *Claude Code · Belka · Codex · gpt-5.5* for the live session, or `undefined`. */
function liveSessionLine(
  claim: TaskLiveClaim,
  agents: ReadonlyMap<string, AgentNaming>,
): string | undefined {
  const snapshot = liveSnapshot(claim);
  if (sessionWords(snapshot) === undefined) return undefined;
  const named = agents.get(claim.agent_id);
  const device = claim.device_label ?? null;
  const name =
    named === undefined
      ? UNNAMED_AGENT
      : agentLabel(device === null || device === '' ? named : { ...named, device_label: device });
  return agentLine(name, snapshot);
}

/**
 * The live claim's session, as a chip: its agent named by this reader, on the
 * device the session reported — the agent's own when it reported none.
 */
function liveSessionOf(
  claim: TaskLiveClaim,
  selected: SelectedAgent | null,
  agents: ReadonlyMap<string, AgentNaming>,
): AgentChipProps | string {
  const named = agents.get(claim.agent_id);
  if (named === undefined) return UNNAMED_AGENT;
  const device = claim.device_label ?? null;
  return chipOf(
    device === null || device === '' ? named : { ...named, device_label: device },
    selected !== null && selected.id === claim.agent_id ? selected.owner.name : undefined,
  );
}

export function executionView(
  task: Pick<TaskSummary, 'status' | 'selected_agent' | 'claim'>,
  activity: readonly ActivityEvent[],
  agents: ReadonlyMap<string, AgentNaming>,
  now: number = pageClock(),
): ExecutionView {
  const selected = task.selected_agent ?? null;
  const live = task.claim ?? null;
  const history = claimHistory(activity);
  const fact = history.kind === 'none' ? undefined : history.fact;
  const named = fact?.agentId == null ? undefined : agents.get(fact.agentId);
  return {
    state: cardExecutionState(task, now),
    session: live === null ? undefined : liveSessionOf(live, selected, agents),
    // Worded from its age, never from `last_heartbeat_at` against this clock.
    lastSeen: live === null ? undefined : ageWords(heartbeatAge(live, now)),
    lastSeenAt: live?.last_heartbeat_at,
    liveSessionId: live?.session_id,
    sessionLine: live === null ? undefined : liveSessionLine(live, agents),
    sessionHarnessVersion: live?.harness_version ?? null,
    sessionModel: live?.model ?? null,
    intended: selected === null ? null : panelAgentOf(selected),
    claim:
      fact === undefined || history.kind === 'none'
        ? undefined
        : {
            agent:
              named === undefined
                ? UNNAMED_AGENT
                : chipOf(
                    named,
                    selected !== null && selected.id === fact.agentId
                      ? selected.owner.name
                      : undefined,
                  ),
            verb: CLAIM_VERBS[history.kind][fact.kind],
            when: clockTime(fact.at),
            at: fact.at,
            sessionId: fact.sessionId,
            // Drawn only when the session said what ran; never a guess (D-118).
            line:
              sessionWords(fact.session) === undefined
                ? undefined
                : agentLine(named === undefined ? UNNAMED_AGENT : agentLabel(named), fact.session),
            harness: fact.session?.harness ?? null,
            harnessVersion: fact.session?.harness_version ?? null,
            model: fact.session?.model ?? null,
          },
    claimExpired: history.kind === 'expired',
    // The live claim's own, when there is one: the history may trail it.
    generation: live?.generation ?? fact?.generation ?? null,
  };
}

/**
 * Whether the drawer's panel has anything to add: a live claim, or a claim on
 * record. An agent picked and not yet taken is the Agent row's to say
 * (LAI-538), with its *Waiting for agent* line; the panel draws the intended
 * agent only beside the one that actually took the work.
 */
export function hasExecution(view: ExecutionView): boolean {
  return view.claim !== undefined || view.session !== undefined;
}

/**
 * The card's words after *Working* or *Connection lost*: the holding agent and
 * the device its session reported — *Claude Code · Belka* (D-118). Named only
 * from the task's selected agent, the one agent the card can name; a claim by
 * any other agent says its device alone, or nothing.
 */
export function liveClaimDetail(
  task: Pick<TaskSummary, 'selected_agent' | 'claim'>,
): string | undefined {
  const claim = task.claim ?? null;
  if (claim === null) return undefined;
  const device = claim.device_label ?? null;
  const selected = task.selected_agent ?? null;
  if (selected !== null && selected.id === claim.agent_id) {
    return agentLabel(
      device === null || device === '' ? selected : { ...selected, device_label: device },
    );
  }
  return device === null || device === '' ? undefined : device;
}

/**
 * The newest live frame that changes this task's execution, by `seq` — the
 * drawer re-reads its activity quietly when it moves (LAI-543), so a claim
 * that lapses while the drawer is open shows without a reload.
 */
export function executionSignal(
  recent: readonly Pick<ActivityEvent, 'seq' | 'task_id' | 'type' | 'payload'>[],
  taskId: string,
): number | undefined {
  let newest: number | undefined;
  for (const event of recent) {
    if (event.task_id !== taskId || !changesExecution(event)) continue;
    if (newest === undefined || event.seq > newest) newest = event.seq;
  }
  return newest;
}
