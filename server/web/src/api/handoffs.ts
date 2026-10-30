import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * A task's checkpoints and hand-off offers (SPEC §4.70 – §4.73, §6.4; the
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

/** One changed file in a save: names and line counts only (§4.70). */
export interface CheckpointManifestEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

/** The structured continuation note (§4.70, D-115 item 3). */
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

/** `PERSON_INBOX_VIEWS`: the Inbox's four Hand-offs filters (LAI-1009). */
export const PERSON_INBOX_VIEWS = ['received', 'sent', 'needs_approval', 'recovery'] as const;
export type PersonInboxView = (typeof PERSON_INBOX_VIEWS)[number];

/**
 * `HandoffNextAction`: what the server says the reader can do now. A hint for
 * the screen, never a permission — every write asks `can()` again.
 */
export type HandoffNextAction =
  | 'approve'
  | 'name_receiver'
  | 'accept_with_your_agent'
  | 'cancel'
  | 'wait_for_approval'
  | 'wait_for_receiver'
  | 'none';

/** An agent as a person's inbox names it: `SelectedAgentView`. */
export interface PersonHandoffAgent {
  readonly id: string;
  readonly display_name: string;
  readonly harness: string;
  readonly device_label: string | null;
  readonly status: 'active' | 'revoked';
  readonly owner: { readonly id: string; readonly name: string };
}

/** The save an inbox row carries, as it is now: its commit, verification and when it was saved. */
export interface PersonHandoffCheckpoint {
  readonly commit_sha: string;
  readonly verification: string;
  readonly saved_at: number;
}

/** `PersonHandoffView` in `server/src/services/handoffs.ts`: one row of a person's inbox. */
export interface PersonHandoffView {
  readonly id: string;
  readonly kind: 'handoff' | 'recovery';
  /** A live offer past `expires_at` reads `expired`. */
  readonly state: HandoffOfferState;
  readonly task_id: string;
  readonly task_key: string;
  readonly task_title: string;
  readonly project_id: string;
  readonly project_slug: string;
  /** The agent whose claim the work moves from: the sender's, or the expired one. */
  readonly from_agent: PersonHandoffAgent | null;
  /** Null for an unnamed recovery, which any eligible agent may take. */
  readonly to_agent: PersonHandoffAgent | null;
  readonly checkpoint_id: string | null;
  /** The checkpoint as it is now, or null once retention removed it. */
  readonly checkpoint: PersonHandoffCheckpoint | null;
  /** The sender's reason. Untrusted (D-115 item 7): drawn as text. */
  readonly reason: string | null;
  readonly requires_approval: boolean;
  readonly approved: boolean;
  readonly approved_at: number | null;
  readonly expires_at: number | null;
  readonly closed_reason: HandoffClosedReason | null;
  readonly created_at: number;
  readonly closed_at: number | null;
  readonly next_action: HandoffNextAction;
}

/** Each view's live, unexpired count, as the server counts it for the reader. */
export type PersonInboxCounts = Readonly<Record<PersonInboxView, number>>;

/** `PersonHandoffInbox`: one view's page and every view's count. */
export interface PersonHandoffInbox {
  readonly data: readonly PersonHandoffView[];
  readonly next_cursor: string | null;
  readonly counts: PersonInboxCounts;
}

export interface PersonInboxQuery {
  readonly view: PersonInboxView;
  /** Closed and expired offers too; `counts` never includes them. */
  readonly includeClosed?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

/**
 * A signed-in person's hand-offs (`GET /handoff-offers`, LAI-1009): one view,
 * newest first, across every space they may read, with every view's count.
 */
export function listPersonHandoffs(
  query: PersonInboxQuery,
  signal?: AbortSignal,
): Promise<PersonHandoffInbox> {
  const params = new URLSearchParams({ view: query.view });
  if (query.includeClosed === true) params.set('include_closed', 'true');
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  return request<PersonHandoffInbox>(
    `/handoff-offers?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

/** `HandoffPolicyView` in `server/src/services/handoffs.ts`: a space's hand-off policy (§4.74). */
export interface HandoffPolicyWire {
  readonly project_id: string;
  readonly allow_other_owners: boolean;
  readonly cross_owner_requires_approval: boolean;
  readonly max_handoffs: number;
  readonly offer_ttl_minutes: number;
  readonly updated_by: string | null;
  /** `false` when the space never set one and these are the defaults. */
  readonly is_set: boolean;
}

/** What `PUT /projects/:slug/handoff-policy` takes — the four settings. */
export type HandoffPolicyInput = Pick<
  HandoffPolicyWire,
  'allow_other_owners' | 'cross_owner_requires_approval' | 'max_handoffs' | 'offer_ttl_minutes'
>;

/**
 * §4.74's bounds, as the server enforces them (`HANDOFF_POLICY_LIMITS`): an
 * integer outside either is `422`. The policy's `GET` does not serve them, so
 * they are read from SPEC §4.74 by `handoff-policy.test.ts` and kept equal.
 */
export const HANDOFF_POLICY_BOUNDS = {
  maxHandoffs: { min: 0, max: 20 },
  offerTtlMinutes: { min: 5, max: 1440 },
} as const;

/** A space's hand-off policy; one the space never set reads as the defaults. Readable by every reader of the space. */
export function getHandoffPolicy(slug: string, signal?: AbortSignal): Promise<HandoffPolicyWire> {
  return request<HandoffPolicyWire>(
    `/projects/${encodeURIComponent(slug)}/handoff-policy`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Set it — a lead's (`project.handoff_policy.edit`). **The server writes the
 * whole row from the defaults plus what it is sent** (§6.4), not from the row
 * before, so every call sends all four settings: one left out would quietly
 * reset to its default.
 */
export function putHandoffPolicy(
  slug: string,
  policy: HandoffPolicyInput,
): Promise<HandoffPolicyWire> {
  return request<HandoffPolicyWire>(`/projects/${encodeURIComponent(slug)}/handoff-policy`, {
    method: 'PUT',
    body: {
      allow_other_owners: policy.allow_other_owners,
      cross_owner_requires_approval: policy.cross_owner_requires_approval,
      max_handoffs: policy.max_handoffs,
      offer_ttl_minutes: policy.offer_ttl_minutes,
    },
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
