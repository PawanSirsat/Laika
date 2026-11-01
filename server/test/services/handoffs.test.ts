import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  handoffOffers,
  agentProjectGrants,
  projectMemberships,
  projects,
  projectStatuses,
  taskCheckpoints,
  taskClaims,
  tasks,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent, revokeAgent } from '../../src/services/agents.ts';
import {
  applyCheckpointDelivery,
  pruneCheckpoints,
  registerCheckpoint,
  registerCheckpointRef,
} from '../../src/services/checkpoints.ts';
import {
  configureClaims,
  DEFAULT_CLAIM_TIMINGS,
  expireClaims,
  heartbeatAgentSession,
  reclaimTask,
} from '../../src/services/claims.ts';
import {
  acceptHandoff,
  approveHandoff,
  cancelHandoff,
  declineHandoff,
  expireOffers,
  getHandoffPolicy,
  listInbox,
  listTaskOffers,
  offerHandoff,
  putHandoffPolicy,
  resetHandoffRateLimits,
} from '../../src/services/handoffs.ts';
import { addMember } from '../../src/services/projects.ts';
import { changeStatus, createTask, startWorking, updateTask } from '../../src/services/tasks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/handoffs.ts` (SPEC §4.73, §4.74, §6.3, §9.1.1, §11.6, LAI-546),
 * on an injected clock: every call is given `now`. The REST and MCP surfaces
 * are `test/http/routes/handoffs.test.ts`.
 *
 * Every refusal asserts the §6.3 `code` **and** `details.reason`, so a `409`
 * from somewhere else cannot pass for the rule under test.
 */

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const LEASE = DEFAULT_CLAIM_TIMINGS.expireMs;
const TTL = 30 * MIN;
const REPO = 'kvell/laika';
const ZERO = '0'.repeat(40);
const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const RACER = fileURLToPath(new URL('../helpers/accept-racer.ts', import.meta.url));

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, T0);
  owner = loadActor(t.db, s.userId)!;
  t.db.update(projects).set({ repo: REPO }).where(eq(projects.id, s.projectId)).run();
  configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
  resetHandoffRateLimits();
});

afterEach(() => {
  configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
  t.close();
});

interface AgentHandle {
  id: string;
  actor: ResolvedActor;
  secret: string;
}

/** A device per fixture agent: D-120 allows one active agent per harness per device. */
let fixtureDevices = 0;

function agentOf(person: ResolvedActor, name: string): AgentHandle {
  const created = registerAgent(t.sqlite, t.db, person, {
    displayName: name,
    harness: 'claude-code',
    deviceLabel: `device-${++fixtureDevices}`,
    grants: [{ projectId: s.projectId, scope: 'full' }],
  });
  return {
    id: created.agent.id,
    actor: resolveTokenActor(t.db, created.secret, T0),
    secret: created.secret,
  };
}

/** A Member of the project, with an agent of their own. */
function member(
  name = 'Mira',
  role: 'member' | 'lead' = 'member',
): { person: ResolvedActor; agent: AgentHandle } {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name,
      orgRole: 'member',
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    })
    .run();
  addMember(t.db, owner, 'laika', id, role, T0);
  const person = loadActor(t.db, id)!;
  return { person, agent: agentOf(person, `${name}’s agent`) };
}

function task(title = 'Work'): string {
  return createTask(t.sqlite, t.db, owner, 'laika', { title, now: T0 }).id;
}

function at(actor: ResolvedActor, generation: number | undefined): ResolvedActor {
  return { ...actor, claimGeneration: generation };
}

function claim(a: AgentHandle, id: string, now = T0): { generation: number; session: string } {
  const started = startWorking(t.sqlite, t.db, a.actor, id, { now });
  return { generation: started.claim!.generation, session: started.claim!.session_id };
}

let shaSeed = 0;
function sha(): string {
  shaSeed += 1;
  return shaSeed.toString(16).padStart(40, 'a');
}

/** A checkpoint registered under the holder's claim, `verified` by a delivery unless `pending`. */
function save(
  a: AgentHandle,
  id: string,
  generation: number,
  options: { now?: number; verified?: boolean; commit?: string } = {},
): { id: string; commit: string; ref: string } {
  const commit = options.commit ?? sha();
  const saved = registerCheckpoint(t.sqlite, t.db, at(a.actor, generation), id, {
    id: newId(),
    idempotencyKey: newId(),
    repo: REPO,
    branch: 'LAI-1-work',
    commitSha: commit,
    manifest: [{ path: 'src/a.ts', added: 1, removed: 0 }],
    summary: { work_done: 'Half', next_step: 'Rest' },
    summaryCommitSha: commit,
    now: options.now ?? T0,
  }).checkpoint;
  if (options.verified !== false) deliver(saved.remote_ref, ZERO, commit, options.now ?? T0);
  return { id: saved.id, commit, ref: saved.remote_ref };
}

function deliver(ref: string, before: string, after: string, now = T0): void {
  const outcome = applyCheckpointDelivery(
    t.sqlite,
    t.db,
    { deliveryId: newId(), repo: REPO, ref, before, after },
    now,
  );
  expect(outcome.handled, JSON.stringify(outcome)).toBe(true);
}

