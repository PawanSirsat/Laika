import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  agents,
  agentEventDeliveries,
  agentLauncherReports,
  capacityPings,
  orgs,
  projects,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  CAPACITY_PING_LIMITS,
  deviceLauncher,
  getAgentCapacity,
  getPing,
  launcherViewOf,
  LAUNCHER_FRESH_MS,
  pingAgent,
  pingAndWait,
  replyToPing,
  reportLauncher,
  resetCapacityPingRateLimits,
  type CapacityAnswer,
  type LauncherView,
} from '../../src/services/agent-capacity.ts';
import { listAgentEvents } from '../../src/services/agent-events.ts';
import { agentView, registerAgent, revokeAgent } from '../../src/services/agents.ts';
import { putHandoffPolicy } from '../../src/services/handoffs.ts';
import { addMember } from '../../src/services/projects.ts';
import { createTask, updateTask } from '../../src/services/tasks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * Capacity pings and launcher presence, at the service (SPEC §4.83, §4.84,
 * D-126, LAI-1038): who may ping, the one delivery, the repeat window, the
 * two rate buckets, the one answer inside the minute, who reads it, and the
 * word a presence report makes. The routes, the stream and MCP are
 * `test/http/routes/capacity-pings.test.ts`.
 */

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, T0);
  owner = loadActor(t.db, s.userId)!;
  resetCapacityPingRateLimits();
});

afterEach(() => {
  t.close();
});

interface AgentHandle {
  id: string;
  actor: ResolvedActor;
}

let devices = 0;

function agentOf(person: ResolvedActor, scope: 'full' | 'read_only' | null = 'full'): AgentHandle {
  const created = registerAgent(t.sqlite, t.db, person, {
    displayName: `agent ${String(devices)}`,
    harness: 'claude-code',
    deviceLabel: `device-${String(++devices)}`,
    grants: scope === null ? [] : [{ projectId: s.projectId, scope }],
  });
  return { id: created.agent.id, actor: resolveTokenActor(t.db, created.secret, T0) };
}

function person(role: 'member' | 'lead' | 'viewer' = 'member'): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Mira',
      orgRole: 'member',
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    })
    .run();
  addMember(t.db, owner, 'laika', id, role, T0);
  return loadActor(t.db, id)!;
}

function agentRow(id: string) {
  return t.db.select().from(agents).where(eq(agents.id, id)).get()!;
}

function task(title = 'Work'): string {
  return createTask(t.sqlite, t.db, owner, 'laika', { title, now: T0 }).id;
}

function ping(actor: ResolvedActor, agentId: string, now = T0, taskId?: string) {
  return pingAgent(t.sqlite, t.db, actor, agentId, { projectSlug: 'laika', taskId, now });
}

/** The refusal a call throws, as the wire carries it. */
function refusal(fn: () => unknown): { status: number; body: unknown } {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: error.toBody() };
    throw error;
  }
  throw new Error('expected a refusal, and the call succeeded');
}

const AGENT_404 = { status: 404, body: ApiError.agentNotFound().toBody() };

const ANSWER: CapacityAnswer = {
  launcher: {
    state: 'on',
    auto_pickup: { work_requests: true, handoffs: true },
    running: 0,
    max_concurrent: 1,
  },
  harness_ready: { credential: true, argv: true, hooks: true },
  session_live: false,
  battery: { state: 'ok', percent: 64, plugged: false },
  memory: { state: 'normal' },
  cli_version: '0.9.3',
  answered_by: 'launcher',
};

// --------------------------------------------------------------- who may ping

