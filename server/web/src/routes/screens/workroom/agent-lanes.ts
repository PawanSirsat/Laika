import type { HandoffOffer } from '../../../api/handoffs.ts';
import type { Round } from '../../../api/review.ts';
import { agentLabel } from '../../../api/selected-agent.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import {
  ageWords,
  heartbeatAge,
  liveConnection,
  type ClaimHistory,
} from '../../../components/agent/execution-derive.ts';

/**
 * **Four lanes, never mixed** (LAI-1199; Workroom spec §1.4): who answers for
 * the task, which agent was asked, which session holds it now, and what was
 * submitted and decided. Each lane names the field it was read from, and a
 * lane with nothing behind it says so in words rather than borrowing another
 * lane's fact.
 *
 * **An agent is selected, never assigned** — the assignee is a person, and
 * no lane ever says a task is assigned to an agent.
 *
 * **`paused` is not shown.** The claim enum carries it but nothing writes it
 * that the UI can confirm, so a paused claim reads as a held one.
 */

export type LaneId = 'accountable' | 'requested' | 'executing' | 'outcome';

/**
 * - `set` — the lane has a fact.
 * - `empty` — the server said there is none.
 * - `unknown` — the read behind it failed or has not answered; no guess.
 */
export type LaneState = 'set' | 'empty' | 'unknown';

export interface Lane {
  readonly id: LaneId;
  readonly label: string;
  readonly state: LaneState;
  /** The lane's one line: a name, a state. */
  readonly value: string;
  /** A second line, when there is one. */
  readonly detail?: string | undefined;
  /** Where the lane's fact comes from, for the reader who asks. */
  readonly source: string;
  /** A tone for the dot: `live`, `warn`, `done`, `bad` or none. */
  readonly tone?: 'live' | 'warn' | 'done' | 'bad' | undefined;
}

export const LANE_LABELS: Readonly<Record<LaneId, string>> = {
  accountable: 'Accountable',
  requested: 'Requested',
  executing: 'Executing',
  outcome: 'Outcome',
};

export interface LaneInput {
  readonly task: Pick<
    TaskSummary,
    'assignee_id' | 'status' | 'selected_agent' | 'claim' | 'send_back'
  >;
  /** A member's name, or `undefined` when the reader cannot see them. */
  readonly personName: (userId: string) => string | undefined;
  /** The task's offers, or `undefined` while unread or unreadable. */
  readonly offers: readonly HandoffOffer[] | undefined;
  /** What the task's activity says of its claims, or `undefined` while unread. */
  readonly history: ClaimHistory | undefined;
  /** The rounds, newest first, or `undefined` while unread. */
  readonly rounds: readonly Round[] | undefined;
  /** The rounds read failed. */
  readonly roundsFailed: boolean;
  /** The reader's clock, for heartbeat age. */
  readonly now: number;
}

function accountable(input: LaneInput): Lane {
  const base = { id: 'accountable', label: LANE_LABELS.accountable, source: 'Assignee' } as const;
  const id = input.task.assignee_id;
  if (id === null) return { ...base, state: 'empty', value: 'No one yet' };
  return { ...base, state: 'set', value: input.personName(id) ?? 'A member you cannot see' };
}

function requested(input: LaneInput): Lane {
  const base = { id: 'requested', label: LANE_LABELS.requested, source: 'Selected agent' } as const;
  const agent = input.task.selected_agent ?? null;
  if (agent === null) return { ...base, state: 'empty', value: 'No agent selected' };
  const name = agent.display_name ?? agentLabel(agent);
  if (agent.status === 'revoked') {
    return {
      ...base,
      state: 'set',
      value: name,
      detail: 'Selected · its access is revoked',
      tone: 'bad',
    };
  }
  const request = (input.offers ?? [])
    .filter((o) => o.kind === 'work_request' && o.to_agent_id === agent.id)
    .sort((a, b) => b.created_at - a.created_at)[0];
  const detail =
    request?.state === 'pending_approval'
      ? 'Selected · the work request waits for approval'
      : request?.state === 'open'
        ? 'Selected · work request open'
        : 'Selected';
  return {
    ...base,
    state: 'set',
    value: name,
    detail,
    source: request === undefined ? base.source : 'Selected agent and its work request',
    ...(request?.state === 'pending_approval' ? { tone: 'warn' as const } : {}),
  };
}

function executing(input: LaneInput): Lane {
  const base = { id: 'executing', label: LANE_LABELS.executing, source: 'Live claim' } as const;
  const claim = input.task.claim ?? null;
  if (claim !== null) {
    const live = liveConnection(claim, input.now) === 'live';
    // The server's age plus what elapsed here — the drawer's own rule.
    const heard = heartbeatAge(claim, input.now);
    return {
      ...base,
      state: 'set',
      value: live ? 'Working' : 'Connection lost',
      detail: `Claim ${String(claim.generation)} · last heard ${ageWords(heard)}`,
      tone: live ? 'live' : 'warn',
    };
  }
  const history = input.history;
  if (history === undefined) {
    return { ...base, state: 'unknown', value: 'No live claim', source: 'Live claim and activity' };
  }
  const fromActivity = { ...base, source: 'Live claim and activity' };
  switch (history.kind) {
    case 'none':
      return { ...fromActivity, state: 'empty', value: 'No agent has worked this yet' };
    case 'expired':
      return {
        ...fromActivity,
        state: 'set',
        value: 'Last claim expired',
        detail: `Claim ${String(history.fact.generation)}`,
        tone: 'warn',
      };
    case 'released':
    case 'recorded':
      return {
        ...fromActivity,
        state: 'set',
        value: 'No live claim',
        detail: `Last claim ${String(history.fact.generation)} ended`,
      };
  }
}

function outcome(input: LaneInput): Lane {
  const base = { id: 'outcome', label: LANE_LABELS.outcome, source: 'Rounds and reviews' } as const;
  if (input.rounds === undefined) {
    return input.roundsFailed
      ? { ...base, state: 'unknown', value: 'Could not read the rounds' }
      : { ...base, state: 'unknown', value: 'Reading the rounds…' };
  }
  const latest = input.rounds[0];
  if (latest === undefined) {
    if (input.task.status === 'done') {
      return {
        ...base,
        state: 'set',
        value: 'Done',
        detail: 'No round was submitted',
        tone: 'done',
      };
    }
    return { ...base, state: 'empty', value: 'Nothing submitted yet' };
  }
  const round = `Round ${String(latest.number)}`;
  if (latest.decision?.kind === 'accepted') {
    return { ...base, state: 'set', value: 'Accepted', detail: round, tone: 'done' };
  }
  if (latest.decision?.kind === 'sent_back') {
    return { ...base, state: 'set', value: 'Sent back', detail: round, tone: 'bad' };
  }
  if (input.task.status === 'review') {
    return {
      ...base,
      state: 'set',
      value: 'In review',
      detail: `${round} · waiting for a decision`,
      tone: 'warn',
    };
  }
  return { ...base, state: 'set', value: 'Submitted', detail: `${round} · not decided` };
}

/** The four lanes, in their fixed order. */
export function agentLanes(input: LaneInput): readonly Lane[] {
  return [accountable(input), requested(input), executing(input), outcome(input)];
}
