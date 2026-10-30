import type { Checkpoint, CheckpointSummary, HandoffOffer } from '../../api/handoffs.ts';
import type { TaskHandoff } from '../../api/tasks.ts';
import { agentLabel, UNNAMED_AGENT, type AgentNaming } from '../../api/selected-agent.ts';
import { clockTime } from '../../api/time-label.ts';
import {
  NO_CHECKPOINT,
  NO_VERIFIED_CHECKPOINT,
  type ExecutionState,
  type NoteState,
} from './agent-states.ts';
import { ageWords, type ClaimHistory } from './execution-derive.ts';
import type { PanelCheckpoint } from './ExecutionPanel.tsx';

/**
 * What the drawer says about a task's saves and hand-offs (LAI-549), from
 * `GET /tasks/:id/checkpoints` and `GET /tasks/:id/handoff-offers` alone.
 *
 * **Nothing here is decided by this page.** Verification is the server's,
 * from signed push notices (D-116); `pending_notice` is the server's ten
 * minutes, on its clock; an offer is accepted only when the server says
 * `accepted`. The sender's screen therefore says *Waiting for … to accept*
 * until then, and never "accepted" on the receiver's behalf.
 *
 * Plain functions, no JSX, so `node --test` pins every rule.
 */

/** Live offer states (§4.73). */
const LIVE: ReadonlySet<string> = new Set(['pending_approval', 'open']);

export function isLiveOffer(offer: Pick<HandoffOffer, 'state'>): boolean {
  return LIVE.has(offer.state);
}

/** What the note says about the save it travels with (§4.70). */
export function noteStateOf(
  checkpoint: Pick<Checkpoint, 'summary' | 'summary_commit_sha' | 'commit_sha'>,
): NoteState {
  if (checkpoint.summary === null) return 'missing';
  return checkpoint.summary_commit_sha === checkpoint.commit_sha ? 'current' : 'earlier';
}

/**
 * The save's one-line name: the first line of *work done*, or its branch when
 * the agent wrote no note. Untrusted text, drawn as text.
 */
export function checkpointTitle(checkpoint: Pick<Checkpoint, 'summary' | 'branch'>): string {
  const first = checkpoint.summary?.work_done.split('\n')[0]?.trim() ?? '';
  return first === '' ? `Saved on ${checkpoint.branch}` : first;
}

/** A checkpoint as the panel's row draws it. */
export function panelCheckpointOf(checkpoint: Checkpoint, now: number): PanelCheckpoint {
  const failing = checkpoint.summary?.failing.trim() ?? '';
  return {
    summary: checkpointTitle(checkpoint),
    age: ageWords(Math.max(0, now - checkpoint.created_at)),
    savedAt: checkpoint.created_at,
    verification: checkpoint.verification,
    pendingNotice: checkpoint.verification === 'pending' && checkpoint.pending_notice,
    note: noteStateOf(checkpoint),
    sha: checkpoint.commit_sha,
    failing: failing === '' ? undefined : failing,
  };
}

/** The saves the panel draws: the latest verified one, and a newer one not verified. */
export interface SaveRows {
  /** The newest `verified` checkpoint, or null when none is. */
  readonly verified: Checkpoint | null;
  /** The newest checkpoint, when it is newer than {@link verified} and not verified. */
  readonly newer: Checkpoint | undefined;
  /** How many the task has at all. */
  readonly count: number;
}

/**
 * From the server's list, newest first. *"Automatic recovery uses the latest
 * verified checkpoint and shows any newer one beside it as unverified"*
 * (§4.73, D-116 item 6).
 */
export function saveRows(checkpoints: readonly Checkpoint[]): SaveRows {
  const newest = [...checkpoints].sort((a, b) => b.created_at - a.created_at);
  const verified = newest.find((c) => c.verification === 'verified') ?? null;
  const head = newest[0];
  const newer =
    head !== undefined &&
    head.verification !== 'verified' &&
    (verified === null || head.created_at > verified.created_at)
      ? head
      : undefined;
  return { verified, newer, count: newest.length };
}

/** The hand-off or recovery the drawer is about: the live one, else the newest. */
export function currentOffer(offers: readonly HandoffOffer[]): HandoffOffer | undefined {
  const moves = offers
    .filter((o) => o.kind !== 'work_request')
    .sort((a, b) => b.created_at - a.created_at);
  return moves.find(isLiveOffer) ?? moves[0];
}