function offer(
  from: AgentHandle,
  id: string,
  generation: number,
  to: string,
  checkpoint: string,
  now = T0,
  key = newId(),
) {
  return offerHandoff(t.sqlite, t.db, at(from.actor, generation), id, {
    idempotencyKey: key,
    toAgentId: to,
    checkpointId: checkpoint,
    reason: 'Out of context; continue from the save',
    now,
  });
}

function refusal(fn: () => unknown): { code: string; reason: unknown } {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    return { code: api.code, reason: (api.details as { reason?: unknown } | null)?.reason };
  }
  throw new Error('expected a refusal, and nothing was thrown');
}

function claimsOf(id: string) {
  return t.db
    .select()
    .from(taskClaims)
    .where(eq(taskClaims.taskId, id))
    .all()
    .sort((a, b) => a.generation - b.generation)
    .map((c) => [c.generation, c.state]);
}

function rowsOf(id: string, type: string) {
  return t.db
    .select()
    .from(activity)
    .where(and(eq(activity.taskId, id), eq(activity.type, type as never)))
    .all()
    .map((r) => JSON.parse(r.payloadJson) as Record<string, unknown>);
}

function offersOf(id: string) {
  return t.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, id)).all();
}

// -------------------------------------------------------------------- offer

describe('offering', () => {
  it('pauses the sender’s claim; every change it makes is claim_paused until the offer closes', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);

    const { offer: made, created } = offer(a, id, held.generation, b.id, cp.id);

    expect(created).toBe(true);
    expect(made).toMatchObject({
      kind: 'handoff',
      state: 'open',
      to_agent_id: b.id,
      from_agent_id: a.id,
      from_claim_generation: 1,
      checkpoint_id: cp.id,
      checkpoint_commit_sha: cp.commit,
      requires_approval: false,
      expires_at: T0 + TTL,
    });
    expect(made.note_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(claimsOf(id)).toEqual([[1, 'paused']]);
    expect(
      refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'Moved on', now: T0 + 1 })),
    ).toEqual({ code: 'conflict', reason: 'claim_paused' });
    expect(rowsOf(id, 'task.handoff_offered')).toEqual([
      {
        offer_id: made.id,
        kind: 'handoff',
        to_agent_id: b.id,
        checkpoint_id: cp.id,
        commit_sha: cp.commit,
        requires_approval: false,
        expires_at: T0 + TTL,
        from_generation: 1,
      },
    ]);
  });

  it('a heartbeat renews a paused claim, and a lapsed one expires by the same rule', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    offer(a, id, held.generation, b.id, save(a, id, 1).id);

    const beat = heartbeatAgentSession(t.sqlite, t.db, a.actor, held.session, T0 + LEASE - 1);
    expect(beat.claims).toMatchObject([{ state: 'paused', lease_expires_at: T0 + 2 * LEASE - 1 }]);
    expireClaims(t.db, T0 + 2 * LEASE - 1);
    expect(claimsOf(id)).toEqual([[1, 'expired']]);
  });

  it('needs a verified checkpoint of this task under the live claim — a pending, another task’s or none is refused', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const other = task('Other');
    const held = claim(a, id);
    const otherHeld = claim(a, other);
    const pending = save(a, id, held.generation, { verified: false });
    const foreign = save(a, other, otherHeld.generation);

    expect(refusal(() => offer(a, id, 1, b.id, pending.id))).toEqual({
      code: 'conflict',
      reason: 'checkpoint_unverified',
    });
    expect(refusal(() => offer(a, id, 1, b.id, foreign.id))).toEqual({
      code: 'unprocessable',
      reason: 'checkpoint_not_this_claim',
    });
    expect(refusal(() => offer(a, id, 1, b.id, ''))).toEqual({
      code: 'unprocessable',
      reason: 'checkpoint_required',
    });
    expect(claimsOf(id)).toEqual([[1, 'active']]);
  });

  it('an older generation’s checkpoint is not this claim’s', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    claim(a, id);
    const old = save(a, id, 1);
    expireClaims(t.db, T0 + LEASE);
    const back = reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE + 1 });
    // The reclaim cancelled the recovery the expiry opened from `old`.
    expect(offersOf(id).map((o) => [o.kind, o.state, o.closedReason])).toEqual([
      ['recovery', 'cancelled', 'reclaimed'],
    ]);

    expect(
      refusal(() => offer(a, id, back.claim.generation, b.id, old.id, T0 + LEASE + 2)),
    ).toEqual({
      code: 'unprocessable',
      reason: 'checkpoint_not_this_claim',
    });
  });

  it('a work request needs no checkpoint', () => {
    const b = agentOf(owner, 'B');
    const id = task();
    updateTask(t.db, owner, id, { selected_agent_id: b.id, now: T0 });
    expect(offersOf(id).map((o) => [o.kind, o.state, o.checkpointId])).toEqual([
      ['work_request', 'open', null],
    ]);
  });

  it('refuses a person, a second live offer, and a receiver that may not receive', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { agent: theirs } = member();

    expect(
      refusal(() =>
        offerHandoff(t.sqlite, t.db, owner, id, {
          idempotencyKey: 'k',
          toAgentId: b.id,
          checkpointId: cp.id,
          reason: 'x',
          now: T0,
        }),
      ),
    ).toEqual({ code: 'forbidden', reason: 'not_an_agent' });
    // Another owner's agent, at the policy's defaults.
    expect(refusal(() => offer(a, id, 1, theirs.id, cp.id))).toEqual({
      code: 'unprocessable',
      reason: 'receiver_not_eligible',
    });
    expect(refusal(() => offer(a, id, 1, 'no-such-agent', cp.id))).toEqual({
      code: 'unprocessable',
      reason: 'receiver_not_eligible',
    });
    revokeAgent(t.sqlite, t.db, owner, b.id, T0);
    expect(refusal(() => offer(a, id, 1, b.id, cp.id))).toEqual({
      code: 'unprocessable',
      reason: 'receiver_not_eligible',
    });

    const c = agentOf(owner, 'C');
    offer(a, id, 1, c.id, cp.id);
    expect(refusal(() => offer(a, id, 1, c.id, cp.id))).toEqual({
      code: 'conflict',
      reason: 'claim_paused',
    });
  });

  it('a retry with the same key and body answers the offer already made — before the fence it paused', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const first = offer(a, id, 1, b.id, cp.id, T0, 'same-key');

    const again = offer(a, id, 1, b.id, cp.id, T0 + 1, 'same-key');
    expect(again).toEqual({ offer: first.offer, created: false });
    expect(offersOf(id).filter((o) => o.kind === 'handoff')).toHaveLength(1);
    expect(rowsOf(id, 'task.handoff_offered')).toHaveLength(1);

    const c = agentOf(owner, 'C');
    expect(refusal(() => offer(a, id, 1, c.id, cp.id, T0 + 2, 'same-key'))).toEqual({
      code: 'conflict',
      reason: 'idempotency_key_reused',
    });
  });

  it('offer, accept, decline and cancel share one bucket per agent: 10, then one a minute', () => {
    const a = agentOf(owner, 'A');
    for (let i = 0; i < 10; i += 1) {
      expect(refusal(() => declineHandoff(t.sqlite, t.db, a.actor, 'none', { now: T0 }))).toEqual({
        code: 'not_found',
        reason: undefined,
      });
    }
    expect(refusal(() => declineHandoff(t.sqlite, t.db, a.actor, 'none', { now: T0 }))).toEqual({
      code: 'rate_limited',
      reason: 'handoff_rate',
    });
    // Another agent has its own bucket.
    const b = agentOf(owner, 'B');
    expect(refusal(() => declineHandoff(t.sqlite, t.db, b.actor, 'none', { now: T0 })).code).toBe(
      'not_found',
    );
    expect(
      refusal(() => declineHandoff(t.sqlite, t.db, a.actor, 'none', { now: T0 + MIN })).code,
    ).toBe('not_found');
  });
});

