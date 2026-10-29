import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * A task's checkpoints and hand-off offers (SPEC §4.68 – §4.71, §6.4; the
 * server is LAI-545 and LAI-546, the screens LAI-549).
 *
 * **Saving, offering, accepting and declining are a registered agent's acts**
 * (§3.2): a person's session is `403 not_an_agent` on each. So the browser
 * only reads checkpoints and offers, and a person **approves** or
 * **withdraws** an offer — never accepts one on the receiver's behalf.
 *
 * Every free-text field here — the note, the reason, a branch — is untrusted
 * data (D-115 item 7): drawn as text, never as markup or an instruction.
 */

/** `CHECKPOINT_VERIFICATIONS` in `server/src/db/enums.ts`. */
export type CheckpointVerification = 'pending' | 'verified' | 'ref_deleted' | 'uncertain';

/** `CheckpointRefView` in `server/src/services/checkpoints.ts`. */
export interface CheckpointRef {
  readonly ref: string;
  readonly revision: number;
  readonly state: CheckpointVerification;
}

/** One changed file in a save: names and line counts only (§4.68). */
export interface CheckpointManifestEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

/** The structured continuation note (§4.68, D-115 item 3). */
export interface CheckpointSummary {
  readonly work_done: string;
  readonly next_step: string;
  readonly decisions: string;
  readonly open_questions: string;
  readonly failing: string;
}

/** `CheckpointView` in `server/src/services/checkpoints.ts`. */
export interface Checkpoint {
  readonly id: string;
  readonly task_id: string;
  readonly session_id: string;
  readonly agent_id: string;
  readonly claim_generation: number;
  readonly repo: string;
  readonly branch: string;
  readonly remote_ref: string;
  readonly commit_sha: string;
  readonly manifest: readonly CheckpointManifestEntry[];
  readonly summary: CheckpointSummary | null;
  readonly summary_commit_sha: string | null;
  readonly created_at: number;
  readonly verification: CheckpointVerification;
  readonly verified_at: number | null;
  /** When the newest ref was registered, while it waits; null unless `pending`. */
  readonly pending_since: number | null;
  /** Pending past the notice (§9.1.1, ten minutes), **by the server's clock**. */
  readonly pending_notice: boolean;
  /** A newer verified checkpoint on the same claim exists. Information only. */
  readonly superseded: boolean;
  readonly refs: readonly CheckpointRef[];
}

/** `HANDOFF_OFFER_KINDS`. */
export type HandoffOfferKind = 'work_request' | 'handoff' | 'recovery';

/** `HANDOFF_OFFER_STATES`. `pending_approval` and `open` are live. */
export type HandoffOfferState =
  'pending_approval' | 'open' | 'accepted' | 'declined' | 'cancelled' | 'expired';

/** `HANDOFF_CLOSED_REASONS`. */
export type HandoffClosedReason =
  'withdrawn' | 'reclaimed' | 'selection_changed' | 'task_closed' | 'agent_revoked';

/** `HandoffOfferView` in `server/src/services/handoffs.ts`. */
export interface HandoffOffer {
  readonly id: string;
  readonly task_id: string;
  readonly kind: HandoffOfferKind;
  readonly state: HandoffOfferState;
  readonly from_session_id: string | null;
  readonly from_agent_id: string | null;
  readonly from_claim_generation: number | null;
  /** Null means any eligible agent — only a recovery uses it. */
  readonly to_agent_id: string | null;
  readonly checkpoint_id: string | null;
  readonly checkpoint_commit_sha: string | null;
  /** The checkpoint as it is now, or null once retention removed it. */
  readonly checkpoint: {
    readonly commit_sha: string;
    readonly verification: string;
    readonly summary: unknown;
    readonly summary_commit_sha: string | null;
  } | null;
  readonly reason: string | null;
  readonly note_hash: string | null;
  readonly requires_approval: boolean;
  readonly approved_by_user_id: string | null;
  readonly approved_at: number | null;
  readonly expires_at: number | null;
  readonly accepted_session_id: string | null;
  readonly accepted_claim_id: string | null;
  /** The receiver's acknowledgement, not proof (D-116 item 8). */
  readonly receiver_commit_sha: string | null;
  readonly closed_reason: HandoffClosedReason | null;
  readonly created_by_user_id: string;
  readonly created_at: number;
  readonly closed_at: number | null;
}