/** An agent this reader can name, or *a registered agent* — never a guess. */
export function offerAgentName(
  id: string | null,
  agents: ReadonlyMap<string, AgentNaming>,
): string {
  if (id === null) return 'any eligible agent';
  const named = agents.get(id);
  return named === undefined ? UNNAMED_AGENT : agentLabel(named);
}

/**
 * The offer in one line, as the server last reported it.
 *
 * - `pending_approval`: *Waiting for approval, then for … to accept*
 * - `open`: *Waiting for … to accept*
 * - `accepted`: *Accepted by …* — **only** from the server's `accepted`
 * - closed otherwise: what closed it
 */
export function offerStatusWords(
  offer: HandoffOffer,
  agents: ReadonlyMap<string, AgentNaming>,
): string {
  const to = offerAgentName(offer.to_agent_id, agents);
  const kind = offer.kind === 'recovery' ? 'Recovery offer' : 'Hand-off';
  switch (offer.state) {
    case 'pending_approval':
      return `Waiting for approval, then for ${to} to accept`;
    case 'open':
      return `Waiting for ${to} to accept`;
    case 'accepted':
      return `Accepted by ${to}`;
    case 'declined':
      return `${kind} declined by ${to}`;
    case 'expired':
      return `${kind} expired unanswered`;
    case 'cancelled':
      return offer.closed_reason === 'reclaimed'
        ? `${kind} withdrawn — the agent reclaimed the task`
        : offer.closed_reason === 'task_closed'
          ? `${kind} closed — the task left In progress`
          : offer.closed_reason === 'agent_revoked'
            ? `${kind} closed — an agent was revoked`
            : `${kind} withdrawn`;
  }
}

/** *Offer expires 14:32*, for a live offer that expires. */
export function offerExpiryWords(offer: HandoffOffer): string | undefined {
  if (!isLiveOffer(offer) || offer.expires_at === null) return undefined;
  return `Offer expires ${clockTime(offer.expires_at)}`;
}

/** Recovery after an expired claim (§4.73): available, or not, and why. */
export type Recovery =
  | { readonly kind: 'none' }
  /** The saves and offers have not been read, or the read failed: nothing is known yet. */
  | { readonly kind: 'unknown'; readonly words: string }
  | { readonly kind: 'available'; readonly offer: HandoffOffer | undefined }
  | { readonly kind: 'unavailable'; readonly words: string };

/** The state of the drawer's read of saves and offers (`useTaskHandoffs`). */
export type ReadStatus = 'idle' | 'loading' | 'ready' | 'error';

export const RECOVERY_CHECKING = 'Checking this task’s saves…';
export const RECOVERY_UNREAD =
  'Could not read this task’s saves, so whether it can be recovered is not known.';

/**
 * Only when the task's last claim **expired** and no live claim holds it. A
 * verified save makes recovery available — the server opens the offer
 * (`task.recovered`); none means a person has to act.
 *
 * **Absence is only confirmed by a read that succeeded** (LAI-549 review): a
 * read still in flight, or one that failed, is *unknown* — never *no saved
 * checkpoint*, and never a reason to offer *Release to backlog*.
 */
export function recoveryOf(
  history: Pick<ClaimHistory, 'kind'>,
  liveClaim: unknown,
  rows: SaveRows,
  offers: readonly HandoffOffer[],
  read: ReadStatus = 'ready',
): Recovery {
  if (history.kind !== 'expired' || (liveClaim ?? null) !== null) return { kind: 'none' };
  if (read !== 'ready') {
    return { kind: 'unknown', words: read === 'error' ? RECOVERY_UNREAD : RECOVERY_CHECKING };
  }
  const offer = offers.find((o) => o.kind === 'recovery' && isLiveOffer(o));
  if (offer !== undefined || rows.verified !== null) return { kind: 'available', offer };
  return { kind: 'unavailable', words: rows.count === 0 ? NO_CHECKPOINT : NO_VERIFIED_CHECKPOINT };
}

/** The two states a task's saves put on its card and its drawer (LAI-1006). */
export type HandoffState = Extract<ExecutionState, 'recovery_available' | 'save_needs_attention'>;

