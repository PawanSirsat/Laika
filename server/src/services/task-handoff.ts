import { and, eq, inArray } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import {
  LIVE_CLAIM_STATES,
  LIVE_OFFER_STATES,
  type CheckpointVerification,
  type HandoffOfferKind,
  type HandoffOfferState,
  type TaskClaimState,
  type TaskStatus,
} from '../db/enums.ts';
import { checkpointRefs, handoffOffers, taskCheckpoints, taskClaims } from '../db/schema.ts';
import { checkpointSettings } from './checkpoints.ts';

/**
 * A task's saves and hand-off in one small summary (§6.4, LAI-1005), so a card
 * can say *Recovery available* or *Save needs attention* without opening the
 * drawer — which LAI-549 found it could not, because *"the task list carries
 * no checkpoint or offer field"*.
 *
 * It rides on every task view, and every task view is served only behind the
 * read that `GET /tasks/:id/checkpoints` and `GET /tasks/:id/handoff-offers`
 * ask — *Read tasks*, `project.read` (§3.2) — so nobody learns from it what
 * those two would not tell them. It names no agent, session or person: the
 * card has `claim` and `selected_agent` for that, under their own rules
 * (D-120).
 */
export interface TaskHandoffView {
  /** The task's newest checkpoint, by `created_at`, or null when it has none. */
  checkpoint: {
    verification: CheckpointVerification;
    saved_at: number;
    /** When its newest ref was registered, while it waits for its notice; null unless `pending`. */
    pending_since: number | null;
    /** `pending` for longer than §9.1.1's notice — the same flag as the checkpoint read. */
    pending_notice: boolean;
  } | null;
  /** The newest **live** hand-off or recovery offer (`pending_approval` or `open`), or null. */
  offer: {
    kind: Extract<HandoffOfferKind, 'handoff' | 'recovery'>;
    state: Extract<HandoffOfferState, 'pending_approval' | 'open'>;
    requires_approval: boolean;
  } | null;
  /**
   * The task is in progress, its newest claim **expired** and nothing holds it,
   * and work can continue from a save: a live recovery offer, or a `verified`
   * checkpoint to open one from (§4.73). The drawer's *Recovery available*.
   */
  recovery_available: boolean;
  /**
   * The newest checkpoint is `uncertain` — GitHub's notices do not match one
   * clean save — and neither a live claim nor *Recovery available* speaks
   * first. The server-knowable half only: a receiver's own failed fetch
   * (LAI-548) is not reported here.
   */
  save_needs_attention: boolean;
}

/** What a task with no saves and no hand-off reads — and what a caller who may not see them reads. */
export const NO_HANDOFF: Readonly<TaskHandoffView> = Object.freeze({
  checkpoint: null,
  offer: null,
  recovery_available: false,
  save_needs_attention: false,
});

/** The facts the two rules read, per task. */
export interface HandoffFacts {
  status: TaskStatus;
  /** The state of the task's newest claim (highest generation), or null when it never had one. */
  newestClaim: TaskClaimState | null;
  newestCheckpoint: CheckpointVerification | null;
  hasVerified: boolean;
  liveOffer: TaskHandoffView['offer'];
}

/**
 * The two rules, once (LAI-1005): the card reads these and does not derive
 * them again.
 *
 * *Recovery available* is `openRecoveryIfDue`'s condition seen from the
 * reader's side — in progress, newest claim `expired` — met by the offer it
 * opened or by the verified save it would open one from. An expired newest
 * claim is also *nothing holds it*: a live claim is always a newer generation.
 */
export function deriveHandoff(facts: HandoffFacts): {
  recovery_available: boolean;
  save_needs_attention: boolean;
} {
  const expired = facts.status === 'in_progress' && facts.newestClaim === 'expired';
  const recovery_available = expired && (facts.liveOffer?.kind === 'recovery' || facts.hasVerified);
  const live =
    facts.newestClaim !== null &&
    (LIVE_CLAIM_STATES as readonly string[]).includes(facts.newestClaim);
  const save_needs_attention =
    facts.newestCheckpoint === 'uncertain' && !recovery_available && !live;
  return { recovery_available, save_needs_attention };
}

/**
 * Every listed task's summary in **three queries whatever the page size** —
 * claims, checkpoints with their newest ref, live offers — never one per task
 * (LAI-091's rule, which every other part of a task view keeps).
 */