describe('who may ping (D-126 item 1)', () => {
  it('a person pings their own agent: one ping, one activity row, one delivery', () => {
    const mine = agentOf(owner);
    const bystander = agentOf(owner);
    const id = task();
    const { ping: made, created } = ping(owner, mine.id, T0, id);

    expect(created).toBe(true);
    expect(made).toMatchObject({
      agent_id: mine.id,
      project_id: s.projectId,
      task_id: id,
      state: 'pending',
      requested_by: { user_id: s.userId, agent_id: null },
      created_at: T0,
      expires_at: T0 + CAPACITY_PING_LIMITS.openMs,
      answered_at: null,
      answer: null,
    });

    const rows = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'agent.capacity_requested');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId: s.projectId, taskId: id, actorKind: 'user' });
    expect(JSON.parse(rows[0]!.payloadJson)).toEqual({
      ping_id: made.id,
      agent_id: mine.id,
      expires_at: T0 + CAPACITY_PING_LIMITS.openMs,
    });
    // The pinged agent only — never the bystander granted the same project.
    expect(
      t.db
        .select()
        .from(agentEventDeliveries)
        .where(eq(agentEventDeliveries.activityId, rows[0]!.id))
        .all()
        .map((d) => d.agentId),
    ).toEqual([mine.id]);
    expect(bystander.id).not.toBe(mine.id);
  });

  it('refuses everyone else with exactly the 404 of an id that names no agent', () => {
    const mira = person();
    const mirasAgent = agentOf(mira);
    const revoked = agentOf(owner);
    revokeAgent(t.sqlite, t.db, owner, revoked.id);
    const readOnly = agentOf(owner, 'read_only');
    const ungranted = agentOf(owner, null);

    // The baseline: an id nobody has.
    expect(refusal(() => ping(owner, newId()))).toEqual(AGENT_404);
    // Another owner's agent, both ways round (D-121 item 7).
    expect(refusal(() => ping(owner, mirasAgent.id))).toEqual(AGENT_404);
    expect(refusal(() => ping(mira, agentOf(owner).id))).toEqual(AGENT_404);
    // The owner's own, but not one they could select here.
    expect(refusal(() => ping(owner, revoked.id))).toEqual(AGENT_404);
    expect(refusal(() => ping(owner, readOnly.id))).toEqual(AGENT_404);
    expect(refusal(() => ping(owner, ungranted.id))).toEqual(AGENT_404);
    // A viewer may not delegate here at all — `can(agent.ping)` says no.
    const viewer = person('viewer');
    expect(refusal(() => ping(viewer, agentOf(viewer).id))).toEqual(AGENT_404);
    // Nothing was written by any of them.
    expect(t.db.select().from(capacityPings).all()).toEqual([]);
  });

  it('a space that does not let agents write refuses a selectable agent alike', () => {
    const mine = agentOf(owner);
    t.db.update(projects).set({ agentsAllowed: false }).where(eq(projects.id, s.projectId)).run();
    expect(refusal(() => ping(owner, mine.id))).toEqual(AGENT_404);
  });

  it('an agent pings what it could hand off to: its owner’s, and another owner’s only when the space allows', () => {
    const pinger = agentOf(owner);
    const sibling = agentOf(owner);
    const mira = person();
    const mirasAgent = agentOf(mira);

    expect(ping(pinger.actor, sibling.id).ping.requested_by).toEqual({
      user_id: s.userId,
      agent_id: pinger.id,
    });
    expect(refusal(() => ping(pinger.actor, mirasAgent.id))).toEqual(AGENT_404);

    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { allow_other_owners: true });
    expect(ping(pinger.actor, mirasAgent.id).created).toBe(true);

    // A read-only grant may not delegate, whatever the target.
    const reader = agentOf(owner, 'read_only');
    expect(refusal(() => ping(reader.actor, sibling.id))).toEqual(AGENT_404);
  });

  it('a task of another project, or none, is 404 and writes nothing', () => {
    const mine = agentOf(owner);
    expect(refusal(() => ping(owner, mine.id, T0, newId()))).toMatchObject({
      status: 404,
      body: { error: { message: 'No such task in this project' } },
    });
    expect(t.db.select().from(capacityPings).all()).toEqual([]);
  });
});

// ------------------------------------------------------- repeat and the rate

