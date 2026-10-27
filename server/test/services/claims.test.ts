import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { activity, agentSessions, handoffOffers, taskClaims } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent, revokeAgent, setAgentGrants } from '../../src/services/agents.ts';
import {
  configureClaims,
  DEFAULT_CLAIM_TIMINGS,
  endAgentSession,
  expireClaims,
  heartbeatAgentSession,
  leaseLapsed,
  reclaimTask,
  startAgentSession,
} from '../../src/services/claims.ts';
import { addComment } from '../../src/services/comments.ts';
import {
  createTask,
  finishTask,
  getTask,
  startWorking,
  updateTask,
} from '../../src/services/tasks.ts';
import { createToken } from '../../src/services/tokens.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/claims.ts` (proposal §4.2, SPEC §4.65, §4.66, §9.1, LAI-541), with
 * an injected clock: every call below is given `now`, so "five minutes later"
 * is a number, not a sleep. The HTTP and MCP surfaces are
 * `test/http/routes/agent-sessions.test.ts` and `test/mcp/claims.test.ts`.
 *
 * Every refusal asserts the §6.3 `code` **and** `details.reason`, so a `409`
 * from somewhere else cannot pass for the fence.
 */

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const LEASE = DEFAULT_CLAIM_TIMINGS.expireMs;

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, T0);
  owner = loadActor(t.db, s.userId)!;
  configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
});

afterEach(() => {
  configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
  t.close();
});

/** A registered agent of the owner, fully granted, acting through its own token. */
function agent(name = 'Claude', scope: 'full' | 'read_only' = 'full') {
  const created = registerAgent(t.sqlite, t.db, owner, {
    displayName: name,
    harness: 'claude-code',
    grants: [{ projectId: s.projectId, scope }],
  });
  return {
    id: created.agent.id,
    actor: resolveTokenActor(t.db, created.secret, T0),
  };
}

function task(title = 'Work'): string {
  return createTask(t.sqlite, t.db, owner, 'laika', { title, now: T0 }).id;
}

function at(actor: ResolvedActor, generation: number | undefined): ResolvedActor {
  return { ...actor, claimGeneration: generation };
}

/** The refusal's `code` and `reason`; a call that does not throw fails the test. */
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

function claimsOf(taskId: string) {
  return t.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).all();
}

function rows(taskId: string, type: 'task.claim_expired' | 'task.claim_reclaimed') {
  return t.db
    .select()
    .from(activity)
    .where(and(eq(activity.taskId, taskId), eq(activity.type, type)))
    .all();
}

describe('taking a claim', () => {
  it('a registered agent’s start_working opens a session and takes generation 1 with a lease', () => {
    const a = agent();
    const id = task();

    const started = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });

    expect(started.claim).toMatchObject({
      task_id: id,
      agent_id: a.id,
      generation: 1,
      state: 'active',
      lease_expires_at: T0 + LEASE,
    });
    const session = t.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, started.claim!.session_id))
      .get();
    expect(session).toMatchObject({ agentId: a.id, startedAt: T0, endedAt: null });
    // Unassigned, so it becomes the owner's — recorded on the claim's row.
    expect(started.task).toMatchObject({ assignee_id: owner.userId, status: 'in_progress' });
  });

  it('a person or a legacy token claims by assignee alone: no claim row', () => {
    const legacy = resolveTokenActor(
      t.db,
      createToken(t.sqlite, t.db, owner, { name: 'legacy', scope: 'full' }).secret,
      T0,
    );
    const id = task();

    expect(startWorking(t.sqlite, t.db, legacy, id, { now: T0 }).claim).toBeNull();
    expect(claimsOf(id)).toEqual([]);
  });

  it('a second session of the same agent is refused with claim_held', () => {
    const a = agent();
    const id = task();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });

    // No session id: a new session, which is not the holder.
    expect(refusal(() => startWorking(t.sqlite, t.db, a.actor, id, { now: T0 + 1 }))).toEqual({
      code: 'conflict',
      reason: 'claim_held',
    });
    expect(claimsOf(id)).toHaveLength(1);
  });

  it('two agents of the same person are fenced from each other: the second is claim_held', () => {
    const first = agent('First');
    const second = agent('Second');
    const id = task();
    startWorking(t.sqlite, t.db, first.actor, id, { now: T0 });

    expect(refusal(() => startWorking(t.sqlite, t.db, second.actor, id, { now: T0 }))).toEqual({
      code: 'conflict',
      reason: 'claim_held',
    });
  });

  it('the holder’s own session resumes and renews, at the same generation', () => {
    const a = agent();
    const id = task();
    const first = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;

    const again = startWorking(t.sqlite, t.db, a.actor, id, {
      now: T0 + 2 * MIN,
      sessionId: first.session_id,
    }).claim!;

    expect(again).toMatchObject({ generation: 1, lease_expires_at: T0 + 2 * MIN + LEASE });
    expect(claimsOf(id)).toHaveLength(1);
  });

  it('answers the work request addressed to this agent: open → accepted, and the assignee stays', () => {
    const a = agent();
    const id = task();
    updateTask(t.db, owner, id, { selected_agent_id: a.id, now: T0 });
    updateTask(t.db, owner, id, { assignee_id: owner.userId, now: T0 });

    const started = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });

    expect(started.claim?.generation).toBe(1);
    expect(started.task.assignee_id).toBe(owner.userId);
    const offer = t.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, id)).get();
    expect(offer).toMatchObject({ state: 'accepted', closedAt: T0 });
  });
});