// ------------------------------------------------------------------- accept

describe('accepting', () => {
  it('moves the claim atomically: transferred, generation + 1, the receiver selected, one hand-off counted', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);

    const accepted = acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
      verifiedCommitSha: cp.commit,
      now: T0 + MIN,
    });

    expect(accepted.claim).toMatchObject({ agent_id: b.id, generation: 2, state: 'active' });
    expect(accepted.offer).toMatchObject({
      state: 'accepted',
      accepted_claim_id: accepted.claim.id,
      accepted_session_id: accepted.session.id,
      receiver_commit_sha: cp.commit,
    });
    expect(claimsOf(id)).toEqual([
      [1, 'transferred'],
      [2, 'active'],
    ]);
    const row = t.db.select().from(tasks).where(eq(tasks.id, id)).get()!;
    expect(row).toMatchObject({ selectedAgentId: b.id, handoffCount: 1, assigneeId: null });
    expect(rowsOf(id, 'task.agent_selected')).toEqual([{ from: null, to: b.id }]);
    expect(rowsOf(id, 'task.handoff_accepted')).toEqual([
      {
        offer_id: made.id,
        kind: 'handoff',
        checkpoint_id: cp.id,
        receiver_commit_sha: cp.commit,
        from_generation: 1,
        from_claim_state: 'transferred',
        generation: 2,
        claim_id: accepted.claim.id,
        session_id: accepted.session.id,
        agent_id: b.id,
        handoff_count: 1,
      },
    ]);

    // The old session's write is stale, with or without its generation.
    expect(
      refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'Late', now: T0 + 2 * MIN })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    expect(
      refusal(() => updateTask(t.db, a.actor, id, { title: 'Late', now: T0 + 2 * MIN })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    // The receiver writes under its new generation.
    updateTask(t.db, at(b.actor, 2), id, { title: 'Continued', now: T0 + 2 * MIN });
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()!.title).toBe('Continued');
  });

  it('the same agent asking again finds its accept; another receiver gets offer_taken', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const c = agentOf(owner, 'C');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    const first = acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
      verifiedCommitSha: cp.commit,
      now: T0 + 1,
    });

    expect(
      acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
        verifiedCommitSha: cp.commit,
        now: T0 + 2,
      }).claim,
    ).toEqual(first.claim);
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, c.actor, made.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + 2,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'offer_taken' });
    expect(claimsOf(id)).toEqual([
      [1, 'transferred'],
      [2, 'active'],
    ]);
  });

  it('a live offer named for another agent is not_the_receiver', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const c = agentOf(owner, 'C');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, c.actor, made.id, { verifiedCommitSha: cp.commit, now: T0 }),
      ),
    ).toEqual({ code: 'forbidden', reason: 'not_the_receiver' });
    expect(refusal(() => declineHandoff(t.sqlite, t.db, c.actor, made.id, { now: T0 }))).toEqual({
      code: 'forbidden',
      reason: 'not_the_receiver',
    });
  });

  it('refuses a SHA that is not the checkpoint’s (422) and a checkpoint no longer verified (409)', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);

    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
          verifiedCommitSha: 'f'.repeat(40),
          now: T0,
        }),
      ),
    ).toEqual({ code: 'unprocessable', reason: 'checkpoint_mismatch' });

    // The tag deleted on GitHub after the offer: ref_deleted is final (D-116a).
    deliver(cp.ref, cp.commit, ZERO, T0 + 1);
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + 2,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'checkpoint_unverified' });
    expect(claimsOf(id)).toEqual([[1, 'paused']]);
  });

  it('an accept on a checkpoint re-tagged since the offer — pending again — is checkpoint_unverified', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    // A re-tag registers a new ref, and the checkpoint takes its state: pending (§4.71).
    expect(registerCheckpointRef(t.sqlite, t.db, b.actor, cp.id, T0 + 1).verification).toBe(
      'pending',
    );
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + 2,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'checkpoint_unverified' });
  });

  it('refuses an offer past its time even before the scan writes it', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + TTL,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'offer_closed' });
  });

  it('the fourth completed hand-off is refused at the default limit of 3', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    let holder = a;
    let other = b;
    let generation = claim(a, id).generation;
    let now = T0;
    for (let n = 1; n <= 3; n += 1) {
      const cp = save(holder, id, generation, { now });
      const { offer: made } = offer(holder, id, generation, other.id, cp.id, now);
      generation = acceptHandoff(t.sqlite, t.db, other.actor, made.id, {
        verifiedCommitSha: cp.commit,
        now: now + 1,
      }).claim.generation;
      [holder, other] = [other, holder];
      now += MIN;
    }
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()!.handoffCount).toBe(3);

    const cp = save(holder, id, generation, { now });
    expect(refusal(() => offer(holder, id, generation, other.id, cp.id, now))).toEqual({
      code: 'conflict',
      reason: 'handoff_limit',
    });
  });

  it('an accept past a limit lowered after the offer is handoff_limit', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { max_handoffs: 0 }, T0 + 1);
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + 2,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'handoff_limit' });
  });

  it('two receivers in two processes, released together: exactly one wins, the other is offer_taken', async () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const c = agentOf(owner, 'C');
    const id = task();
    claim(a, id);
    const cp = save(a, id, 1);
    expireClaims(t.db, T0 + LEASE);
    const [recovery] = offersOf(id);
    expect(recovery).toMatchObject({ kind: 'recovery', state: 'open', toAgentId: null });

    // Each racer is its own process with its own connection to the same file.
    const racers = [b, c].map((who) =>
      spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          RACER,
          t.path,
          who.secret,
          recovery!.id,
          cp.commit,
          String(T0 + LEASE + 1),
        ],
        { cwd: SERVER_DIR, stdio: ['pipe', 'pipe', 'inherit'] },
      ),
    );
    const outputs = racers.map((child) => {
      const lines = createInterface({ input: child.stdout });
      const ready = new Promise<void>((resolve) => {
        lines.once('line', (line) => {
          expect(line).toBe('ready');
          resolve();
        });
      });
      const answer = ready.then(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            lines.once('line', (line) => {
              resolve(JSON.parse(line) as Record<string, unknown>);
            });
          }),
      );
      return { ready, answer, exited: once(child, 'exit') };
    });
    await Promise.all(outputs.map((o) => o.ready));
    // Both connections are open; release them in the same tick.
    for (const child of racers) child.stdin.end('go\n');
    const answers = await Promise.all(outputs.map((o) => o.answer));
    await Promise.all(outputs.map((o) => o.exited));

    const winners = answers.filter((x) => 'won' in x);
    const losers = answers.filter((x) => !('won' in x));
    expect(winners, JSON.stringify(answers)).toHaveLength(1);
    expect(losers).toEqual([{ code: 'conflict', reason: 'offer_taken' }]);
    expect([b.id, c.id]).toContain(winners[0]!.won);
    expect(claimsOf(id)).toEqual([
      [1, 'expired'],
      [2, 'active'],
    ]);
    expect(rowsOf(id, 'task.handoff_accepted')).toHaveLength(1);
  }, 30_000);
});

