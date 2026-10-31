import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../src/db/activity.ts';
import { newId } from '../../src/db/ids.ts';
import { statusForCategory } from '../../src/db/project-statuses.ts';
import { agentEventDeliveries, projects, tasks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { ackAgentEvents, listAgentEvents } from '../../src/services/agent-events.ts';
import { registerAgent, setAgentGrants } from '../../src/services/agents.ts';
import { createToken } from '../../src/services/tokens.ts';
import { freshDb, preparedDuring, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/agent-events.ts` (SPEC §4.77, §6.4, LAI-553) on its own: the rules
 * a route cannot show by its status alone. Over HTTP, streams and MCP, see
 * `test/http/routes/agent-events.test.ts`.
 */

let t: TestDb;
let s: Seed;
let agentId: string;
let secret: string;
let otherProject: string;

const owner = () => loadActor(t.db, s.userId)!;
const asAgent = () => resolveTokenActor(t.db, secret, Date.now());

/** A context change in `projectId`, addressed to every agent granted it. */
function contextChanged(projectId: string): string {
  return appendActivity(t.db, {
    orgId: s.orgId,
    projectId,
    actorId: s.userId,
    actorKind: 'user',
    type: 'project.context_updated',
    payload: { revision: 1 },
  }).id;
}

function refusal(fn: () => unknown): { code: string; details: unknown } {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return { code: error.code, details: error.details };
    throw error;
  }
  throw new Error('expected a refusal; it succeeded');
}

/** Every statement one poll prepares, as `EXPLAIN QUERY PLAN` lines — the poll alone is measured. */
function pollPlans(actor: ReturnType<typeof asAgent>, state: 'undelivered' | 'all'): string[][] {
  return preparedDuring(t.sqlite, () =>
    listAgentEvents(t.db, actor, { after: 0, state, limit: 100 }),
  ).map((source) => {
    const bindings = Array.from({ length: (source.match(/\?/g) ?? []).length }, () => 'x');
    return (
      t.sqlite.prepare(`EXPLAIN QUERY PLAN ${source}`).all(...bindings) as { detail: string }[]
    ).map((row) => row.detail);
  });
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  otherProject = 'other-project-id';
  const now = Date.now();
  t.db
    .insert(projects)
    .values({
      id: otherProject,
      orgId: s.orgId,
      name: 'Other',
      slug: 'other',
      prefix: 'OTH',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const created = registerAgent(t.sqlite, t.db, owner(), {
    displayName: 'one',
    harness: 'claude-code',
    deviceLabel: 'one',
    grants: [
      { projectId: s.projectId, scope: 'full' },
      { projectId: otherProject, scope: 'full' },
    ],
  });
  agentId = created.agent.id;
  secret = created.secret;
});

afterEach(() => {
  t.close();
});

describe('ackAgentEvents is all or nothing', () => {
  it('one unknown id refuses the batch, and the known one stays unreceived', () => {
    const known = contextChanged(s.projectId);
    expect(
      refusal(() =>
        ackAgentEvents(t.sqlite, t.db, asAgent(), {
          eventIds: [known, 'no-such-event'],
          state: 'received',
        }),
      ),
    ).toEqual({ code: 'not_found', details: { event_ids: ['no-such-event'] } });
    expect(
      t.db
        .select({ receivedAt: agentEventDeliveries.receivedAt })
        .from(agentEventDeliveries)
        .where(eq(agentEventDeliveries.activityId, known))
        .get()?.receivedAt,
    ).toBeNull();
  });

  it('presented for a batch where one was never received records nothing', () => {
    const a = contextChanged(s.projectId);
    const b = contextChanged(s.projectId);
    ackAgentEvents(t.sqlite, t.db, asAgent(), { eventIds: [a], state: 'received' });
    expect(
      refusal(() =>
        ackAgentEvents(t.sqlite, t.db, asAgent(), { eventIds: [a, b], state: 'presented' }),
      ),
    ).toEqual({ code: 'conflict', details: { reason: 'not_received', event_ids: [b] } });
    expect(
      t.db
        .select({ presentedAt: agentEventDeliveries.presentedAt })
        .from(agentEventDeliveries)
        .where(eq(agentEventDeliveries.activityId, a))
        .get()?.presentedAt,
    ).toBeNull();
  });
});

describe('listAgentEvents', () => {
  it('moves its cursor past rows the agent may no longer read, and does not return them', () => {
    contextChanged(otherProject);
    const shown = contextChanged(s.projectId);
    setAgentGrants(t.sqlite, t.db, owner(), agentId, [{ projectId: s.projectId, scope: 'full' }]);

    const page = listAgentEvents(t.db, asAgent(), { after: 0, state: 'all', limit: 1 });
    expect(page.data.map((e) => e.event_id)).toEqual([shown]);
    expect(page.has_more).toBe(false);
    // The hidden row came first and was skipped, not counted against the limit.
    expect(page.data[0]!.cursor).toBe(page.cursor);
  });

  it('costs the same queries however many deliveries it may no longer read, and has_more counts only readable ones', () => {
    /** Statements one `limit: 1` page prepares with `hidden` unreadable deliveries behind it. */
    const costWith = (hidden: number): { statements: number; hasMore: boolean } => {
      t.close();
      t = freshDb();
      s = seed(t.db);
      const now = Date.now();
      t.db
        .insert(projects)
        .values({
          id: otherProject,
          orgId: s.orgId,
          name: 'Other',
          slug: 'other',
          prefix: 'OTH',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const created = registerAgent(t.sqlite, t.db, owner(), {
        displayName: 'one',
        harness: 'claude-code',
        deviceLabel: 'one',
        grants: [
          { projectId: s.projectId, scope: 'full' },
          { projectId: otherProject, scope: 'full' },
        ],
      });
      secret = created.secret;
      // Unreadable deliveries on both sides of the one readable event: before
      // it, a page that filtered row by row would read them one query at a
      // time; after it, a look-ahead that counted them would say has_more.
      for (let i = 0; i < hidden; i += 1) contextChanged(otherProject);
      contextChanged(s.projectId);
      for (let i = 0; i < hidden; i += 1) contextChanged(otherProject);
      setAgentGrants(t.sqlite, t.db, owner(), created.agent.id, [
        { projectId: s.projectId, scope: 'full' },
      ]);
      const actor = asAgent();
      let hasMore = true;
      const statements = preparedDuring(t.sqlite, () => {
        hasMore = listAgentEvents(t.db, actor, { after: 0, state: 'all', limit: 1 }).has_more;
      }).length;
      return { statements, hasMore };
    };

    const few = costWith(3);
    const many = costWith(60);
    expect(many.statements).toBe(few.statements);
    // A hidden event is a missing one: nothing more follows the readable one.
    expect([few.hasMore, many.hasMore]).toEqual([false, false]);
  });

  it('does bounded work: no statement scans, deliveries by the agent’s index range, activity by key', () => {
    const actor = asAgent();
    const plans = (state: 'undelivered' | 'all') => pollPlans(actor, state);

    for (const state of ['undelivered', 'all'] as const) {
      const all = plans(state).flat();
      // Not one full scan — of deliveries, of activity, of anything: the work
      // is the agent's grants and its new rows, never its lifetime of events
      // (LAI-553 review 2: readable projects came from a DISTINCT over every
      // delivery).
      expect(
        all.filter((line) => line.startsWith('SCAN ')),
        state,
      ).toEqual([]);
      expect(
        all.filter((line) => line.includes('agent_event_deliveries')),
        state,
      ).toEqual([
        expect.stringMatching(
          state === 'undelivered'
            ? // From cursor 0 an undelivered poll reads only unreceived rows:
              // the partial index holds nothing the agent has acknowledged.
              /^SEARCH agent_event_deliveries USING INDEX agent_event_deliveries_agent_undelivered_idx \(agent_id=\? AND seq>\?\)$/
            : /^SEARCH agent_event_deliveries USING INDEX agent_event_deliveries_agent_seq_idx \(agent_id=\? AND seq>\?\)$/,
        ),
      ]);
      expect(
        all.filter((line) =>
          /^SEARCH activity USING INDEX sqlite_autoindex_activity_1 \(id=\?\)$/.test(line),
        ),
        state,
      ).toHaveLength(1);
    }
  });

  // Seeding two thousand rows is the slow part, not the poll; on a loaded CI
  // runner it can pass vitest's 5 s default, as it did on #165's gate.
  it(
    'keeps the same bounded plans over a long history, with the planner’s real statistics',
    { timeout: 30_000 },
    () => {
      const actor = asAgent();
      const small = { undelivered: pollPlans(actor, 'undelivered'), all: pollPlans(actor, 'all') };

      // Two thousand old deliveries the agent has acknowledged, then three it
      // has not; ANALYZE so the planner chooses with real row counts, which is
      // where a plan that is bounded on an empty table can stop being bounded.
      const HISTORY = 2000;
      // One transaction: each append nests as a savepoint, so the history costs
      // one commit rather than two thousand.
      t.db.transaction(() => {
        for (let i = 0; i < HISTORY; i += 1) contextChanged(s.projectId);
        t.db.update(agentEventDeliveries).set({ receivedAt: Date.now() }).run();
      });
      const fresh = [
        contextChanged(s.projectId),
        contextChanged(s.projectId),
        contextChanged(s.projectId),
      ];
      t.sqlite.exec('ANALYZE');

      // The same access paths, step for step — the planner may order the two
      // by-key lookups (envelope, activity row) either way once it has row
      // counts, and both are one row per delivery. A scan, or any new path,
      // fails this.
      const steps = (plans: string[][]) => plans.map((plan) => [...plan].sort());
      expect(steps(pollPlans(actor, 'undelivered'))).toEqual(steps(small.undelivered));
      expect(steps(pollPlans(actor, 'all'))).toEqual(steps(small.all));

      // And what those plans answer: from cursor 0 the undelivered poll is
      // exactly the three, and an up-to-date poll is empty and stays put.
      const undelivered = listAgentEvents(t.db, actor, {
        after: 0,
        state: 'undelivered',
        limit: 100,
      });
      expect(undelivered.data.map((e) => e.event_id)).toEqual(fresh);
      const upToDate = listAgentEvents(t.db, actor, {
        after: undelivered.cursor,
        state: 'all',
        limit: 100,
      });
      expect([upToDate.data, upToDate.cursor, upToDate.has_more]).toEqual([
        [],
        undelivered.cursor,
        false,
      ]);
    },
  );

  it('is an agent’s: a personal token is forbidden, not_an_agent', () => {
    const personal = createToken(t.sqlite, t.db, owner(), {
      name: 'personal',
      scope: 'full',
      now: Date.now(),
    });
    expect(
      refusal(() =>
        listAgentEvents(t.db, resolveTokenActor(t.db, personal.secret, Date.now()), {
          after: 0,
          state: 'all',
          limit: 10,
        }),
      ),
    ).toEqual({ code: 'forbidden', details: { reason: 'not_an_agent' } });
  });
});

describe('the envelope names agents as the reader may see them (D-121 item 7, LAI-1011)', () => {
  it('an event delivered to agent A never names another owner’s agent A cannot see', () => {
    // Bob, another owner who reads the project, with his own agent on it.
    const bob = newId();
    const now = Date.now();
    t.db
      .insert(users)
      .values({
        id: bob,
        email: 'bob@example.test',
        name: 'Bob',
        orgRole: 'admin',
        isActive: 1,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
    const bobs = registerAgent(t.sqlite, t.db, loadActor(t.db, bob)!, {
      displayName: 'bob',
      harness: 'codex',
      deviceLabel: 'bob',
      grants: [{ projectId: s.projectId, scope: 'full' }],
    });
    // A task that now shows only our agent: Bob's selection was replaced.
    const taskId = newId();
    t.db
      .insert(tasks)
      .values({
        id: taskId,
        projectId: s.projectId,
        number: 1,
        title: 'A task',
        status: 'todo',
        statusId: statusForCategory(t.db, s.projectId, 'todo').id,
        priority: 'p2',
        createdBy: s.userId,
        createdVia: 'web',
        selectedAgentId: agentId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    // Written by Bob's agent's token: the writer, `from`, is his agent.
    const row = appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      taskId,
      actorId: bob,
      actorKind: 'agent',
      actorTokenId: bobs.token.id,
      type: 'task.agent_selected',
      payload: { from: bobs.agent.id, to: agentId },
    });

    const [event] = listAgentEvents(t.db, asAgent(), { after: 0, state: 'all', limit: 100 }).data;
    expect(event).toMatchObject({
      event_id: row.id,
      from: null,
      to: { agent_id: agentId },
      actor: { kind: 'agent', user_id: bob, agent_id: null, session_id: null },
      agent_redacted: true,
    });
    // Not anywhere — not in an offer, a field or a nested value.
    expect(JSON.stringify(event)).not.toContain(bobs.agent.id);

    // The ack answers the same envelope, through the same lens.
    const [acked] = ackAgentEvents(t.sqlite, t.db, asAgent(), {
      eventIds: [row.id],
      state: 'received',
    });
    expect(acked).toMatchObject({ from: null, agent_redacted: true });
    expect(JSON.stringify(acked)).not.toContain(bobs.agent.id);

    // The writer is not delivered its own write.
    expect(
      listAgentEvents(t.db, resolveTokenActor(t.db, bobs.secret, Date.now()), {
        after: 0,
        state: 'all',
        limit: 100,
      }).data,
    ).toEqual([]);
  });

  it('names an own agent and an agent the task shows, and says nothing was withheld', () => {
    const [event] = (() => {
      contextChanged(s.projectId);
      return listAgentEvents(t.db, asAgent(), { after: 0, state: 'all', limit: 100 }).data;
    })();
    expect(event!.agent_redacted).toBe(false);
  });
});
