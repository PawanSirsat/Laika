/**
 * The Proof section's own choices (LAI-1122): whether it starts folded under
 * a state panel that already summarises the round, what its folded line says,
 * and how a round's decision is worded.
 */

import type { Round, RoundDecision } from '../../../api/review.ts';
import type { TaskStatus } from '../../../api/tasks.ts';
import { confirmedShort } from './hero-derive.ts';

/**
 * Whether the Proof section starts folded: only beside the state panel —
 * `shared`, the panel's own read of the rounds — and only while the task is
 * in review, which is when that panel lists the round's commits and runs.
 *
 * The task's status decides when it is given. Without it, a round still
 * waiting for a decision with no send-back is what *in review* looks like.
 * A sent-back task stays open: its panel summarises the round in one line.
 */
export function proofFolded(input: {
  readonly shared: boolean;
  readonly status: TaskStatus | undefined;
  readonly sendBack: unknown;
  readonly latest: Round | undefined;
}): boolean {
  if (!input.shared || input.latest === undefined) return false;
  if (input.status !== undefined) return input.status === 'review';
  // `??`: a round served before LAI-1122 carries no `decision` at all.
  return input.sendBack === null && (input.latest.decision ?? null) === null;
}

/** The folded section's one line: *Proof · round 2 · all 7 confirmed*. */
export function proofFoldLabel(round: Round): string {
  return `Proof · round ${String(round.number)} · ${confirmedShort(round)}`;
}

/** *Accepted by* or *Sent back by*, before the person's name. */
export function decisionVerb(kind: RoundDecision['kind']): string {
  return kind === 'accepted' ? 'Accepted by' : 'Sent back by';
}