/**
 * The state the **server** derived (LAI-1005), read and never re-derived:
 * *Recovery available* first, then *Save needs attention*, else nothing. A
 * view served before LAI-1005 has no summary, and shows nothing.
 *
 * The card and the drawer both call this on the same task view, so they
 * cannot disagree. The server already lets a live claim speak first: neither
 * flag is set while one holds the task.
 */
export function handoffState(summary: TaskHandoff | undefined): HandoffState | null {
  if (summary === undefined) return null;
  if (summary.recovery_available) return 'recovery_available';
  if (summary.save_needs_attention) return 'save_needs_attention';
  return null;
}

/**
 * The panel's state line, with the saves and offers known: *Recovery
 * available* for an expired claim with a verified save; *Save needs
 * attention* when the newest save is `uncertain` and no live claim speaks
 * first. A live claim's *Working* or *Connection lost* is never replaced.
 *
 * With the task view's summary (LAI-1005) those two come from
 * {@link handoffState} — the card's rule — so the drawer says what the card
 * says. Without one, an older server, the drawer's own reads decide.
 */
export function panelState(
  base: ExecutionState | null,
  recovery: Recovery,
  rows: SaveRows,
  summary?: TaskHandoff,
): ExecutionState | null {
  if (base === 'working' || base === 'connection_lost') return base;
  if (summary !== undefined) return handoffState(summary) ?? base;
  if (recovery.kind === 'available') return 'recovery_available';
  if (rows.newer?.verification === 'uncertain') return 'save_needs_attention';
  return base;
}

const SUMMARY_FIELDS = [
  'work_done',
  'next_step',
  'decisions',
  'open_questions',
  'failing',
] as const;

/**
 * An offer's note as served (`checkpoint.summary`, typed `unknown` on the
 * wire): the five strings, or null. Anything else is not drawn — the note is
 * untrusted (D-115 item 7), and a shape the server never sends is not guessed.
 */
export function asSummary(value: unknown): CheckpointSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  return SUMMARY_FIELDS.every((field) => typeof record[field] === 'string')
    ? (record as unknown as CheckpointSummary)
    : null;
}

/**
 * Whether *Approve* is offered, and how (§3.2, §4.73): the task's assignee or
 * a lead, holding `task.handoff.approve`, and **never the receiving agent's
 * owner**.
 *
 * Who owns the receiver is known only from the reader's own agents. Until
 * that read has succeeded the answer is not "nobody" — so the button is
 * disabled with a reason, never enabled on a guess (LAI-549 review).
 */
export type ApproveGate =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'disabled'; readonly reason: string }
  | { readonly kind: 'enabled' };

export const APPROVE_CHECKING = 'Checking whether you own the receiving agent…';
export const APPROVE_UNREAD = 'Could not check whether you own the receiving agent.';

export function approveGate(
  offer: Pick<HandoffOffer, 'state' | 'to_agent_id'>,
  reader: {
    readonly holdsApprove: boolean;
    readonly leadsOrAssignee: boolean;
    /** The reader's own agents' ids, or the state of that read when it has not succeeded. */
    readonly ownAgents: ReadonlySet<string> | 'loading' | 'error';
  },
): ApproveGate {
  if (offer.state !== 'pending_approval') return { kind: 'hidden' };
  if (!reader.holdsApprove || !reader.leadsOrAssignee) return { kind: 'hidden' };
  // An unnamed recovery is named by the approver, which this screen does not do.
  if (offer.to_agent_id === null) return { kind: 'hidden' };
  if (reader.ownAgents === 'loading') return { kind: 'disabled', reason: APPROVE_CHECKING };
  if (reader.ownAgents === 'error') return { kind: 'disabled', reason: APPROVE_UNREAD };
  return reader.ownAgents.has(offer.to_agent_id) ? { kind: 'hidden' } : { kind: 'enabled' };
}

/** How often a quiet drawer re-reads its saves while one waits for its notice. */
export const PENDING_POLL_MS = 60_000;

/**
 * Re-read the saves while any is `pending`: the ten-minute notice
 * (`pending_notice`) and `verified` are the server's to say, and nothing else
 * re-reads a drawer nobody touches — verification writes no activity row.
 */
export function pollsForNotice(checkpoints: readonly Pick<Checkpoint, 'verification'>[]): boolean {
  return checkpoints.some((c) => c.verification === 'pending');
}