describe('the repeat window and the rate (D-126 item 2)', () => {
  it('a repeat within 15 s returns the open ping, and writes nothing', () => {
    const mine = agentOf(owner);
    const first = ping(owner, mine.id, T0).ping;
    const again = ping(owner, mine.id, T0 + CAPACITY_PING_LIMITS.repeatMs - 1);
    expect(again).toEqual({ ping: { ...first }, created: false });
    expect(t.db.select().from(capacityPings).all()).toHaveLength(1);

    // At 15 s it is a new ping; so is one about another task.
    expect(ping(owner, mine.id, T0 + CAPACITY_PING_LIMITS.repeatMs).created).toBe(true);
    expect(ping(owner, mine.id, T0 + CAPACITY_PING_LIMITS.repeatMs, task()).created).toBe(true);
  });

  it('an answered ping is not open: the next one is new', () => {
    const mine = agentOf(owner);
    const first = ping(owner, mine.id, T0).ping;
    replyToPing(t.sqlite, t.db, mine.actor, first.id, ANSWER, T0 + 1);
    expect(ping(owner, mine.id, T0 + 2).created).toBe(true);
  });

  it('allows 4 a minute from one requester to one agent, then 429 with how long to wait', () => {
    const mine = agentOf(owner);
    const tasks = [task('a'), task('b'), task('c'), task('d')];
    for (const id of tasks) expect(ping(owner, mine.id, T0, id).created).toBe(true);

    expect(refusal(() => ping(owner, mine.id, T0))).toEqual({
      status: 429,
      body: {
        error: {
          code: 'rate_limited',
          message: 'Too many capacity pings for this agent',
          // One token back at 4 a minute is 15 s.
          details: { reason: 'capacity_ping_rate', retry_after_seconds: 15 },
        },
      },
    });
    expect(t.db.select().from(capacityPings).all()).toHaveLength(4);
    // Refilled, one token at a time.
    expect(ping(owner, mine.id, T0 + 15_000).created).toBe(true);
  });

  it('allows 30 a minute to one agent from everyone, and a refusal spends neither bucket', () => {
    const target = agentOf(owner);
    const pingers = Array.from({ length: 8 }, () => agentOf(owner));
    const tasks = [task('a'), task('b'), task('c'), task('d')];
    let made = 0;
    for (const pinger of pingers) {
      for (const id of tasks) {
        if (made === 30) {
          expect(refusal(() => ping(pinger.actor, target.id, T0, id))).toMatchObject({
            status: 429,
            body: { error: { details: { reason: 'capacity_ping_rate' } } },
          });
        } else if (made < 30) {
          expect(ping(pinger.actor, target.id, T0, id).created).toBe(true);
        }
        made += 1;
      }
    }
    expect(t.db.select().from(capacityPings).all()).toHaveLength(30);
    // Two seconds refill one of the agent's 30; the refused requester's own
    // bucket was not spent, so its next ping goes through.
    const last = pingers.at(-1)!;
    expect(ping(last.actor, target.id, T0 + 2_000, tasks[3]).created).toBe(true);
  });

  it('a refused ping spends nothing: an outsider cannot drain an agent’s bucket', () => {
    const target = agentOf(owner);
    const mira = person();
    for (let i = 0; i < 40; i += 1) {
      expect(refusal(() => ping(mira, target.id, T0, task(`t${String(i)}`)))).toEqual(AGENT_404);
    }
    expect(ping(owner, target.id, T0).created).toBe(true);
  });
});

// -------------------------------------------------------------------- answer