export function handoffViews(
  db: Db,
  rows: readonly { id: string; status: TaskStatus }[],
  now: number,
): Map<string, TaskHandoffView> {
  const out = new Map<string, TaskHandoffView>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);

  const newestClaim = new Map<string, { generation: number; state: TaskClaimState }>();
  for (const claim of db
    .select({
      taskId: taskClaims.taskId,
      generation: taskClaims.generation,
      state: taskClaims.state,
    })
    .from(taskClaims)
    .where(inArray(taskClaims.taskId, ids))
    .all()) {
    const seen = newestClaim.get(claim.taskId);
    if (seen === undefined || claim.generation > seen.generation)
      newestClaim.set(claim.taskId, claim);
  }

  // Each checkpoint with its refs, in one read: the newest ref — the highest
  // revision, as the checkpoint read takes it — says how long a `pending`
  // save has waited (§4.71).
  const newest = new Map<
    string,
    {
      id: string;
      verification: CheckpointVerification;
      createdAt: number;
      refAt: number | null;
      revision: number | null;
    }
  >();
  const verified = new Set<string>();
  for (const c of db
    .select({
      id: taskCheckpoints.id,
      taskId: taskCheckpoints.taskId,
      verification: taskCheckpoints.verification,
      createdAt: taskCheckpoints.createdAt,
      refAt: checkpointRefs.createdAt,
      revision: checkpointRefs.revision,
    })
    .from(taskCheckpoints)
    .leftJoin(checkpointRefs, eq(checkpointRefs.checkpointId, taskCheckpoints.id))
    .where(inArray(taskCheckpoints.taskId, ids))
    .all()) {
    if (c.verification === 'verified') verified.add(c.taskId);
    const seen = newest.get(c.taskId);
    if (seen?.id === c.id) {
      if (c.revision !== null && (seen.revision === null || c.revision > seen.revision)) {
        seen.refAt = c.refAt;
        seen.revision = c.revision;
      }
      continue;
    }
    // Newest by `created_at`, ties by id — the order `GET /tasks/:id/checkpoints` serves.
    if (
      seen === undefined ||
      c.createdAt > seen.createdAt ||
      (c.createdAt === seen.createdAt && c.id > seen.id)
    ) {
      newest.set(c.taskId, {
        id: c.id,
        verification: c.verification,
        createdAt: c.createdAt,
        refAt: c.refAt,
        revision: c.revision,
      });
    }
  }

  const offers = new Map<
    string,
    { createdAt: number; id: string; view: NonNullable<TaskHandoffView['offer']> }
  >();
  for (const o of db
    .select({
      id: handoffOffers.id,
      taskId: handoffOffers.taskId,
      kind: handoffOffers.kind,
      state: handoffOffers.state,
      requiresApproval: handoffOffers.requiresApproval,
      createdAt: handoffOffers.createdAt,
    })
    .from(handoffOffers)
    .where(
      and(
        inArray(handoffOffers.taskId, ids),
        inArray(handoffOffers.kind, ['handoff', 'recovery']),
        inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
      ),
    )
    .all()) {
    const seen = offers.get(o.taskId);
    if (
      seen !== undefined &&
      (seen.createdAt > o.createdAt || (seen.createdAt === o.createdAt && seen.id > o.id))
    )
      continue;
    offers.set(o.taskId, {
      createdAt: o.createdAt,
      id: o.id,
      view: {
        kind: o.kind as 'handoff' | 'recovery',
        state: o.state as 'pending_approval' | 'open',
        requires_approval: o.requiresApproval,
      },
    });
  }

  const { pendingNoticeMs } = checkpointSettings();
  for (const row of rows) {
    const save = newest.get(row.id);
    const offer = offers.get(row.id)?.view ?? null;
    const pendingSince = save?.verification === 'pending' ? (save.refAt ?? save.createdAt) : null;
    out.set(row.id, {
      checkpoint:
        save === undefined
          ? null
          : {
              verification: save.verification,
              saved_at: save.createdAt,
              pending_since: pendingSince,
              pending_notice: pendingSince !== null && now - pendingSince > pendingNoticeMs,
            },
      offer,
      ...deriveHandoff({
        status: row.status,
        newestClaim: newestClaim.get(row.id)?.state ?? null,
        newestCheckpoint: save?.verification ?? null,
        hasVerified: verified.has(row.id),
        liveOffer: offer,
      }),
    });
  }
  return out;
}
