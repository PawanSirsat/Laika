import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity, latestActivitySeq } from '../../src/db/activity.ts';
import { AGENT_EVENT_SCHEMA_VERSION, AGENT_EVENT_TYPES } from '../../src/db/agent-events.ts';
import { ACTIVITY_TYPES } from '../../src/db/enums.ts';
import { activity, agentEventDeliveries, agentEvents, agents } from '../../src/db/schema.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { expectSqliteError, freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * The agent half of the activity log (SPEC §4.76, §4.77, LAI-553), at the
 * layer that writes it: `appendActivity` and nothing else. What the routes
 * make of it is `test/http/routes/agent-events.test.ts`.
 */

let t: TestDb;
let s: Seed;
let mine: { agentId: string; tokenId: string };
let other: string;

function agentOf(label: string) {
  const owner = loadActor(t.db, s.userId)!;
  const created = registerAgent(t.sqlite, t.db, owner, {
    displayName: label,
    harness: 'claude-code',
    deviceLabel: label,
    grants: [{ projectId: s.projectId, scope: 'full' }],
  });
  return { agentId: created.agent.id, tokenId: created.token.id };
}

/** One `project.context_updated` row: addressed to every agent granted the project. */
function contextChanged(actorTokenId: string | null = null) {
  return appendActivity(t.db, {
    orgId: s.orgId,
    projectId: s.projectId,
    actorId: s.userId,
    actorKind: actorTokenId === null ? 'user' : 'agent',
    actorTokenId,
    type: 'project.context_updated',
    payload: { revision: 3 },
  });
}

function deliveriesOf(activityId: string): string[] {
  return t.db
    .select({ agentId: agentEventDeliveries.agentId })
    .from(agentEventDeliveries)
    .where(eq(agentEventDeliveries.activityId, activityId))
    .all()
    .map((d) => d.agentId)
    .sort();
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  mine = agentOf('one');
  other = agentOf('two').agentId;
});

afterEach(() => {
  t.close();
});

describe('which rows are agent events (§4.76)', () => {
  it('names only §4.8 verbs', () => {
    for (const type of AGENT_EVENT_TYPES) expect(ACTIVITY_TYPES).toContain(type);
  });

  it('writes no envelope for any other verb', () => {
    const row = appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'task.created',
    });
    expect(t.db.select().from(agentEvents).where(eq(agentEvents.activityId, row.id)).all()).toEqual(
      [],
    );
  });
});

describe('the envelope is written with its row (§4.76)', () => {
  it('carries the row’s sequence and the schema version', () => {
    const row = contextChanged();
    const seq = latestActivitySeq(t.db);
    const [event] = t.db.select().from(agentEvents).where(eq(agentEvents.activityId, row.id)).all();
    expect(event).toMatchObject({ schemaVersion: AGENT_EVENT_SCHEMA_VERSION, offerId: null, seq });
    expect(JSON.parse(event!.detailJson)).toMatchObject({ context_revision: 3 });
  });

  it('rolls back with the row: a failed transaction leaves neither', () => {
    const before = t.db.select().from(agentEvents).all().length;
    expect(() =>
      t.db.transaction(() => {
        contextChanged();
        throw new Error('the write that described it failed');
      }),
    ).toThrow('the write that described it failed');
    expect(t.db.select().from(agentEvents).all()).toHaveLength(before);
    expect(t.db.select().from(agentEventDeliveries).all()).toHaveLength(0);
    expect(
      t.db.select().from(activity).where(eq(activity.type, 'project.context_updated')).all(),
    ).toEqual([]);
  });
  it('a failed envelope takes its row with it: the row is not logged alone', () => {
    // Occupy the next sequence with another row's envelope, so the context
    // change's own envelope breaks `agent_events_seq_idx` as it is written.
    const other = appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'task.created',
    });
    t.db
      .insert(agentEvents)
      .values({
        activityId: other.id,
        seq: latestActivitySeq(t.db) + 1,
        schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
        offerId: null,
        detailJson: '{}',
      })
      .run();
    expectSqliteError(() => contextChanged(), /UNIQUE constraint failed: agent_events\.seq/);
    expect(
      t.db.select().from(activity).where(eq(activity.type, 'project.context_updated')).all(),
    ).toEqual([]);
  });
});

describe('who it is delivered to (§4.77)', () => {
  it('every active agent granted the project', () => {
    expect(deliveriesOf(contextChanged().id)).toEqual([mine.agentId, other].sort());
  });

  it('never the agent that wrote it', () => {
    expect(deliveriesOf(contextChanged(mine.tokenId).id)).toEqual([other]);
  });

  it('never a revoked agent', () => {
    t.db
      .update(agents)
      .set({ status: 'revoked', revokedAt: Date.now() })
      .where(eq(agents.id, other))
      .run();
    expect(deliveriesOf(contextChanged().id)).toEqual([mine.agentId]);
  });

  it('starts available: neither received nor presented', () => {
    const row = contextChanged();
    expect(
      t.db
        .select()
        .from(agentEventDeliveries)
        .where(eq(agentEventDeliveries.activityId, row.id))
        .all()
        .map((d) => [d.receivedAt, d.presentedAt, d.availableAt]),
    ).toEqual([
      [null, null, row.createdAt],
      [null, null, row.createdAt],
    ]);
  });
});

describe('the database refuses presented before received (§4.77 CHECK)', () => {
  it('whatever wrote it', () => {
    const row = contextChanged();
    expectSqliteError(
      () =>
        t.db
          .update(agentEventDeliveries)
          .set({ presentedAt: Date.now() })
          .where(eq(agentEventDeliveries.activityId, row.id))
          .run(),
      /CHECK constraint failed: agent_event_deliveries_presented_after_received_check/,
    );
  });
});