// ------------------------------------------------------- decline and cancel

describe('declining and cancelling', () => {
  it('a decline resumes the sender’s paused claim', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const { offer: made } = offer(a, id, 1, b.id, save(a, id, held.generation).id);

    const declined = declineHandoff(t.sqlite, t.db, b.actor, made.id, {
      reason: 'Busy',
      now: T0 + 1,
    });
    expect(declined).toMatchObject({ state: 'declined', closed_reason: null });
    expect(claimsOf(id)).toEqual([[1, 'active']]);
    expect(rowsOf(id, 'task.handoff_declined')).toEqual([{ offer_id: made.id, reason: 'Busy' }]);
    updateTask(t.db, at(a.actor, 1), id, { title: 'Mine again', now: T0 + 2 });
  });

  it('a cancel — the sender’s, or a person’s — resumes it too', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const { offer: made } = offer(a, id, 1, b.id, save(a, id, held.generation).id);

    const cancelled = cancelHandoff(t.sqlite, t.db, a.actor, made.id, T0 + 1);
    expect(cancelled).toMatchObject({ state: 'cancelled', closed_reason: 'withdrawn' });
    expect(claimsOf(id)).toEqual([[1, 'active']]);
    expect(rowsOf(id, 'task.handoff_cancelled')).toEqual([
      { offer_id: made.id, closed_reason: 'withdrawn' },
    ]);
    expect(refusal(() => cancelHandoff(t.sqlite, t.db, owner, made.id, T0 + 2))).toEqual({
      code: 'conflict',
      reason: 'offer_closed',
    });
  });

  it('the task’s assignee may cancel an offer another person’s agent sent (§4.73)', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const { person } = member();
    const id = task();
    const held = claim(a, id);
    const { offer: made } = offer(a, id, 1, b.id, save(a, id, held.generation).id);
    t.db.update(tasks).set({ assigneeId: person.userId }).where(eq(tasks.id, id)).run();
    expect(cancelHandoff(t.sqlite, t.db, person, made.id, T0 + 1)).toMatchObject({
      state: 'cancelled',
      closed_reason: 'withdrawn',
    });
    expect(claimsOf(id)).toEqual([[1, 'active']]);
  });

  it('another member may not cancel an offer their agent did not send', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const { person } = member();
    const id = task();
    const held = claim(a, id);
    const { offer: made } = offer(a, id, 1, b.id, save(a, id, held.generation).id);
    expect(refusal(() => cancelHandoff(t.sqlite, t.db, person, made.id, T0 + 1)).code).toBe(
      'forbidden',
    );
  });

  it('a sender that lapsed while its offer was live stays expired, and the decline opens the recovery', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    expireClaims(t.db, T0 + LEASE);
    // A live hand-off holds back the recovery.
    expect(offersOf(id).filter((o) => o.kind === 'recovery')).toEqual([]);

    declineHandoff(t.sqlite, t.db, b.actor, made.id, { now: T0 + LEASE + 1 });
    expect(claimsOf(id)).toEqual([[1, 'expired']]);
    expect(
      offersOf(id)
        .filter((o) => o.kind === 'recovery')
        .map((o) => [o.state, o.checkpointId, o.fromClaimGeneration]),
    ).toEqual([['open', cp.id, 1]]);
  });

  it('an unnamed recovery cannot be declined', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    claim(a, id);
    save(a, id, 1);
    expireClaims(t.db, T0 + LEASE);
    const [recovery] = offersOf(id);
    expect(
      refusal(() => declineHandoff(t.sqlite, t.db, b.actor, recovery!.id, { now: T0 + LEASE })),
    ).toEqual({ code: 'unprocessable', reason: 'recovery_unnamed' });
  });
});

