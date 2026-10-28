import type { ActivityEvent } from '../../api/activity.ts';
import {
  agentDevice,
  selectedHarness,
  UNNAMED_AGENT,
  type AgentNaming,
  type SelectedAgent,
} from '../../api/selected-agent.ts';
import type { TaskSummary } from '../../api/tasks.ts';
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
 * **What is not here, and why.** *Working* means a session holds the claim
 * **and is checking in**; *Connection lost* means it stopped. Both need the
 * live claim and its session's `last_heartbeat_at` / `connection`, which no
 * task read returns yet — `TaskView` carries no claim, and heartbeats write no
 * activity. LAI-568 asks CORE to serve them. Until then neither is derived:
 * a "Working" read off an old activity row would say an agent is checking in
 * when nothing says so.
 */

/** Statuses an agent's claim has not reached yet. */
const NOT_STARTED: ReadonlySet<string> = new Set(['backlog', 'todo']);

/** The card's one state, or `null` for none. */
export function cardExecutionState(
  task: Pick<TaskSummary, 'status' | 'selected_agent'>,
): ExecutionState | null {
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

  if (event.type === 'task.claim_expired' && typeof p.generation === 'number') {
    return {
      kind: 'expired',
      generation: p.generation,
      sessionId: str(p.session_id),
      agentId: str(p.agent_id) ?? agentId,
      at: event.created_at,
    };
  }
  if (event.type === 'task.claim_reclaimed' && typeof p.generation === 'number') {
    return {
      kind: 'reclaimed',
      generation: p.generation,
      sessionId: str(p.session_id),
      agentId: str(p.agent_id) ?? agentId,
      at: event.created_at,
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
      sessionId: null,
      agentId,
      at: event.created_at,
    };
  }
  if (event.type === 'task.updated' && p.field === 'claim') {
    const to = record(p.to);
    if (typeof to.generation !== 'number') return undefined;
    return {
      kind: 'taken',
      generation: to.generation,
      sessionId: str(to.session_id),
      agentId,
      at: event.created_at,
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
 * The task's claim history, whatever order the rows arrive in — the feed is
 * newest first, and a test may hand them oldest first.
 */
export function claimHistory(events: readonly ActivityEvent[]): ClaimHistory {
  const ordered = [...events].sort(
    (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let state: ClaimHistory = { kind: 'none' };
  for (const event of ordered) {
    const fact = claimFactOf(event);
    if (fact !== undefined) {
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
}

export function executionView(
  task: Pick<TaskSummary, 'status' | 'selected_agent'>,
  activity: readonly ActivityEvent[],
  agents: ReadonlyMap<string, AgentNaming>,
): ExecutionView {
  const selected = task.selected_agent ?? null;
  const history = claimHistory(activity);
  const fact = history.kind === 'none' ? undefined : history.fact;
  const named = fact?.agentId == null ? undefined : agents.get(fact.agentId);
  return {
    state: cardExecutionState(task),
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
            sessionId: fact.sessionId,
          },
    claimExpired: history.kind === 'expired',
    generation: fact?.generation ?? null,
  };
}

/**
 * Whether the drawer's panel has anything to add: a claim on record. An agent
 * picked and not yet taken is the Agent row's to say (LAI-538), with its
 * *Waiting for agent* line; the panel draws the intended agent only beside the
 * one that actually took the work.
 */
export function hasExecution(view: ExecutionView): boolean {
  return view.claim !== undefined;
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
