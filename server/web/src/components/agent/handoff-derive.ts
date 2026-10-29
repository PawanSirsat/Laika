import type { Checkpoint, CheckpointSummary, HandoffOffer } from '../../api/handoffs.ts';
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

/** Live offer states (§4.71). */
const LIVE: ReadonlySet<string> = new Set(['pending_approval', 'open']);

export function isLiveOffer(offer: Pick<HandoffOffer, 'state'>): boolean {
  return LIVE.has(offer.state);
}

/** What the note says about the save it travels with (§4.68). */
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
 * (§4.71, D-116 item 6).
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

/** Recovery after an expired claim (§4.71): available, or not, and why. */
export type Recovery =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly offer: HandoffOffer | undefined }
  | { readonly kind: 'unavailable'; readonly words: string };

/**
 * Only when the task's last claim **expired** and no live claim holds it. A
 * verified save makes recovery available — the server opens the offer
 * (`task.recovered`); none means a person has to act.
 */
export function recoveryOf(
  history: Pick<ClaimHistory, 'kind'>,
  liveClaim: unknown,
  rows: SaveRows,
  offers: readonly HandoffOffer[],
): Recovery {
  if (history.kind !== 'expired' || (liveClaim ?? null) !== null) return { kind: 'none' };
  const offer = offers.find((o) => o.kind === 'recovery' && isLiveOffer(o));
  if (offer !== undefined || rows.verified !== null) return { kind: 'available', offer };
  return { kind: 'unavailable', words: rows.count === 0 ? NO_CHECKPOINT : NO_VERIFIED_CHECKPOINT };
}

/**
 * The panel's state line, with the saves and offers known: *Recovery
 * available* for an expired claim with a verified save; *Save needs
 * attention* when the newest save is `uncertain` and no live claim speaks
 * first. A live claim's *Working* or *Connection lost* is never replaced.
 */
export function panelState(
  base: ExecutionState | null,
  recovery: Recovery,
  rows: SaveRows,
): ExecutionState | null {
  if (base === 'working' || base === 'connection_lost') return base;
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