describe('the answer (D-126 item 3)', () => {
  it('is accepted once, from the pinged agent, inside the minute', () => {
    const mine = agentOf(owner);
    const made = ping(owner, mine.id, T0).ping;

    const answered = replyToPing(t.sqlite, t.db, mine.actor, made.id, ANSWER, T0 + 5_000);
    expect(answered).toMatchObject({ state: 'answered', answered_at: T0 + 5_000, answer: ANSWER });
    expect(getPing(t.db, owner, made.id, T0 + 6_000)).toMatchObject({
      state: 'answered',
      answer: ANSWER,
    });

    expect(
      refusal(() => replyToPing(t.sqlite, t.db, mine.actor, made.id, ANSWER, T0 + 6_000)),
    ).toMatchObject({ status: 409, body: { error: { details: { reason: 'already_answered' } } } });
  });

  it('a first answer at the minute or later is 409 ping_expired; just before is taken', () => {
    const mine = agentOf(owner);
    const late = ping(owner, mine.id, T0).ping;
    expect(
      refusal(() =>
        replyToPing(t.sqlite, t.db, mine.actor, late.id, ANSWER, T0 + CAPACITY_PING_LIMITS.openMs),
      ),
    ).toMatchObject({
      status: 409,
      body: { error: { details: { reason: 'ping_expired', ping_id: late.id } } },
    });
    expect(getPing(t.db, owner, late.id, T0 + CAPACITY_PING_LIMITS.openMs).state).toBe('expired');

    const onTime = ping(owner, mine.id, T0, task()).ping;
    expect(
      replyToPing(
        t.sqlite,
        t.db,
        mine.actor,
        onTime.id,
        ANSWER,
        T0 + CAPACITY_PING_LIMITS.openMs - 1,
      ).state,
    ).toBe('answered');
  });

  it('an agent it was not addressed to gets the 404 of a ping that does not exist', () => {
    const mine = agentOf(owner);
    const other = agentOf(owner);
    const made = ping(owner, mine.id, T0).ping;
    const unknown = refusal(() =>
      replyToPing(t.sqlite, t.db, other.actor, newId(), ANSWER, T0 + 1),
    );
    expect(unknown).toEqual({
      status: 404,
      body: { error: { code: 'not_found', message: 'No such capacity ping', details: null } },
    });
    expect(
      refusal(() => replyToPing(t.sqlite, t.db, other.actor, made.id, ANSWER, T0 + 1)),
    ).toEqual(unknown);
    expect(t.db.select().from(capacityPings).get()!.answeredAt).toBeNull();
  });

  it('a person cannot answer: 403 not_an_agent', () => {
    const mine = agentOf(owner);
    const made = ping(owner, mine.id, T0).ping;
    expect(
      refusal(() => replyToPing(t.sqlite, t.db, owner, made.id, ANSWER, T0 + 1)),
    ).toMatchObject({ status: 403, body: { error: { details: { reason: 'not_an_agent' } } } });
  });

  it('is read by whoever pinged and the agent’s owner, and by nobody else', () => {
    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { allow_other_owners: true });
    const mira = person();
    const mirasAgent = agentOf(mira);
    const pinger = agentOf(owner);
    const made = ping(pinger.actor, mirasAgent.id, T0).ping;
    replyToPing(t.sqlite, t.db, mirasAgent.actor, made.id, ANSWER, T0 + 1);

    // The requester's person, and its agent: the pinging agent named.
    expect(getPing(t.db, owner, made.id, T0 + 2).requested_by).toEqual({
      user_id: s.userId,
      agent_id: pinger.id,
    });
    expect(getPing(t.db, pinger.actor, made.id, T0 + 2).answer).toEqual(ANSWER);
    // The agent's owner: the answer, and not the other owner's agent.
    expect(getPing(t.db, mira, made.id, T0 + 2)).toMatchObject({
      answer: ANSWER,
      requested_by: { user_id: s.userId, agent_id: null },
    });
    // Anyone else: the 404 of a ping that does not exist.
    const lead = person('lead');
    expect(refusal(() => getPing(t.db, lead, made.id, T0 + 2))).toEqual(
      refusal(() => getPing(t.db, lead, newId(), T0 + 2)),
    );
  });

  it('rows older than seven days go when the next ping is written', () => {
    const mine = agentOf(owner);
    const old = ping(owner, mine.id, T0).ping;
    ping(owner, mine.id, T0 + 7 * DAY, task());
    expect(
      t.db
        .select()
        .from(capacityPings)
        .all()
        .map((r) => r.id),
    ).toContain(old.id);
    ping(owner, mine.id, T0 + 7 * DAY + 1, task());
    expect(
      t.db
        .select()
        .from(capacityPings)
        .all()
        .map((r) => r.id),
    ).not.toContain(old.id);
  });
});

describe('holding the request for the answer', () => {
  it('returns as soon as the device answers', async () => {
    const mine = agentOf(owner);
    const started = Date.now();
    const pending = pingAndWait(t.sqlite, t.db, owner, mine.id, {
      projectSlug: 'laika',
      waitMs: CAPACITY_PING_LIMITS.maxWaitMs,
    });
    const row = t.db.select().from(capacityPings).get()!;
    setTimeout(() => {
      replyToPing(t.sqlite, t.db, mine.actor, row.id, ANSWER);
    }, 20);
    const result = await pending;
    expect(result.ping).toMatchObject({ id: row.id, state: 'answered', answer: ANSWER });
    expect(Date.now() - started).toBeLessThan(CAPACITY_PING_LIMITS.maxWaitMs / 2);
  });

  it('answers pending when the wait runs out first', async () => {
    const mine = agentOf(owner);
    const result = await pingAndWait(t.sqlite, t.db, owner, mine.id, {
      projectSlug: 'laika',
      waitMs: 30,
    });
    expect(result.ping.state).toBe('pending');
  });
});

// ------------------------------------------------------------------ envelope

