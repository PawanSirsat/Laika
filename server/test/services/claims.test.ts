import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import {
  activity,
  agentSessions,
  handoffOffers,
  sprints,
  taskClaims,
  tasks,
  tokens,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { newId } from '../../src/db/ids.ts';
import { registerAgent, revokeAgent, setAgentGrants } from '../../src/services/agents.ts';
import { addMember } from '../../src/services/projects.ts';
import {
  configureClaims,
  DEFAULT_CLAIM_TIMINGS,
  endAgentSession,
  expireClaims,
  heartbeatAgentSession,
  leaseLapsed,
  liveClaimViews,
  reclaimTask,
  startAgentSession,
} from '../../src/services/claims.ts';
import { addComment } from '../../src/services/comments.ts';
import { createSprint, deleteSprint } from '../../src/services/sprints.ts';
import {
  changeStatus,
  createTask,
  finishTask,
  getTask,
  listTasks,
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

/** A device per fixture agent: D-120 allows one active agent per harness per device. */
let fixtureDevices = 0;

/** A registered agent of the owner, fully granted, acting through its own token. */
function agent(name = 'Claude', scope: 'full' | 'read_only' = 'full') {
  const created = registerAgent(t.sqlite, t.db, owner, {
    displayName: name,
    harness: 'claude-code',
    deviceLabel: `device-${++fixtureDevices}`,
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
    // A claim never assigns (D-114 item 7): unassigned stays unassigned.
    expect(started.task).toMatchObject({ assignee_id: null, status: 'in_progress' });
    const [moved] = t.db
      .select()
      .from(activity)
      .where(and(eq(activity.taskId, id), eq(activity.type, 'task.status_changed')))
      .all();
    expect(JSON.parse(moved!.payloadJson)).not.toHaveProperty('assignee_id');
    expect(JSON.parse(moved!.payloadJson)).toMatchObject({ via: 'claim', claim_generation: 1 });
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

  it('opens no recovery offer for a claim that expired with no verified checkpoint (§4.73)', () => {
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
    // Narrowed in the database after the request's actor was resolved: the
    // reclaim reads the row, not the actor it was handed.
    t.db.update(tokens).set({ scope: 'read_only' }).where(eq(tokens.id, a.actor.token!.id)).run();
    expect(refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE }))).toEqual({
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

  it('answers an agent whose grant was taken away since as if the task did not exist', () => {
    // With no grant it cannot read the project, and a reclaim answers a task
    // the caller cannot see exactly as one that does not exist (LAI-586
    // review) — it was `403 agent_not_granted` until then.
    const { a, id } = expired();
    setAgentGrants(t.sqlite, t.db, owner, a.id, [], T0 + LEASE);
    expect(refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE }))).toEqual({
      code: 'not_found',
      reason: undefined,
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

  it('leaves the task’s work requests alone — the offer steps close only hand-offs and recoveries (§9.1.1)', () => {
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

describe('the live claim on a task read (LAI-568)', () => {
  const SUSPECT = DEFAULT_CLAIM_TIMINGS.suspectMs;
  /** Each agent its own laptop (D-120); the first in a test is `laptop-1`. */
  let laptops = 0;
  beforeEach(() => {
    laptops = 0;
  });

  /** The task as a list read and a single read both serve it, at `now`. */
  function reads(id: string, now: number) {
    const listed = listTasks(t.db, owner, 'laika', { limit: 50, cursor: null, now }).find(
      (v) => v.id === id,
    );
    expect(listed, 'the task is on the list').toBeDefined();
    return { single: getTask(t.db, owner, id, now).claim, listed: listed!.claim };
  }

  function claimedOnDevice() {
    const created = registerAgent(t.sqlite, t.db, owner, {
      displayName: 'Claude',
      harness: 'claude-code',
      deviceLabel: `laptop-${++laptops}`,
      grants: [{ projectId: s.projectId, scope: 'full' }],
    });
    const a = { id: created.agent.id, actor: resolveTokenActor(t.db, created.secret, T0) };
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    return { a, id, claim };
  }

  it('serves the holder’s session, heartbeat, connection and generation on both reads', () => {
    const { a, id, claim } = claimedOnDevice();
    const expected = {
      generation: 1,
      state: 'active',
      agent_id: a.id,
      session_id: claim.session_id,
      lease_expires_at: T0 + LEASE,
      last_heartbeat_at: T0,
      // The server's own age of it, as of the read (LAI-597 review).
      heartbeat_age_ms: MIN,
      connection: 'live',
      suspect_after_ms: SUSPECT,
      device_label: 'laptop-1',
      // The session `startWorking` opened reported nothing (LAI-593).
      harness: null,
      harness_version: null,
      model: null,
    };

    const { single, listed } = reads(id, T0 + MIN);
    expect(single).toEqual(expected);
    expect(listed).toEqual(expected);
  });

  it('serves what the holding session said ran, on both reads (LAI-593)', () => {
    const a = agent();
    const id = task();
    const session = startAgentSession(
      t.db,
      a.actor,
      { harness: 'claude-code', harness_version: '2.1.0', model: 'claude-opus-5-5' },
      T0,
    );
    startWorking(t.sqlite, t.db, a.actor, id, { sessionId: session.id, now: T0 });

    const { single, listed } = reads(id, T0 + MIN);
    expect(single).toMatchObject({
      session_id: session.id,
      harness: 'claude-code',
      harness_version: '2.1.0',
      model: 'claude-opus-5-5',
    });
    expect(listed).toEqual(single);
  });

  it('a heartbeat that changes the model shows on the next read; one that omits it keeps it', () => {
    const a = agent();
    const id = task();
    const session = startAgentSession(t.db, a.actor, { model: 'gpt-5.5' }, T0);
    startWorking(t.sqlite, t.db, a.actor, id, { sessionId: session.id, now: T0 });
    expect(reads(id, T0 + MIN).single?.model).toBe('gpt-5.5');

    heartbeatAgentSession(t.sqlite, t.db, a.actor, session.id, T0 + MIN, { model: 'gpt-5.6' });
    const after = reads(id, T0 + 2 * MIN);
    expect(after.single?.model).toBe('gpt-5.6');
    expect(after.listed?.model).toBe('gpt-5.6');

    heartbeatAgentSession(t.sqlite, t.db, a.actor, session.id, T0 + 2 * MIN);
    expect(reads(id, T0 + 3 * MIN).single?.model).toBe('gpt-5.6');
  });

  it('null where the session reported nothing — never the agent’s registered harness', () => {
    // `agent()` registers harness `claude-code`; the session says nothing.
    const a = agent();
    const id = task();
    const session = startAgentSession(t.db, a.actor, { model: 'claude-opus-5-5' }, T0);
    startWorking(t.sqlite, t.db, a.actor, id, { sessionId: session.id, now: T0 });

    const { single, listed } = reads(id, T0 + MIN);
    expect(single).toMatchObject({
      harness: null,
      harness_version: null,
      model: 'claude-opus-5-5',
    });
    expect(listed).toEqual(single);
  });

  it('is null on a task nothing has claimed, on both reads', () => {
    const id = task();
    expect(reads(id, T0)).toEqual({ single: null, listed: null });
  });

  it('turns suspect at the suspect interval with no heartbeat, and live again after one', () => {
    const { a, id, claim } = claimedOnDevice();

    expect(reads(id, T0 + SUSPECT - 1).single?.connection).toBe('live');
    const late = reads(id, T0 + SUSPECT);
    expect(late.single?.connection).toBe('suspect');
    expect(late.listed?.connection).toBe('suspect');
    // Still the live claim: suspect decides nothing, the lease has not lapsed.
    expect(late.single).toMatchObject({ generation: 1, state: 'active' });

    expect(late.single?.heartbeat_age_ms).toBe(SUSPECT);
    expect(late.listed?.heartbeat_age_ms).toBe(SUSPECT);

    heartbeatAgentSession(t.sqlite, t.db, a.actor, claim.session_id, T0 + SUSPECT + MIN);
    expect(reads(id, T0 + SUSPECT + MIN).single).toMatchObject({
      connection: 'live',
      last_heartbeat_at: T0 + SUSPECT + MIN,
      heartbeat_age_ms: 0,
    });
  });

  it('is null once the lease has lapsed, before the scan and after it', () => {
    const { id } = claimedOnDevice();

    expect(reads(id, T0 + LEASE - 1).single?.generation).toBe(1);
    expect(reads(id, T0 + LEASE)).toEqual({ single: null, listed: null });

    expect(expireClaims(t.db, T0 + LEASE).changed).toBe(1);
    expect(claimsOf(id)[0]?.state).toBe('expired');
    expect(reads(id, T0 + LEASE)).toEqual({ single: null, listed: null });
    expect(rows(id, 'task.claim_expired')).toHaveLength(1);
  });

  it('is null once the claim is released — the holder finished, or ended its session', () => {
    const finished = claimedOnDevice();
    finishTask(t.sqlite, t.db, at(finished.a.actor, 1), finished.id, {
      summary: 'Done',
      now: T0 + MIN,
    });
    expect(claimsOf(finished.id)[0]?.state).toBe('released');
    expect(reads(finished.id, T0 + MIN)).toEqual({ single: null, listed: null });

    const ended = claimedOnDevice();
    endAgentSession(t.sqlite, t.db, ended.a.actor, ended.claim.session_id, T0 + MIN);
    expect(claimsOf(ended.id)[0]?.state).toBe('released');
    expect(reads(ended.id, T0 + MIN)).toEqual({ single: null, listed: null });
  });

  it('is null once the claim is transferred', () => {
    const { id } = claimedOnDevice();
    // No service writes `transferred` yet (LAI-546); the row is what a read sees.
    t.db
      .update(taskClaims)
      .set({ state: 'transferred', endedAt: T0 + MIN })
      .where(eq(taskClaims.taskId, id))
      .run();
    expect(reads(id, T0 + MIN)).toEqual({ single: null, listed: null });
  });

  it('serves a paused claim while its lease holds, and not once it lapsed', () => {
    const { id } = claimedOnDevice();
    t.db.update(taskClaims).set({ state: 'paused' }).where(eq(taskClaims.taskId, id)).run();
    const { single, listed } = reads(id, T0 + LEASE - 1);
    expect(single).toMatchObject({ state: 'paused', generation: 1 });
    expect(listed).toEqual(single);
    // Its lease lapses as an active one's does: the scan expires both live
    // states, so a read leaves it out before the scan runs (LAI-1012).
    expect(reads(id, T0 + LEASE)).toEqual({ single: null, listed: null });
    expect(claimsOf(id)[0]?.state).toBe('paused');
    expect(expireClaims(t.db, T0 + LEASE).changed).toBe(1);
    expect(claimsOf(id)[0]?.state).toBe('expired');
  });

  it('is suspect while a revoked agent’s claim waits to lapse: its session has ended', () => {
    const { a, id } = claimedOnDevice();
    revokeAgent(t.sqlite, t.db, owner, a.id, T0 + MIN);
    const { single, listed } = reads(id, T0 + 2 * MIN);
    expect(single).toMatchObject({ generation: 1, state: 'active', connection: 'suspect' });
    expect(listed).toEqual(single);
  });

  it('after a reclaim, serves only the live generation’s session and heartbeat', () => {
    const { a, id, claim: old } = claimedOnDevice();
    expect(expireClaims(t.db, T0 + LEASE).changed).toBe(1);

    const fresh = startAgentSession(t.db, a.actor, {}, T0 + LEASE + MIN);
    const taken = reclaimTask(t.sqlite, t.db, a.actor, id, {
      sessionId: fresh.id,
      now: T0 + LEASE + MIN,
    });
    expect(taken.claim).toMatchObject({ generation: 2, session_id: fresh.id });
    // The old session keeps beating, later than the new one: its heartbeat is
    // the newest on the task, and still not the claim's.
    heartbeatAgentSession(t.sqlite, t.db, a.actor, old.session_id, T0 + LEASE + 2 * MIN);
    expect(fresh.id).not.toBe(old.session_id);

    const { single, listed } = reads(id, T0 + LEASE + 2 * MIN);
    expect(single).toMatchObject({
      generation: 2,
      state: 'active',
      session_id: fresh.id,
      last_heartbeat_at: T0 + LEASE + MIN,
      lease_expires_at: T0 + LEASE + MIN + LEASE,
      connection: 'live',
    });
    expect(listed).toEqual(single);
    expect(claimsOf(id).map((c) => [c.generation, c.state])).toEqual([
      [1, 'expired'],
      [2, 'active'],
    ]);
  });

  it('reads the claims of a page in one statement, however many tasks it holds', () => {
    /** The statements prepared during `run` — the driver instrumented as LAI-091's test does. */
    function statementsDuring(run: () => void): string[] {
      const recorded: string[] = [];
      const real = t.sqlite.prepare.bind(t.sqlite);
      (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
        recorded.push(source);
        return real(source);
      };
      try {
        run();
      } finally {
        (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
      }
      return recorded;
    }

    const one = [claimedOnDevice().id];
    const five = [...one, ...[1, 2, 3, 4].map(() => claimedOnDevice().id)];

    let small = new Map<string, unknown>();
    let large = new Map<string, unknown>();
    const forOne = statementsDuring(() => (small = liveClaimViews(t.db, one, T0 + MIN)));
    const forFive = statementsDuring(() => (large = liveClaimViews(t.db, five, T0 + MIN)));

    // The census is real: every task came back with its claim.
    expect(small.size).toBe(1);
    expect(large.size).toBe(5);
    expect(forOne).toHaveLength(1);
    expect(forFive).toHaveLength(1);
    expect(forFive[0]).toMatch(/from "task_claims"/);
  });

  it('reads every claim on a page together: each task gets its own', () => {
    const first = claimedOnDevice();
    const second = claimedOnDevice();
    const free = task('Free');

    const page = listTasks(t.db, owner, 'laika', { limit: 50, cursor: null, now: T0 + MIN });
    const byId = new Map(page.map((v) => [v.id, v.claim]));
    expect(byId.get(first.id)?.session_id).toBe(first.claim.session_id);
    expect(byId.get(second.id)?.session_id).toBe(second.claim.session_id);
    expect(first.claim.session_id).not.toBe(second.claim.session_id);
    expect(byId.get(free)).toBeNull();
  });
});

describe('LAI-541 review: the bypasses, each closed', () => {
  function expiredClaim() {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    expireClaims(t.db, T0 + LEASE);
    return { a, id, claim };
  }

  function legacyActor(): ResolvedActor {
    return resolveTokenActor(
      t.db,
      createToken(t.sqlite, t.db, owner, { name: 'legacy', scope: 'full' }).secret,
      T0,
    );
  }

  it('B1: an expired holder that omits the generation is still refused, stale_claim with reclaim', () => {
    const { a, id } = expiredClaim();
    let caught: ApiError | undefined;
    try {
      updateTask(t.db, a.actor, id, { title: 'Sneaked', now: T0 + LEASE + 1 });
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught?.code).toBe('conflict');
    expect(caught?.details).toMatchObject({
      reason: 'stale_claim',
      reclaim: true,
      claim_generation: 1,
    });
    expect(getTask(t.db, owner, id).title).toBe('Work');
  });

  it('B1: a lapsed claim refuses every other token too — sibling agent and legacy token are claim_held', () => {
    const { id } = expiredClaim();
    const sibling = agent('Sibling');
    for (const caller of [sibling.actor, legacyActor()]) {
      expect(
        refusal(() => updateTask(t.db, caller, id, { title: 'X', now: T0 + LEASE + 1 })),
      ).toEqual({ code: 'conflict', reason: 'claim_held' });
    }
    // A person keeps explicit control.
    expect(updateTask(t.db, owner, id, { title: 'Human', now: T0 + LEASE + 1 }).title).toBe(
      'Human',
    );
  });

  it('B1: once a person moves the task out of progress, the lapsed claim no longer holds it', () => {
    const { a, id } = expiredClaim();
    changeStatus(t.db, owner, id, 'todo', T0 + LEASE + 1);
    expect(updateTask(t.db, a.actor, id, { title: 'After', now: T0 + LEASE + 2 }).title).toBe(
      'After',
    );
  });

  it('B1: a released claim leaves the task free; a generation sent with no live claim is stale_claim', () => {
    const a = agent();
    const id = task();
    const claim = startWorking(t.sqlite, t.db, a.actor, id, { now: T0 }).claim!;
    endAgentSession(t.sqlite, t.db, a.actor, claim.session_id, T0 + MIN);
    expect(updateTask(t.db, a.actor, id, { title: 'Free', now: T0 + 2 * MIN }).title).toBe('Free');
    expect(
      refusal(() => updateTask(t.db, at(a.actor, 1), id, { title: 'Gen', now: T0 + 2 * MIN })),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
  });

  it('B2b: a token cannot delete the sprint of a claimed task; sprint and sprint_id survive', () => {
    const a = agent();
    const id = task();
    const sprint = createSprint(t.sqlite, t.db, owner, 'laika', {
      name: 'S',
      starts_on: Date.UTC(2026, 0, 1),
      ends_on: Date.UTC(2026, 0, 14),
    });
    t.db.update(tasks).set({ sprintId: sprint.id }).where(eq(tasks.id, id)).run();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });

    expect(refusal(() => deleteSprint(t.sqlite, t.db, legacyActor(), sprint.id, T0 + MIN))).toEqual(
      { code: 'conflict', reason: 'claim_held' },
    );
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.sprintId).toBe(sprint.id);
    expect(t.db.select().from(sprints).where(eq(sprints.id, sprint.id)).get()).toBeDefined();
  });

  it('B3: reclaim reloads the owner — a person deactivated after the request resolved is owner_inactive', () => {
    const { a, id } = expiredClaim();
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, owner.userId)).run();
    expect(refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE }))).toEqual({
      code: 'forbidden',
      reason: 'owner_inactive',
    });
    expect(claimsOf(id)).toHaveLength(1);
  });

  it('B3: reclaim reloads the token — one revoked after the request resolved is token_revoked', () => {
    const { a, id } = expiredClaim();
    t.db
      .update(tokens)
      .set({ revokedAt: T0 + LEASE - 1 })
      .where(eq(tokens.id, a.actor.token!.id))
      .run();
    expect(refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE }))).toEqual({
      code: 'forbidden',
      reason: 'token_revoked',
    });
    expect(claimsOf(id)).toHaveLength(1);
  });

  it('B4: a task a person moved to review since the claim expired cannot be reclaimed: task_not_claimable', () => {
    const { a, id } = expiredClaim();
    changeStatus(t.db, owner, id, 'review', T0 + LEASE + 1);
    expect(
      refusal(() => reclaimTask(t.sqlite, t.db, a.actor, id, { now: T0 + LEASE + 2 })),
    ).toEqual({ code: 'conflict', reason: 'task_not_claimable' });
    expect(claimsOf(id).map((c) => c.state)).toEqual(['expired']);
  });

  it('B5: a claim never writes the assignee — not on a work request, not on an unassigned task', () => {
    const a = agent();
    const id = task();
    updateTask(t.db, owner, id, { selected_agent_id: a.id, now: T0 });

    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });

    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.assigneeId).toBeNull();
    expect(t.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, id)).get()?.state).toBe(
      'accepted',
    );
  });

  it('B5: the holder of the live claim answers the review rule — it finishes an unassigned task', () => {
    const a = agent();
    const id = task();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });

    const done = finishTask(t.sqlite, t.db, at(a.actor, 1), id, { summary: 'Done', now: T0 + MIN });

    expect(done).toMatchObject({ status: 'review', assignee_id: null });
  });

  it('non-blocking: the scan writes a claim’s state and its row in one transaction — both or neither', () => {
    const a = agent();
    const id = task();
    startWorking(t.sqlite, t.db, a.actor, id, { now: T0 });
    // The activity insert fails; the state change must roll back with it.
    t.sqlite.exec(`CREATE TRIGGER no_expiry_rows BEFORE INSERT ON activity
      WHEN NEW.type = 'task.claim_expired' BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`);

    expect(() => expireClaims(t.db, T0 + LEASE)).toThrow(/refused for the test/);

    expect(claimsOf(id)[0]?.state).toBe('active');
    expect(rows(id, 'task.claim_expired')).toEqual([]);
    t.sqlite.exec('DROP TRIGGER no_expiry_rows');
    expect(expireClaims(t.db, T0 + LEASE).changed).toBe(1);
  });
});