// ------------------------------------------------------------------ expiry

describe('expiry and recovery', () => {
  it('the scan expires a live offer at expires_at and the paused claim resumes', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const { offer: made } = offer(a, id, 1, b.id, save(a, id, held.generation).id);
    // The sender keeps heartbeating through the offer.
    for (let beat = T0 + MIN; beat < T0 + TTL; beat += MIN) {
      heartbeatAgentSession(t.sqlite, t.db, a.actor, held.session, beat);
    }

    expect(expireOffers(t.db, T0 + TTL - 1).changed).toBe(0);
    expect(expireOffers(t.db, T0 + TTL).changed).toBe(1);
    expect(offersOf(id)[0]).toMatchObject({ state: 'expired', closedReason: null });
    expect(claimsOf(id)).toEqual([[1, 'active']]);
    expect(rowsOf(id, 'task.handoff_expired')).toEqual([
      { offer_id: made.id, expires_at: T0 + TTL },
    ]);
    expect(expireOffers(t.db, T0 + TTL + 1).changed).toBe(0);
  });

  it('a claim that expires with a verified checkpoint is offered — from the latest verified, never a newer pending one', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    claim(a, id);
    const older = save(a, id, 1, { now: T0 });
    const verified = save(a, id, 1, { now: T0 + 1 });
    save(a, id, 1, { now: T0 + 2, verified: false });

    expireClaims(t.db, T0 + LEASE);

    const recovery = offersOf(id);
    expect(recovery.map((o) => [o.kind, o.state, o.toAgentId, o.checkpointId])).toEqual([
      ['recovery', 'open', null, verified.id],
    ]);
    expect(recovery[0]!.checkpointId).not.toBe(older.id);
    expect(rowsOf(id, 'task.recovered')).toEqual([
      {
        offer_id: recovery[0]!.id,
        checkpoint_id: verified.id,
        commit_sha: verified.commit,
        from_generation: 1,
      },
    ]);
    // Offered, never assigned: nothing about the task moved.
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({
      assigneeId: null,
      status: 'in_progress',
      selectedAgentId: null,
    });
  });

  it('a late heartbeat’s expiry opens the recovery too', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    const held = claim(a, id);
    save(a, id, 1);
    heartbeatAgentSession(t.sqlite, t.db, a.actor, held.session, T0 + LEASE + 1);
    expect(offersOf(id).map((o) => o.kind)).toEqual(['recovery']);
  });

  it('a task with no verified checkpoint gets no recovery offer', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    claim(a, id);
    save(a, id, 1, { verified: false });
    expireClaims(t.db, T0 + LEASE);
    expect(offersOf(id)).toEqual([]);
  });

  it('an expired recovery is replaced while the newest claim is still expired', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    claim(a, id);
    save(a, id, 1);
    expireClaims(t.db, T0 + LEASE);
    expect(expireOffers(t.db, T0 + LEASE + TTL).changed).toBe(1);
    expect(offersOf(id).map((o) => [o.kind, o.state])).toEqual([
      ['recovery', 'expired'],
      ['recovery', 'open'],
    ]);
  });

  it('an unnamed recovery is the expired claim’s owner’s; another owner’s agent waits for a named approval', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    claim(a, id);
    const cp = save(a, id, 1);
    expireClaims(t.db, T0 + LEASE);
    const [recovery] = offersOf(id);
    const { person, agent: theirs } = member();

    // At the defaults another owner's agent may not receive here at all.
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, theirs.actor, recovery!.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + LEASE + 1,
        }),
      ),
    ).toEqual({ code: 'unprocessable', reason: 'receiver_not_eligible' });

    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { allow_other_owners: true }, T0 + LEASE);
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, theirs.actor, recovery!.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + LEASE + 1,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'approval_pending' });
    expect(listInbox(t.db, theirs.actor, { limit: 10, cursor: null }).map((i) => i.id)).toEqual([
      recovery!.id,
    ]);

    // The receiver's owner may not name and approve their own agent.
    t.db.update(tasks).set({ assigneeId: person.userId }).where(eq(tasks.id, id)).run();
    expect(
      refusal(() =>
        approveHandoff(t.sqlite, t.db, person, recovery!.id, {
          toAgentId: theirs.id,
          now: T0 + LEASE + 1,
        }),
      ),
    ).toEqual({ code: 'forbidden', reason: 'approver_is_receiver' });

    const named = approveHandoff(t.sqlite, t.db, owner, recovery!.id, {
      toAgentId: theirs.id,
      now: T0 + LEASE + 2,
    });
    // The approver named another person's agent the task does not show yet:
    // the answer withholds it (D-121 item 7, LAI-1012); its owner reads it.
    expect(named).toMatchObject({
      state: 'open',
      to_agent_id: null,
      to_agent_redacted: true,
      approved_by_user_id: owner.userId,
    });
    expect(listTaskOffers(t.db, person, id).find((o) => o.id === recovery!.id)).toMatchObject({
      to_agent_id: theirs.id,
      to_agent_redacted: false,
    });
    expect(rowsOf(id, 'task.handoff_approved')).toEqual([
      { offer_id: recovery!.id, to_agent_id: theirs.id, named: true },
    ]);
    const accepted = acceptHandoff(t.sqlite, t.db, theirs.actor, recovery!.id, {
      verifiedCommitSha: cp.commit,
      now: T0 + LEASE + 3,
    });
    expect(accepted.claim).toMatchObject({ agent_id: theirs.id, generation: 2 });
    expect(rowsOf(id, 'task.handoff_accepted')[0]).toMatchObject({
      kind: 'recovery',
      from_claim_state: 'expired',
    });
    // The assignee never moves.
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()!.assigneeId).toBe(person.userId);
  });
});