describe('the event the device receives (§4.76)', () => {
  it('a ping: the ping, the agent addressed, the task key and the project slug', () => {
    const mine = agentOf(owner);
    const id = task();
    const made = ping(owner, mine.id, T0, id).ping;
    const page = listAgentEvents(t.db, mine.actor, { after: 0, state: 'all', limit: 100 });
    const event = page.data.find((e) => e.type === 'agent.capacity_requested')!;
    expect(event).toMatchObject({
      schema_version: 2,
      task_id: id,
      task_key: 'LAI-1',
      project_slug: 'laika',
      to: { agent_id: mine.id, harness: 'claude-code' },
      ping: { id: made.id, expires_at: made.expires_at },
      offer: null,
      reason: null,
    });
  });

  it('a work request: the request id, the agent, the task key and the project slug', () => {
    const mine = agentOf(owner);
    const id = task();
    updateTask(t.db, owner, id, { selected_agent_id: mine.id });
    const page = listAgentEvents(t.db, mine.actor, { after: 0, state: 'all', limit: 100 });
    const event = page.data.find((e) => e.type === 'task.agent_selected')!;
    expect(event).toMatchObject({
      task_id: id,
      task_key: 'LAI-1',
      project_slug: 'laika',
      project_id: s.projectId,
      offer: { kind: 'work_request' },
      to: { agent_id: mine.id },
      ping: null,
    });
    expect(event.offer!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

// ------------------------------------------------- undelivered (LAI-1038 review)

describe('the inbox offers a ping only while it can be answered', () => {
  const undelivered = (actor: ResolvedActor, now: number, limit = 100) =>
    listAgentEvents(t.db, actor, { after: 0, state: 'undelivered', limit, now }).data;

  it('a ping leaves undelivered when its minute runs out; another verb stays', () => {
    const mine = agentOf(owner);
    updateTask(t.db, owner, task(), { selected_agent_id: mine.id });
    ping(owner, mine.id, T0);

    expect(
      undelivered(mine.actor, T0 + CAPACITY_PING_LIMITS.openMs - 1).map((e) => e.type),
    ).toEqual(['task.agent_selected', 'agent.capacity_requested']);
    expect(undelivered(mine.actor, T0 + CAPACITY_PING_LIMITS.openMs).map((e) => e.type)).toEqual([
      'task.agent_selected',
    ]);
    // Still in the record: `all` keeps it, unreceived.
    const all = listAgentEvents(t.db, mine.actor, {
      after: 0,
      state: 'all',
      limit: 100,
      now: T0 + CAPACITY_PING_LIMITS.openMs,
    }).data;
    expect(all.find((e) => e.type === 'agent.capacity_requested')?.delivery.state).toBe(
      'available',
    );
  });

  it('an answered ping leaves undelivered at once: the answer is its receipt', () => {
    const mine = agentOf(owner);
    const made = ping(owner, mine.id, T0).ping;
    replyToPing(t.sqlite, t.db, mine.actor, made.id, ANSWER, T0 + 1);
    expect(undelivered(mine.actor, T0 + 2)).toEqual([]);
    const all = listAgentEvents(t.db, mine.actor, {
      after: 0,
      state: 'all',
      limit: 100,
      now: T0 + 2,
    }).data;
    expect(all[0]?.delivery).toMatchObject({ state: 'received', received_at: T0 + 1 });
  });

  it('dead pings an old helper never acknowledged do not push a live event off the page', () => {
    const mine = agentOf(owner);
    for (let i = 0; i < 3; i += 1) ping(owner, mine.id, T0 + i * 16_000, task(`t${String(i)}`));
    updateTask(t.db, owner, task('live'), { selected_agent_id: mine.id });
    expect(undelivered(mine.actor, T0 + 10 * MIN, 1).map((e) => e.type)).toEqual([
      'task.agent_selected',
    ]);
  });
});

// ----------------------------------------------------------------- presence

describe('launcher presence (D-126 item 4)', () => {
  const REPORT = {
    enabled: true,
    autoPickup: { workRequests: true, handoffs: false },
    running: 1,
    maxConcurrent: 2,
    cliVersion: '0.9.3',
    startedAt: T0 - MIN,
  };

  it('is on only for an enabled report under three minutes old', () => {
    const mine = agentOf(owner);
    reportLauncher(t.db, mine.actor, REPORT, T0);
    const row = t.db.select().from(agentLauncherReports).get()!;

    expect(launcherViewOf(row, 'active', T0 + LAUNCHER_FRESH_MS - 1, true)).toEqual({
      state: 'on',
      reported_at: T0,
      started_at: T0 - MIN,
      running: 1,
      max_concurrent: 2,
      auto_pickup: { work_requests: true, handoffs: false },
      cli_version: '0.9.3',
    });
    expect(launcherViewOf(row, 'active', T0 + LAUNCHER_FRESH_MS, true).state).toBe('unknown');
    expect(launcherViewOf({ ...row, enabled: false }, 'active', T0, true).state).toBe('off');
    expect(launcherViewOf(row, 'revoked', T0, true).state).toBe('off');
  });

  it('never reported is off, with nothing else said', () => {
    const mine = agentOf(owner);
    const view = agentView(t.db, agentRow(mine.id), T0);
    expect(view.launcher).toEqual({
      state: 'off',
      reported_at: null,
      started_at: null,
      running: null,
      max_concurrent: null,
      auto_pickup: null,
      cli_version: null,
    });
  });

  it('one row per agent, replaced by each report; the agent view reads it', () => {
    const mine = agentOf(owner);
    reportLauncher(t.db, mine.actor, REPORT, T0);
    reportLauncher(t.db, mine.actor, { ...REPORT, running: 0 }, T0 + MIN);
    expect(t.db.select().from(agentLauncherReports).all()).toHaveLength(1);
    expect(agentView(t.db, agentRow(mine.id), T0 + MIN + 1).launcher).toMatchObject({
      state: 'on',
      running: 0,
      reported_at: T0 + MIN,
    });
  });

  it('with presence off, says nothing about when, and an enabled report is unknown', () => {
    const mine = agentOf(owner);
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();
    const view = reportLauncher(t.db, mine.actor, REPORT, T0);
    expect(view).toMatchObject({ state: 'unknown', reported_at: null, started_at: null });
    expect(t.db.select().from(agentLauncherReports).get()!.reportedAt).toBeNull();
  });

  it('a person cannot report: 403 not_an_agent', () => {
    expect(refusal(() => reportLauncher(t.db, owner, REPORT, T0))).toMatchObject({
      status: 403,
      body: { error: { details: { reason: 'not_an_agent' } } },
    });
  });

  it('a device is on if any active tool is, else unknown if any is, else off', () => {
    const at = (state: LauncherView['state'], reported: number | null): LauncherView => ({
      state,
      reported_at: reported,
      started_at: null,
      running: 0,
      max_concurrent: 1,
      auto_pickup: { work_requests: true, handoffs: true },
      cli_version: '1.0.0',
    });
    const active = 'active' as const;
    expect(
      deviceLauncher([
        { status: active, launcher: at('unknown', T0 + 5) },
        { status: active, launcher: at('on', T0) },
        { status: active, launcher: at('on', T0 + 2) },
      ]),
    ).toEqual(at('on', T0 + 2));
    expect(
      deviceLauncher([
        { status: active, launcher: at('off', T0 + 9) },
        { status: active, launcher: at('unknown', T0) },
      ]).state,
    ).toBe('unknown');
    // A revoked tool's last word counts for nothing.
    expect(deviceLauncher([{ status: 'revoked', launcher: at('on', T0) }]).state).toBe('off');
    expect(deviceLauncher([]).state).toBe('off');
  });
});

describe('getAgentCapacity', () => {
  it('the owner reads the newest answer to anyone; another pinger only its own', () => {
    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { allow_other_owners: true });
    const mira = person();
    const mirasAgent = agentOf(mira);
    const pinger = agentOf(owner);

    const hers = ping(mira, mirasAgent.id, T0).ping;
    replyToPing(t.sqlite, t.db, mirasAgent.actor, hers.id, ANSWER, T0 + 1);
    expect(getAgentCapacity(t.db, mira, mirasAgent.id, 'laika', T0 + 2).latest_answer?.id).toBe(
      hers.id,
    );
    expect(
      getAgentCapacity(t.db, pinger.actor, mirasAgent.id, 'laika', T0 + 2).latest_answer,
    ).toBeNull();

    const ours = ping(pinger.actor, mirasAgent.id, T0 + 3).ping;
    replyToPing(t.sqlite, t.db, mirasAgent.actor, ours.id, ANSWER, T0 + 4);
    expect(
      getAgentCapacity(t.db, pinger.actor, mirasAgent.id, 'laika', T0 + 5).latest_answer?.id,
    ).toBe(ours.id);
    // Refused as a ping is.
    expect(refusal(() => getAgentCapacity(t.db, owner, mirasAgent.id, 'laika', T0))).toEqual(
      AGENT_404,
    );
  });
});