describe('LAI-541 review round 2: an agent is never more than its owner on the review rule', () => {
  /** A Member of the project — not a lead, not an admin — with a fully granted agent of their own. */
  function memberWithAgent() {
    const id = newId();
    t.db
      .insert(users)
      .values({
        id,
        email: `member-${id}@example.test`,
        name: 'Member',
        orgRole: 'member',
        createdAt: new Date(T0),
        updatedAt: new Date(T0),
      })
      .run();
    addMember(t.db, owner, 'laika', id, 'member', T0);
    const member = loadActor(t.db, id)!;
    const created = registerAgent(t.sqlite, t.db, member, {
      displayName: 'Member’s agent',
      harness: 'claude-code',
      deviceLabel: `device-${++fixtureDevices}`,
      grants: [{ projectId: s.projectId, scope: 'full' }],
    });
    return {
      member,
      agentId: created.agent.id,
      agent: resolveTokenActor(t.db, created.secret, T0),
    };
  }

  it('a Member’s agent may select itself onto and claim another person’s task — as its owner could edit it', () => {
    const m = memberWithAgent();
    const id = task();
    updateTask(t.db, owner, id, { assignee_id: owner.userId, now: T0 });
    // Selecting needs task.write, which a Member holds; it opens a work request.
    updateTask(t.db, m.member, id, { selected_agent_id: m.agentId, now: T0 });

    const started = startWorking(t.sqlite, t.db, m.agent, id, { now: T0 });

    expect(started.claim?.generation).toBe(1);
    expect(started.task.assignee_id).toBe(owner.userId);
  });

  it('but cannot finish it: the rule is asked of the owner, who is neither its assignee nor a lead', () => {
    const m = memberWithAgent();
    const id = task();
    updateTask(t.db, owner, id, { assignee_id: owner.userId, now: T0 });
    updateTask(t.db, m.member, id, { selected_agent_id: m.agentId, now: T0 });
    startWorking(t.sqlite, t.db, m.agent, id, { now: T0 });

    // The owner, a Member, is refused this move on someone else's task…
    expect(refusal(() => changeStatus(t.db, m.member, id, 'review', T0 + MIN))).toEqual({
      code: 'forbidden',
      reason: undefined,
    });
    // …and so is the agent, claim or no claim.
    expect(
      refusal(() =>
        finishTask(t.sqlite, t.db, at(m.agent, 1), id, { summary: 'Done', now: T0 + MIN }),
      ),
    ).toEqual({ code: 'forbidden', reason: undefined });
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.status).toBe('in_progress');
  });

  it('and can finish an unassigned task it holds: there the holder answers as the assignee', () => {
    const m = memberWithAgent();
    const id = task();
    startWorking(t.sqlite, t.db, m.agent, id, { now: T0 });

    expect(
      finishTask(t.sqlite, t.db, at(m.agent, 1), id, { summary: 'Done', now: T0 + MIN }),
    ).toMatchObject({ status: 'review', assignee_id: null });
  });
});