// ----------------------------------------------------------------- approval

describe('a cross-owner hand-off', () => {
  it('waits for an approver — never its receiver’s owner — and then the receiver accepts', () => {
    const a = agentOf(owner, 'A');
    const { person, agent: theirs } = member();
    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { allow_other_owners: true }, T0);
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    t.db.update(tasks).set({ assigneeId: person.userId }).where(eq(tasks.id, id)).run();

    const { offer: made } = offer(a, id, 1, theirs.id, cp.id);
    expect(made).toMatchObject({ state: 'pending_approval', requires_approval: true });
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, theirs.actor, made.id, {
          verifiedCommitSha: cp.commit,
          now: T0,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'approval_pending' });
    // The task's assignee owns the receiving agent: refused, and a lead approves.
    expect(refusal(() => approveHandoff(t.sqlite, t.db, person, made.id, { now: T0 + 1 }))).toEqual(
      { code: 'forbidden', reason: 'approver_is_receiver' },
    );
    // An agent's token never approves: approving is a person's, signed in.
    expect(
      refusal(() => approveHandoff(t.sqlite, t.db, a.actor, made.id, { now: T0 + 1 })),
    ).toEqual({ code: 'forbidden', reason: 'session_required' });

    expect(approveHandoff(t.sqlite, t.db, owner, made.id, { now: T0 + 2 })).toMatchObject({
      state: 'open',
      approved_by_user_id: owner.userId,
      approved_at: T0 + 2,
    });
    expect(rowsOf(id, 'task.handoff_approved')).toEqual([
      { offer_id: made.id, to_agent_id: theirs.id, named: false },
    ]);
    expect(
      acceptHandoff(t.sqlite, t.db, theirs.actor, made.id, {
        verifiedCommitSha: cp.commit,
        now: T0 + 3,
      }).claim.generation,
    ).toBe(2);
  });
});

// ------------------------------------------------------------------ reclaim