describe('the fence', () => {
  function claimed() {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    return { a, id, claim };
  }

  it('lets the holder change the task with the live generation', () => {
    const { a, id } = claimed();
    expect(updateTask(t.db, at(a.actor, 1), id, { title: 'Mine', now: T0 + MIN }).title).toBe(
      'Mine',
    );
  });

  it('refuses a stale generation with stale_claim, and writes nothing', () => {
    const { a, id } = claimed();
    expect(
      refusal(() => updateTask(t.db, at(a.actor, 7), id, { title: 'Stale', now: T0 + MIN })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    expect(getTask(t.db, owner, id).title).toBe('Work');
  });

  it('refuses the holder’s agent when it sends no generation: stale_claim', () => {
    const { a, id } = claimed();
    expect(
      refusal(() => updateTask(t.db, a.actor, id, { title: 'No gen', now: T0 + MIN })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
  });

  it('refuses the live generation once its lease has lapsed, before any scan', () => {
    const { a, id } = claimed();
    expect(
      refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'Late', now: T0 + LEASE })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
  });

  it('refuses another agent of the same person, even with the right number: claim_held', () => {
    const { id } = claimed();
    const sibling = agent('Sibling');
    expect(
      refusal(() => updateTask(t.db, at(sibling.actor, 1), id, { title: 'X', now: T0 + MIN })),
    ).toEqual({ code: 'conflict', reason: 'claim_held' });
  });

  it('refuses a legacy token while the claim is live: it cannot bypass it (D-114 item 6)', () => {
    const { id } = claimed();
    const legacy = resolveTokenActor(
      t.db,
      createToken(t.sqlite, t.db, owner, { name: 'legacy', scope: 'full' }).secret,
      T0,
    );
    expect(refusal(() => updateTask(t.db, legacy, id, { title: 'X', now: T0 + MIN }))).toEqual({
      code: 'conflict',
      reason: 'claim_held',
    });
    expect(refusal(() => startWorking(t.sqlite, t.db, legacy, id, { now: T0 + MIN }))).toEqual({
      code: 'conflict',
      reason: 'claim_held',
    });
  });

  it('lets a person signed in edit, read and comment: humans keep explicit control', () => {
    const { id } = claimed();
    expect(updateTask(t.db, owner, id, { title: 'Human edit', now: T0 + MIN }).title).toBe(
      'Human edit',
    );
    expect(getTask(t.db, owner, id).title).toBe('Human edit');
    expect(addComment(t.db, owner, id, 'A note', T0 + MIN).body_md).toBe('A note');
  });

  it('never fences a comment, not even a stale agent’s', () => {
    const { a, id } = claimed();
    expect(addComment(t.db, at(a.actor, 99), id, 'Still here', T0 + MIN).body_md).toBe(
      'Still here',
    );
  });

  it('releases the claim when the holder finishes; the generation is refused afterwards', () => {
    const { a, id } = claimed();
    finishTask(t.sqlite, t.db, at(a.actor, 1), id, { summary: 'Done', now: T0 + MIN });

    expect(claimsOf(id)[0]).toMatchObject({ state: 'released', endedAt: T0 + MIN });
    expect(
      refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'After', now: T0 + 2 * MIN })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
  });
});

describe('expiry', () => {
  it('marks a lapsed lease expired on the next scan and writes task.claim_expired as the system', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;

    expect(expireClaims(t.db, T0 + LEASE - 1).changed).toBe(0);
    expect(claimsOf(id)[0]?.state).toBe('active');

    expect(expireClaims(t.db, T0 + LEASE).changed).toBe(1);
    expect(claimsOf(id)[0]).toMatchObject({ state: 'expired', endedAt: T0 + LEASE });

    const [row] = rows(id, 'task.claim_expired');
    expect(row).toMatchObject({ actorKind: 'system', actorId: null, createdAt: T0 + LEASE });
    expect(JSON.parse(row!.payloadJson)).toEqual({
      generation: 1,
      session_id: claim.session_id,
      agent_id: a.id,
      lease_expires_at: T0 + LEASE,
    });
  });

  it('is never restored by itself: heartbeats resume, and the old generation is still stale_claim', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    expireClaims(t.db, T0 + LEASE + 1);

    const beat = heartbeatAgentSession(t.sqlite, t.db, a.actor, claim.session_id, T0 + LEASE + 2);
    expect(beat.claims).toEqual([]);
    expect(beat.lost.map((c) => [c.generation, c.state])).toEqual([[1, 'expired']]);

    expect(
      refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'Zombie', now: T0 + LEASE + 3 })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    // A plain start_working from the same session is not a reclaim either.
    expect(
      refusal(() =>
        startWorking(t.sqlite, t.db, a.actor, id, {
          now: T0 + LEASE + 4,
          sessionId: claim.session_id,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    expect(claimsOf(id).map((c) => c.state)).toEqual(['expired']);
  });

  it('a heartbeat that arrives after the lease lapsed expires it there, rather than reviving it', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;

    const beat = heartbeatAgentSession(t.sqlite, t.db, a.actor, claim.session_id, T0 + LEASE);

    expect(beat.lost.map((c) => c.state)).toEqual(['expired']);
    expect(rows(id, 'task.claim_expired')).toHaveLength(1);
  });

  it('a heartbeat in time renews the lease from now', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;

    const beat = heartbeatAgentSession(t.sqlite, t.db, a.actor, claim.session_id, T0 + 4 * MIN);

    expect(beat.claims[0]?.lease_expires_at).toBe(T0 + 4 * MIN + LEASE);
    expect(expireClaims(t.db, T0 + LEASE + MIN).changed).toBe(0);
  });

  it('another agent cannot take an expired claim over with a plain claim: it waits for recovery', () => {
    const a = agent('First');
    const other = agent('Other');
    const id = task();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });
    expireClaims(t.db, T0 + LEASE);

    expect(
      refusal(() => startWorking(t.sqlite, t.db, other.actor, id, { now: T0 + LEASE + 1 })),
    ).toEqual({ code: 'conflict', reason: 'claim_held' });
  });

  it('TODO(LAI-546): opens no recovery offer yet — the hook is afterClaimExpired', () => {
    const a = agent();
    const id = task();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });
    expireClaims(t.db, T0 + LEASE);

    expect(
      t.db
        .select()
        .from(handoffOffers)
        .where(and(eq(handoffOffers.taskId, id), eq(handoffOffers.kind, 'recovery')))
        .all(),
    ).toEqual([]);
  });
});