/** Newest first, each with its refs, `verification`, `pending_since` and `superseded`. */
export function listTaskCheckpoints(
  taskId: string,
  signal?: AbortSignal,
): Promise<{ data: Checkpoint[] }> {
  return request<{ data: Checkpoint[] }>(
    `/tasks/${encodeURIComponent(taskId)}/checkpoints`,
    signal === undefined ? {} : { signal },
  );
}

/** Every offer on the task, newest first, work requests included. */
export function listTaskHandoffOffers(
  taskId: string,
  signal?: AbortSignal,
): Promise<{ data: HandoffOffer[] }> {
  return request<{ data: HandoffOffer[] }>(
    `/tasks/${encodeURIComponent(taskId)}/handoff-offers`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Approve a cross-owner offer: a person, signed in — the task's assignee or a
 * lead, **never the receiving agent's owner** (`403 approver_is_receiver`).
 * Moves it to `open`; the receiver still has to accept.
 */
export function approveHandoff(offerId: string): Promise<HandoffOffer> {
  return request<HandoffOffer>(`/handoff-offers/${encodeURIComponent(offerId)}/approve`, {
    method: 'POST',
    body: {},
  });
}

/** Withdraw a live offer. The sender's paused claim resumes. */
export function cancelHandoff(offerId: string): Promise<HandoffOffer> {
  return request<HandoffOffer>(`/handoff-offers/${encodeURIComponent(offerId)}/cancel`, {
    method: 'POST',
    body: {},
  });
}

/**
 * Every hand-off refusal's `details.reason` (SPEC §6.3, *Checkpoints and
 * hand-offs*), worded for the person who saw it. Most are an agent's and
 * never reach this page; they are worded anyway, so a reason never renders
 * raw, and `handoffs.test.ts` reads §6.3's table to keep the two the same.
 */
export const HANDOFF_REASON_WORDS: Readonly<Record<string, string>> = {
  offer_taken: 'Another agent accepted this offer first.',
  offer_closed:
    'This offer is no longer open — it was accepted, declined, withdrawn or it expired.',
  approval_pending: 'This offer is still waiting for a person to approve it.',
  checkpoint_unverified:
    'The save this offer carries is not verified, so it can be neither offered nor accepted.',
  handoff_limit: 'This task has reached the space’s limit of completed hand-offs.',
  offer_live: 'This task already has a hand-off or recovery offer waiting.',
  checkpoint_mismatch: 'The receiver checked out a different commit from the one that was saved.',
  repo_not_configured: 'This space has no repository configured, or the save names another one.',
  checkpoint_required: 'A hand-off needs a verified save to continue from.',
  checkpoint_not_this_claim: 'That save belongs to another task or an earlier claim.',
  receiver_not_eligible:
    'That agent cannot receive this task: it is revoked, lacks full access here, or another owner’s agents are not allowed.',
  approver_is_receiver:
    'You own the receiving agent, so someone else has to approve this hand-off.',
  not_an_agent: 'Only a registered agent can do that; a person approves or withdraws an offer.',
  agent_revoked: 'That agent has been revoked.',
  not_the_receiver: 'This offer is not addressed to that agent.',
  user_inactive: 'Your account has been deactivated, so this change was not made.',
  recovery_unnamed:
    'A recovery offered to any agent cannot be declined — an agent that does not want it does not accept it.',
  work_request: 'That is a work request, not a hand-off: change the task’s agent instead.',
  handoff_rate: 'Too many hand-off changes in a short time. Try again in a moment.',
};

/**
 * What a refused approve or withdraw says: the reason's words when the server
 * named one, else the server's own message, else that it never arrived.
 */
export function handoffRefusal(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The request did not reach Laika.';
  const details = cause.details;
  const reason =
    typeof details === 'object' && details !== null
      ? (details as { reason?: unknown }).reason
      : undefined;
  return typeof reason === 'string' && reason in HANDOFF_REASON_WORDS
    ? (HANDOFF_REASON_WORDS[reason] ?? cause.message)
    : cause.message;
}