describe('the reclaim (§9.1.1)', () => {
  it('cancels every live hand-off and recovery offer, reclaimed', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    claim(a, id);
    save(a, id, 1);
    expireClaims(t.db, T0 + LEASE);
    const [recovery] = offersOf(id);

    const back = reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE + 1 });
    expect(back.claim.generation).toBe(2);
    expect(offersOf(id)[0]).toMatchObject({
      id: recovery!.id,
      state: 'cancelled',
      closedReason: 'reclaimed',
    });
    expect(rowsOf(id, 'task.handoff_cancelled')).toEqual([
      { offer_id: recovery!.id, closed_reason: 'reclaimed' },
    ]);
  });

  it('after somebody accepted the recovery, is offer_taken', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    claim(a, id);
    const cp = save(a, id, 1);
    expireClaims(t.db, T0 + LEASE);
    const [recovery] = offersOf(id);
    acceptHandoff(t.sqlite, t.db, b.actor, recovery!.id, {
      verifiedCommitSha: cp.commit,
      now: T0 + LEASE + 1,
    });

    expect(
      refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE + 2 })),
    ).toEqual({ code: 'conflict', reason: 'offer_taken' });
    expect(
      refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'Late', now: T0 + LEASE + 2 })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
  });
});

// ------------------------------------------------------- closures elsewhere

describe('offers close with what they were about', () => {
  it('revoking the receiving agent closes its offer agent_revoked and the sender resumes', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const { offer: made } = offer(a, id, 1, b.id, save(a, id, held.generation).id);
    revokeAgent(t.sqlite, t.db, owner, b.id, T0 + 1);
    expect(offersOf(id)[0]).toMatchObject({
      id: made.id,
      state: 'cancelled',
      closedReason: 'agent_revoked',
    });
    expect(claimsOf(id)).toEqual([[1, 'active']]);
  });

  it('a revoked agent cannot accept: its credentials are read again inside the accept', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    // The actor was resolved before the revoke, as a request in flight is.
    revokeAgent(t.sqlite, t.db, owner, b.id, T0 + 1);
    expect(
      refusal(() =>
        acceptHandoff(t.sqlite, t.db, b.actor, made.id, {
          verifiedCommitSha: cp.commit,
          now: T0 + 2,
        }),
      ),
    ).toEqual({ code: 'forbidden', reason: 'agent_revoked' });
  });

  it('a task that leaves progress closes its live offer task_closed', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    offer(a, id, 1, b.id, save(a, id, held.generation).id);
    changeStatus(t.db, owner, id, 'todo', T0 + 1);
    expect(offersOf(id)[0]).toMatchObject({ state: 'cancelled', closedReason: 'task_closed' });
    expect(claimsOf(id)).toEqual([[1, 'released']]);
  });

  it('retention removes the checkpoint and the closed offer keeps its snapshot (§4.70)', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    acceptHandoff(t.sqlite, t.db, b.actor, made.id, { verifiedCommitSha: cp.commit, now: T0 + 1 });
    const closedAt = T0 + 2;
    const doneStatus = t.db
      .select({ id: projectStatuses.id })
      .from(projectStatuses)
      .where(and(eq(projectStatuses.projectId, s.projectId), eq(projectStatuses.category, 'done')))
      .get()!.id;
    t.db
      .update(tasks)
      .set({ status: 'done', statusId: doneStatus, completedAt: closedAt })
      .where(eq(tasks.id, id))
      .run();

    expect(pruneCheckpoints(t.db, closedAt + 90 * 24 * 60 * MIN + 1).checkpoints).toBe(1);
    expect(t.db.select().from(taskCheckpoints).where(eq(taskCheckpoints.taskId, id)).all()).toEqual(
      [],
    );
    expect(offersOf(id)[0]).toMatchObject({
      id: made.id,
      state: 'accepted',
      checkpointId: null,
      checkpointCommitSha: cp.commit,
      receiverCommitSha: cp.commit,
    });
    expect(offersOf(id)[0]!.noteHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ------------------------------------------------------------------ reading

describe('hidden is missing', () => {
  it('an offer on a task the agent cannot read answers exactly as one that does not exist', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    const { agent: outsider } = member('Olga');
    // Olga's agent loses its grant, so the project is no longer one it reads.
    t.db.delete(agentProjectGrants).where(eq(agentProjectGrants.agentId, outsider.id)).run();
    const ungranted = outsider.actor;

    const answer = (offerId: string) => {
      try {
        acceptHandoff(t.sqlite, t.db, ungranted, offerId, {
          verifiedCommitSha: cp.commit,
          now: T0 + 1,
        });
      } catch (err) {
        return (err as ApiError).toBody();
      }
      return null;
    };
    expect(answer(made.id)).toEqual(answer('01JNOSUCHOFFERXXXXXXXXXXXX'));
  });
});

describe('the policy (§4.74)', () => {
  it('reads as the defaults with no row; a lead sets it, writing project.updated; a member may not', () => {
    expect(getHandoffPolicy(t.db, owner, 'laika')).toMatchObject({
      allow_other_owners: false,
      cross_owner_requires_approval: true,
      max_handoffs: 3,
      offer_ttl_minutes: 30,
      is_set: false,
    });
    const set = putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { offer_ttl_minutes: 60 }, T0);
    expect(set).toMatchObject({ offer_ttl_minutes: 60, max_handoffs: 3, is_set: true });
    const updated = t.db
      .select()
      .from(activity)
      .where(eq(activity.type, 'project.updated'))
      .all()
      .map((r) => JSON.parse(r.payloadJson) as Record<string, unknown>);
    expect(updated).toEqual([
      {
        field: 'handoff_policy',
        from: {
          allow_other_owners: false,
          cross_owner_requires_approval: true,
          max_handoffs: 3,
          offer_ttl_minutes: 30,
        },
        to: {
          allow_other_owners: false,
          cross_owner_requires_approval: true,
          max_handoffs: 3,
          offer_ttl_minutes: 60,
        },
      },
    ]);
    const { person } = member();
    expect(
      refusal(() => putHandoffPolicy(t.sqlite, t.db, person, 'laika', { max_handoffs: 20 }, T0)),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      refusal(() => putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { max_handoffs: 21 }, T0)),
    ).toMatchObject({ code: 'unprocessable' });
  });
});

