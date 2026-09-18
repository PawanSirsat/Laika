import { request } from './client.ts';
import type { Page } from './tasks.ts';

/**
 * Meeting reviews (SPEC §10.2, §11.4.2; server by LAI-450/451/454).
 *
 * **There is no transcript** (D-056). §4.12 keeps a `transcript_hash` and never
 * the words, and D-005's *"no transcript content, ever"* is narrowed by that
 * decision to exactly one exception: **quotes are kept, the transcript is not.**
 * A quote is the sentence a proposal is accountable to; the whole meeting is not
 * needed for that and is not held for seven days waiting to be read.
 *
 * So the screen has no transcript pane to put beside the proposals, and §11.4.2's
 * *"transcript on one side"* is the line D-056 changed.
 */

export const PROPOSAL_KINDS = ['new', 'change', 'dead', 'decision'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type MeetingReviewStatus = 'pending' | 'applied' | 'discarded' | 'expired';

export interface ProposalView {
  readonly id: string;
  readonly kind: ProposalKind;
  /** The display key this concerns, for `change` and `dead`. */
  readonly task: string | null;
  readonly title: string | null;
  readonly description: string | null;
  /** Free-form for a `change`: the fields it would set. */
  readonly changes: Record<string, unknown> | null;
  readonly reason: string | null;
  /**
   * The sentence this proposal is accountable to (§10.2).
   *
   * **Not optional**, on either side: the server refuses to store a proposal
   * without one, because a proposal a human cannot trace to something somebody
   * said is one they cannot honestly accept.
   */
  readonly quote: string;
  /** Set once this proposal has landed; a repeat apply is a no-op. */
  readonly applied_at: number | null;
}

export interface MeetingReview {
  readonly id: string;
  readonly project_id: string;
  readonly source: string;
  readonly status: MeetingReviewStatus;
  readonly proposal_count: number;
  readonly reviewed_by: string | null;
  readonly reviewed_at: number | null;
  readonly expires_at: number;
  readonly created_at: number;
}

export interface MeetingReviewDetail extends MeetingReview {
  readonly proposals: readonly ProposalView[];
}

/**
 * What applying one proposal actually did.
 *
 * **There is no `refused` variant, and that is the important part.** A proposal
 * the server declined is simply **absent** from `applied` — LAI-451 decides each
 * one separately, so a member may legitimately apply a task change and not a
 * `decision`, which writes `context_md` and is lead-only.
 *
 * A screen that reports what was *selected* would therefore report a success
 * that did not happen. What landed is the difference between what was sent and
 * what comes back here.
 */
export type ProposalOutcome =
  | { readonly effect: 'task.created'; readonly task_id: string }
  | { readonly effect: 'task.updated'; readonly task_id: string }
  | { readonly effect: 'task.status_changed'; readonly task_id: string; readonly to: string }
  | { readonly effect: 'context.appended' };

export interface AppliedProposal {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly outcome: ProposalOutcome;
}

export interface ApplyResult {
  readonly id: string;
  readonly status: MeetingReviewStatus;
  readonly applied: readonly AppliedProposal[];
  /** Ids accepted again on a repeat call, which changed nothing. */
  readonly already_applied: readonly string[];
}

export function listMeetingReviews(
  slug: string,
  signal?: AbortSignal,
): Promise<Page<MeetingReview>> {
  return request<Page<MeetingReview>>(
    `/projects/${encodeURIComponent(slug)}/meeting-reviews`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * One review **with** its proposals.
 *
 * The list deliberately omits them: every proposal carries a quote, and a
 * paginated list returning all of them would hand a broad read the quoted parts
 * of every meeting a project ever recorded.
 */
export function getMeetingReview(id: string, signal?: AbortSignal): Promise<MeetingReviewDetail> {
  return request<MeetingReviewDetail>(
    `/meeting-reviews/${encodeURIComponent(id)}`,
    signal === undefined ? {} : { signal },
  );
}

export function applyMeetingReview(
  id: string,
  acceptedProposalIds: readonly string[],
): Promise<ApplyResult> {
  return request<ApplyResult>(`/meeting-reviews/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: { accepted_proposal_ids: acceptedProposalIds },
  });
}

export function discardMeetingReview(id: string): Promise<MeetingReview> {
  return request<MeetingReview>(`/meeting-reviews/${encodeURIComponent(id)}/discard`, {
    method: 'POST',
  });
}
