import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { handoffOffers, projects } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent, revokeAgent } from '../../src/services/agents.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  assertAgentSelectable,
  moveSelection,
  selectedAgentViews,
} from '../../src/services/work-requests.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/work-requests.ts` (D-114 item 7, LAI-535): the eligibility order,
 * the one-open-request rule, and the view. The HTTP behaviour is
 * `test/http/routes/selected-agent.test.ts`'s.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function project() {
  return t.db.select().from(projects).where(eq(projects.id, s.projectId)).get()!;
}

/** A device per fixture agent: D-120 allows one active agent per harness per device. */
let fixtureDevices = 0;

function register(scope: 'full' | 'read_only' | null = 'full') {
  return registerAgent(t.sqlite, t.db, owner, {
    displayName: 'Claude',
    harness: 'claude-code',
    deviceLabel: `device-${++fixtureDevices}`,
    grants: scope === null ? [] : [{ projectId: s.projectId, scope }],
  }).agent;
}

function reasonOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    expect(api.code).toBe('unprocessable');
    return (api.details as { reason?: unknown } | undefined)?.reason;
  }
  throw new Error('expected a refusal, and nothing was thrown');
}

describe('assertAgentSelectable', () => {
  it('lets the owner select their own active, fully granted agent', () => {
    const agent = register();
    expect(() => assertAgentSelectable(t.db, owner, project(), agent.id)).not.toThrow();
  });

  it('says "not yours" before "revoked": the first thing the caller cannot fix', () => {
    const agent = register(null);
    revokeAgent(t.sqlite, t.db, owner, agent.id);

    // The check reads only the id, so another person needs no row of their own.
    const other = { ...owner, userId: newId() };

    expect(reasonOf(() => assertAgentSelectable(t.db, other, project(), agent.id))).toBe(
      'agent_other_owner',
    );
    expect(reasonOf(() => assertAgentSelectable(t.db, owner, project(), agent.id))).toBe(
      'agent_revoked',
    );
  });

  it('a read-only grant is refused separately from no grant', () => {
    expect(reasonOf(() => assertAgentSelectable(t.db, owner, project(), register(null).id))).toBe(
      'agent_not_granted',
    );
    expect(
      reasonOf(() => assertAgentSelectable(t.db, owner, project(), register('read_only').id)),
    ).toBe('agent_read_only');
  });
});

describe('moveSelection', () => {
  it('keeps at most one open work request per task, in SQL as well as in the service', () => {
    const agent = register();
    const task = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Work' });
    const now = Date.now();

    moveSelection(t.db, owner, task.id, agent.id, now);
    moveSelection(t.db, owner, task.id, agent.id, now + 1);

    const rows = t.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, task.id)).all();
    expect(rows.map((r) => r.state).sort()).toEqual(['cancelled', 'open']);

    // The partial unique index refuses a second open row written around the service.
    expect(() =>
      t.db
        .insert(handoffOffers)
        .values({
          id: newId(),
          taskId: task.id,
          kind: 'work_request',
          toAgentId: agent.id,
          state: 'open',
          createdByUserId: owner.userId,
          createdAt: now,
          closedAt: null,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed: handoff_offers\.task_id/);
  });
});

describe('selectedAgentViews', () => {
  it('names the owner and nothing secret', () => {
    const agent = register();
    const views = selectedAgentViews(t.db, [
      { selectedAgentId: agent.id },
      { selectedAgentId: null },
    ]);
    expect(views.size).toBe(1);
    const view = views.get(agent.id)!;
    expect(Object.keys(view).sort()).toEqual(
      ['device_label', 'display_name', 'harness', 'id', 'owner', 'status'].sort(),
    );
    expect(view.owner.id).toBe(owner.userId);
  });
});