describe('after a restart', () => {
  it('nothing lapses during the boot grace; the first scan after it expires everything overdue', () => {
    const a = agent();
    const id = task();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });

    // The server was down for ten minutes; the lease is well past.
    const boot = T0 + 10 * MIN;
    configureClaims({ bootedAt: boot });
    const grace = DEFAULT_CLAIM_TIMINGS.heartbeatMs;

    expect(leaseLapsed(T0 + LEASE, boot + grace - 1)).toBe(false);
    expect(expireClaims(t.db, boot + grace - 1).changed).toBe(0);
    expect(claimsOf(id)[0]?.state).toBe('active');

    expect(expireClaims(t.db, boot + grace).changed).toBe(1);
    expect(claimsOf(id)[0]?.state).toBe('expired');
  });

  it('a session heard during the grace keeps its claim: its heartbeat renews the overdue lease', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    const boot = T0 + 10 * MIN;
    configureClaims({ bootedAt: boot });

    const beat = heartbeatAgentSession(t.sqlite, t.db, a.actor, claim.session_id, boot + 5_000);

    expect(beat.claims[0]).toMatchObject({
      state: 'active',
      lease_expires_at: boot + 5_000 + LEASE,
    });
    expect(expireClaims(t.db, boot + 5 * MIN).changed).toBe(0);
  });
});

