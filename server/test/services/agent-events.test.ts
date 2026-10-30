import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../src/db/activity.ts';
import { agentEventDeliveries, projects } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { ackAgentEvents, listAgentEvents } from '../../src/services/agent-events.ts';
import { registerAgent, setAgentGrants } from '../../src/services/agents.ts';
import { createToken } from '../../src/services/tokens.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

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
