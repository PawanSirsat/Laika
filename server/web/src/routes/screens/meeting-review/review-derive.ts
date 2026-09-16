import type {
  ApplyResult,
  MeetingReview,
  ProposalKind,
  ProposalOutcome,
  ProposalView,
} from '../../../api/meeting-reviews.ts';

/**
 * What the Meeting review screen works out for itself — **and it is deliberately
 * almost nothing** (LAI-455).
 *
 * This screen asks a person to authorise an LLM's reading of a conversation to
 * change their board. Every figure it shows about what *happened* comes from the
 * apply response; what is here is presentation, and the one judgement that
 * matters — **did this proposal land?** — is a lookup in the response rather
 * than a belief about the request.
 */

/** The four §11.4.2 tags, and the weight each carries. */
export const KIND_LABEL: Readonly<Record<ProposalKind, string>> = {
  new: 'NEW',
  change: 'CHANGED',
  dead: 'DEAD',
  decision: 'DECISION',
};

/**
 * What a proposal would do, said plainly enough to refuse.
 *
 * `DEAD` proposes closing work somebody is doing, so it says so in words rather
 * than relying on a colour: a reader scanning quickly must not take it for
 * another `NEW`.
 */
export const KIND_MEANING: Readonly<Record<ProposalKind, string>> = {
  new: 'creates a task',
  change: 'edits an existing task',
  dead: 'closes existing work as no longer wanted',
  decision: 'appends to the project context — a record, not a task',
};

/**
 * `in_progress → done`, rather than `set status to done`.
 *
 * **A change a reader cannot see the before of is not reviewable.** The proposal
 * carries only the new value, so the old one is read from the task the screen
 * already holds; when it does not hold that task, the arrow is omitted rather
 * than invented — `? → done` claims a fact nobody has.
 */
export function describeChange(
  field: string,
  to: unknown,
  from: unknown,
): { readonly field: string; readonly from: string | undefined; readonly to: string } {
  const show = (v: unknown): string =>
    v === null ? 'none' : typeof v === 'string' ? v : JSON.stringify(v);
  return {
    field,
    from: from === undefined ? undefined : show(from),
    to: show(to),
  };
}

/** Every field a `change` proposal would set, in a stable order. */
export function changedFields(proposal: ProposalView): readonly string[] {
  return Object.keys(proposal.changes ?? {}).sort();
}

export type LandedState =
  /** In the response's `applied` — it happened, and this is what it did. */
  | { readonly state: 'applied'; readonly outcome: ProposalOutcome }
  /** Accepted again after it had already landed; nothing changed. */
  | { readonly state: 'already' }
  /**
   * **Accepted and not in the response.** LAI-451 decides each proposal
   * separately, so this is the ordinary shape of a member accepting a
   * `decision` they may not make — not an error, and not a success.
   */
  | { readonly state: 'refused' }
  /** Never accepted, so never sent. */
  | { readonly state: 'not-sent' };

/**
 * What landed, **read from the response and never from the selection**.
 *
 * This is the criterion the screen exists to satisfy. A screen that ticks off
 * what it sent is reporting its own optimism; `applied` is the only account of
 * what actually happened, and a proposal missing from it was refused however
 * confidently it was selected.
 */
export function landedState(
  proposalId: string,
  accepted: ReadonlySet<string>,
  result: ApplyResult,
): LandedState {
  const applied = result.applied.find((a) => a.id === proposalId);
  if (applied !== undefined) return { state: 'applied', outcome: applied.outcome };
  if (result.already_applied.includes(proposalId)) return { state: 'already' };
  if (accepted.has(proposalId)) return { state: 'refused' };
  return { state: 'not-sent' };
}

/** `LC-12 created`, `context appended` — the effect, in the reader's terms. */
export function describeOutcome(outcome: ProposalOutcome, keyOf: (id: string) => string): string {
  switch (outcome.effect) {
    case 'task.created':
      return `created ${keyOf(outcome.task_id)}`;
    case 'task.updated':
      return `updated ${keyOf(outcome.task_id)}`;
    case 'task.status_changed':
      return `moved ${keyOf(outcome.task_id)} to ${outcome.to}`;
    case 'context.appended':
      return 'appended to the project context';
  }
}

/**
 * Is this review still open to being acted on?
 *
 * **Expiry is computed from `status`, not from the clock.** §11.6's sweep sets
 * `expired` and writes `meeting_review.expired`; a screen that decided for
 * itself by comparing `expires_at` to `Date.now()` would be a second definition
 * of expiry that disagrees with the audit row — the `ready` mistake §4.5 warns
 * about, on a field where disagreeing means offering to apply something the
 * server will refuse.
 */
export function isActionable(review: MeetingReview): boolean {
  return review.status === 'pending';
}

/** Why this review cannot be acted on, for a reader who is looking at it. */
export function whyNotActionable(review: MeetingReview): string | undefined {
  switch (review.status) {
    case 'pending':
      return undefined;
    case 'expired':
      return 'This review expired before anyone looked at it. Proposals are kept for seven days, and after that they are read-only — the meeting would have to be submitted again.';
    case 'applied':
      return 'This review has been applied. What landed is shown against each proposal.';
    case 'discarded':
      return 'This review was discarded. The whole set was thrown away and cannot be applied.';
  }
}