describe('the explicit reclaim', () => {
  function expired() {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    expireClaims(t.db, T0 + LEASE);
    return { a, id, claim };
  }

  it('inserts a new claim at generation + 1 and writes task.claim_reclaimed; the old one stays refused', () => {
    const { a, id, claim } = expired();

    const taken = reclaimTask(t.sqlite, t.db, a.actor, id, {
      sessionId: claim.session_id,
      now: T0 + LEASE + MIN,
    });

    expect(taken).toMatchObject({
      from_generation: 1,
      claim: { generation: 2, state: 'active', session_id: claim.session_id },
    });
    expect(claimsOf(id).map((c) => [c.generation, c.state])).toEqual([
      [1, 'expired'],
      [2, 'active'],
    ]);
    const [row] = rows(id, 'task.claim_reclaimed');
    expect(row?.actorKind).toBe('agent');
    expect(JSON.parse(row!.payloadJson)).toEqual({
      from_generation: 1,
      generation: 2,
      session_id: claim.session_id,
      agent_id: a.id,
    });

    expect(
      refusal(() =>
        updateTask(t.db, at(a.actor, 1), id, { title: 'Old', now: T0 + LEASE + 2 * MIN }),
      ),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    expect(
      updateTask(t.db, at(a.actor, 2), id, { title: 'New', now: T0 + LEASE + 2 * MIN }).title,
    ).toBe('New');
  });

  it('refuses a token without full scope: token_read_only', () => {
    const { a, id } = expired();
    const readOnly = { ...a.actor, token: { ...a.actor.token!, scope: 'read_only' as const } };
    expect(refusal(() => reclaimTask(t.sqlite, t.db, readOnly, id, { now: T0 + LEASE }))).toEqual({
      code: 'forbidden',
      reason: 'token_read_only',
    });
    expect(claimsOf(id)).toHaveLength(1);
  });

  it('refuses an agent revoked since its token was read: agent_revoked', () => {
    const { a, id } = expired();
    revokeAgent(t.sqlite, t.db, owner, a.id, T0 + LEASE);
    expect(refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE }))).toEqual({
      code: 'forbidden',
      reason: 'agent_revoked',
    });
  });

  it('refuses an agent whose grant was taken away since: agent_not_granted', () => {
    const { a, id } = expired();
    setAgentGrants(t.sqlite, t.db, owner, a.id, [], T0 + LEASE);
    expect(refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE }))).toEqual({
      code: 'forbidden',
      reason: 'agent_not_granted',
    });
  });

  it('refuses any other agent: nothing of theirs to reclaim', () => {
    const { id } = expired();
    const other = agent('Other');
    expect(
      refusal(() => reclaimTask(t.sqlite, t.db, other.actor, id, { now: T0 + LEASE })),
    ).toEqual({ code: 'conflict', reason: 'nothing_to_reclaim' });
  });

  it('refuses while a claim is live: there is nothing to reclaim', () => {
    const a = agent();
    const id = task();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });
    expect(refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + 1 }))).toEqual({
      code: 'conflict',
      reason: 'claim_held',
    });
  });

  it('TODO(LAI-546): leaves the task’s offers alone — the offer steps are reclaimOfferSteps', () => {
    const a = agent();
    const id = task();
    updateTask(t.db, owner, id, { selected_agent_id: a.id, now: T0 });
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    expireClaims(t.db, T0 + LEASE);
    const before = t.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, id)).all();

    reclaimTask(t.sqlite, t.db, a.actor, id, { sessionId: claim.session_id, now: T0 + LEASE });

    expect(t.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, id)).all()).toEqual(
      before,
    );
  });
});

describe('sessions', () => {
  it('only a registered agent’s token has one: not_an_agent', () => {
    expect(refusal(() => startAgentSession(t.db, owner, {}, T0))).toEqual({
      code: 'forbidden',
      reason: 'not_an_agent',
    });
  });

  it('ending one releases its claims, so the next claim needs no reclaim', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;

    endAgentSession(t.sqlite, t.db, a.actor, claim.session_id, T0 + MIN);

    expect(claimsOf(id)[0]).toMatchObject({ state: 'released' });
    expect(startWorking(t.sqlite, t.db, a.actor, id, { now: T0 + 2 * MIN }).claim?.generation).toBe(
      2,
    );
  });

  it('revoking the agent ends its sessions; a heartbeat from them is refused and renews nothing', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;

    revokeAgent(t.sqlite, t.db, owner, a.id, T0 + MIN);

    expect(
      t.db.select().from(agentSessions).where(eq(agentSessions.id, claim.session_id)).get(),
    ).toMatchObject({ endedAt: T0 + MIN, endReason: 'agent_revoked' });
    // The token context loaded before the revoke: the session check still holds.
    expect(
      refusal(() => heartbeatAgentSession(t.sqlite, t.db, a.actor, claim.session_id, T0 + 2 * MIN)),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    expect(claimsOf(id)[0]?.leaseExpiresAt).toBe(T0 + LEASE);
    // The claim then lapses like any other.
    expect(expireClaims(t.db, T0 + LEASE).changed).toBe(1);
  });

  it('another agent’s session is a 404', () => {
    const a = agent('A');
    const b = agent('B');
    const session = startAgentSession(t.db, a.actor, {}, T0);
    expect(refusal(() => heartbeatAgentSession(t.sqlite, t.db, b.actor, session.id, T0))).toEqual({
      code: 'not_found',
      reason: undefined,
    });
  });
});