// ------------------------------------------- LAI-546 review round 1 (Codex)

describe('closing an offer settles an elapsed sender lease in the same transaction', () => {
  function pausedAndLapsed() {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const held = claim(a, id);
    const cp = save(a, id, held.generation);
    const { offer: made } = offer(a, id, 1, b.id, cp.id);
    // No heartbeat, and no scan yet: the paused lease is past, the row still says paused.
    expect(claimsOf(id)).toEqual([[1, 'paused']]);
    return { a, b, id, cp, made, late: T0 + LEASE + 1 };
  }

  for (const how of ['decline', 'cancel'] as const) {
    it(`a ${how} does not resume it: the claim expires, its row is written, and the recovery opens`, () => {
      const { a, b, id, cp, made, late } = pausedAndLapsed();
      if (how === 'decline') declineHandoff(t.sqlite, t.db, b.actor, made.id, { now: late });
      else cancelHandoff(t.sqlite, t.db, a.actor, made.id, late);

      expect(claimsOf(id)).toEqual([[1, 'expired']]);
      expect(rowsOf(id, 'task.claim_expired')).toHaveLength(1);
      expect(
        offersOf(id)
          .filter((o) => o.kind === 'recovery')
          .map((o) => [o.state, o.checkpointId]),
      ).toEqual([['open', cp.id]]);
      expect(
        refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'x', now: late + 1 })),
      ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    });
  }

  it('an accept records the expiry first, then takes the task from an expired claim', () => {
    const { b, id, cp, made, late } = pausedAndLapsed();
    acceptHandoff(t.sqlite, t.db, b.actor, made.id, { verifiedCommitSha: cp.commit, now: late });

    expect(claimsOf(id)).toEqual([
      [1, 'expired'],
      [2, 'active'],
    ]);
    const types = t.db
      .select()
      .from(activity)
      .where(eq(activity.taskId, id))
      .all()
      .map((r) => r.type);
    expect(types.indexOf('task.claim_expired')).toBeGreaterThan(-1);
    expect(types.indexOf('task.claim_expired')).toBeLessThan(
      types.indexOf('task.handoff_accepted'),
    );
    expect(rowsOf(id, 'task.handoff_accepted')[0]).toMatchObject({ from_claim_state: 'expired' });
    // No recovery beside the accepted offer.
    expect(offersOf(id).filter((o) => o.kind === 'recovery')).toEqual([]);
  });
});

describe('a person is read again inside the write (§4.73)', () => {
  function crossOwnerPending() {
    const a = agentOf(owner, 'A');
    const { agent: theirs } = member('Theo');
    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { allow_other_owners: true }, T0);
    const id = task();
    const held = claim(a, id);
    const { offer: made } = offer(a, id, 1, theirs.id, save(a, id, held.generation).id);
    expect(made.state).toBe('pending_approval');
    return { a, id, made };
  }

  it('a lead demoted after the request resolved may not approve', () => {
    const { made } = crossOwnerPending();
    const { person: lead } = member('Lena', 'lead');
    t.db
      .update(projectMemberships)
      .set({ role: 'member' })
      .where(eq(projectMemberships.userId, lead.userId))
      .run();
    expect(refusal(() => approveHandoff(t.sqlite, t.db, lead, made.id, { now: T0 + 1 })).code).toBe(
      'forbidden',
    );
  });

  it('a deactivated lead may not approve, set the policy or cancel', () => {
    const { made } = crossOwnerPending();
    const { person: lead } = member('Lena', 'lead');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, lead.userId)).run();
    expect(refusal(() => approveHandoff(t.sqlite, t.db, lead, made.id, { now: T0 + 1 }))).toEqual({
      code: 'forbidden',
      reason: 'user_inactive',
    });
    expect(
      refusal(() => putHandoffPolicy(t.sqlite, t.db, lead, 'laika', { max_handoffs: 5 }, T0 + 1)),
    ).toEqual({ code: 'forbidden', reason: 'user_inactive' });
    expect(refusal(() => cancelHandoff(t.sqlite, t.db, lead, made.id, T0 + 1))).toEqual({
      code: 'forbidden',
      reason: 'user_inactive',
    });
    expect(offersOf(made.task_id).find((o) => o.id === made.id)?.state).toBe('pending_approval');
  });

  it('a lead demoted mid-request may not set the policy or cancel another agent’s offer', () => {
    const { made } = crossOwnerPending();
    const { person: lead } = member('Lena', 'lead');
    t.db
      .update(projectMemberships)
      .set({ role: 'member' })
      .where(eq(projectMemberships.userId, lead.userId))
      .run();
    expect(
      refusal(() => putHandoffPolicy(t.sqlite, t.db, lead, 'laika', { max_handoffs: 5 }, T0 + 1))
        .code,
    ).toBe('forbidden');
    expect(refusal(() => cancelHandoff(t.sqlite, t.db, lead, made.id, T0 + 1)).code).toBe(
      'forbidden',
    );
  });
});
