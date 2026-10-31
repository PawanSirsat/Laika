import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent, revokeAgent } from '../../src/services/agents.ts';
import { endAgentSession, startAgentSession } from '../../src/services/claims.ts';
import {
  listContextDeliveries,
  recordContextDelivery,
} from '../../src/services/context-revisions.ts';
import { addMember, updateProjectContext } from '../../src/services/projects.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * Who a context revision was delivered to (SPEC §4.69, §6.4, LAI-1003). The
 * table keeps each session's **latest** delivery, so the list answers which
 * revision a session has now; another person's agent is never named (D-121).
 */

const T0 = 1_800_000_000_000;
const MIN = 60_000;

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, T0);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

/** A device per fixture agent: D-121 allows one active agent per harness per device. */
let fixtureDevices = 0;

function agentOf(person: ResolvedActor, name: string) {
  const device = `device-${String(++fixtureDevices)}`;
  const created = registerAgent(t.sqlite, t.db, person, {
    displayName: name,
    harness: 'claude-code',
    deviceLabel: device,
    grants: [{ projectId: s.projectId, scope: 'full' }],
  });
  return {
    id: created.agent.id,
    device,
    actor: resolveTokenActor(t.db, created.secret, T0),
  };
}

function member(): ResolvedActor {
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
  return loadActor(t.db, id)!;
}

/** Write the brief `count` times, so revisions 1..count exist. */
function revisions(count: number): void {
  for (let r = 0; r < count; r++) {
    updateProjectContext(t.db, owner, 'laika', {
      context_md: `brief ${String(r + 1)}`,
      base_revision: r,
      now: T0,
    });
  }
}

function session(agent: ReturnType<typeof agentOf>): string {
  return startAgentSession(t.db, agent.actor, {}, T0).id;
}

function deliver(agent: ReturnType<typeof agentOf>, sessionId: string, rev: number, at: number) {
  recordContextDelivery(t.db, agent.actor, sessionId, s.projectId, rev, at);
}

function list(
  reader: ResolvedActor,
  revision: number | null = null,
  page: { limit?: number; cursor?: { sortKey: number; id: string } | null } = {},
) {
  return listContextDeliveries(t.db, reader, 'laika', {
    revision,
    limit: page.limit ?? 50,
    cursor: page.cursor ?? null,
  }).rows;
}

function refusal(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('listContextDeliveries', () => {
  it('lists each session’s latest delivery, newest first, with the reader’s own agent named', () => {
    revisions(2);
    const a = agentOf(owner, 'Polly');
    const b = agentOf(owner, 'Codex');
    const first = session(a);
    const second = session(b);
    deliver(a, first, 1, T0 + MIN);
    deliver(b, second, 2, T0 + 2 * MIN);

    expect(list(owner)).toEqual([
      {
        session_id: second,
        revision: 2,
        delivered_at: T0 + 2 * MIN,
        session_ended_at: null,
        agent: {
          id: b.id,
          harness: 'claude-code',
          device_label: b.device,
          display_name: 'Codex',
          status: 'active',
        },
      },
      {
        session_id: first,
        revision: 1,
        delivered_at: T0 + MIN,
        session_ended_at: null,
        agent: {
          id: a.id,
          harness: 'claude-code',
          device_label: a.device,
          display_name: 'Polly',
          status: 'active',
        },
      },
    ]);
    expect(list(owner, 1).map((r) => r.session_id)).toEqual([first]);
    expect(list(owner, 2).map((r) => r.session_id)).toEqual([second]);
  });

  it('is the latest delivery only: a session given N+1 leaves N’s list', () => {
    revisions(2);
    const a = agentOf(owner, 'Polly');
    const id = session(a);
    deliver(a, id, 1, T0 + MIN);
    expect(list(owner, 1).map((r) => r.session_id)).toEqual([id]);
    expect(list(owner, 2)).toEqual([]);

    deliver(a, id, 2, T0 + 2 * MIN);
    expect(list(owner, 1)).toEqual([]);
    expect(list(owner, 2)).toMatchObject([
      { session_id: id, revision: 2, delivered_at: T0 + 2 * MIN },
    ]);
  });

  it('never names another person’s agent: no id, no label, no name', () => {
    revisions(1);
    const bob = member();
    const bobs = agentOf(bob, 'Bob’s secret name');
    const id = session(bobs);
    deliver(bobs, id, 1, T0 + MIN);

    const seenByOwner = list(owner, 1);
    expect(seenByOwner).toEqual([
      { session_id: id, revision: 1, delivered_at: T0 + MIN, session_ended_at: null, agent: null },
    ]);
    const text = JSON.stringify(seenByOwner);
    expect(text).not.toContain(bobs.id);
    expect(text).not.toContain(bobs.device);
    expect(text).not.toContain('Bob’s secret name');

    // Bob sees their own, and Bob's agent's token reads as Bob.
    expect(list(bob, 1)[0]?.agent).toMatchObject({
      id: bobs.id,
      display_name: 'Bob’s secret name',
    });
    expect(list(bobs.actor, 1)[0]?.agent?.id).toBe(bobs.id);
  });

  it('keeps a revoked agent’s and an ended session’s deliveries, labelled', () => {
    revisions(1);
    const a = agentOf(owner, 'Polly');
    const id = session(a);
    deliver(a, id, 1, T0 + MIN);
    endAgentSession(t.sqlite, t.db, a.actor, id, T0 + 2 * MIN);
    revokeAgent(t.sqlite, t.db, owner, a.id, T0 + 3 * MIN);

    expect(list(owner, 1)).toMatchObject([
      {
        session_id: id,
        session_ended_at: T0 + 2 * MIN,
        agent: { id: a.id, device_label: a.device, status: 'revoked' },
      },
    ]);
  });

  it('a revision the project has not reached is the revision read’s 404', () => {
    revisions(1);
    expect(refusal(() => list(owner, 2))).toEqual({
      code: 'not_found',
      message: 'No context revision 2',
    });
    // Revision 0 is the empty document, which has no row and no delivery list.
    expect(refusal(() => list(owner, 0)).code).toBe('not_found');
  });

  it('a project the caller cannot read answers as a missing one, and reads nothing', () => {
    revisions(1);
    const a = agentOf(owner, 'Polly');
    deliver(a, session(a), 1, T0 + MIN);
    const outsider = newId();
    t.db
      .insert(users)
      .values({
        id: outsider,
        email: 'outsider@example.test',
        name: 'Outsider',
        orgRole: 'viewer',
        createdAt: new Date(T0),
        updatedAt: new Date(T0),
      })
      .run();
    const reader = loadActor(t.db, outsider)!;
    t.sqlite.prepare("UPDATE projects SET visibility = 'private' WHERE id = ?").run(s.projectId);

    const hidden = refusal(() => list(reader, 1));
    const missing = refusal(() =>
      listContextDeliveries(t.db, reader, 'nope', { revision: 1, limit: 50, cursor: null }),
    );
    expect(hidden.code).toBe('not_found');
    expect(hidden).toEqual({ ...missing, message: missing.message.replace('nope', 'laika') });
  });

  it('pages newest first by (delivered_at, session), in the same three statements however many', () => {
    revisions(1);
    const a = agentOf(owner, 'Polly');
    const ids = [1, 2, 3, 4, 5].map((i) => {
      const id = session(a);
      // Two share a time, so the session id breaks the tie.
      deliver(a, id, 1, T0 + Math.min(i, 4) * MIN);
      return id;
    });

    const first = list(owner, 1, { limit: 2 });
    expect(first).toHaveLength(3); // limit + 1: another page follows
    const seen = first.slice(0, 2);
    const last = seen[1]!;
    const rest = list(owner, 1, {
      limit: 50,
      cursor: { sortKey: last.delivered_at, id: last.session_id },
    });
    const all = [...seen, ...rest].map((r) => r.session_id);
    expect([...all].sort()).toEqual([...ids].sort());
    expect(new Set(all).size).toBe(5);
    const times = [...seen, ...rest].map((r) => r.delivered_at);
    expect(times).toEqual([...times].sort((x, y) => y - x));

    /** The statements prepared during `run`, the driver instrumented as claims.test.ts does. */
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
    let one: unknown[] = [];
    let five: unknown[] = [];
    const forOne = statementsDuring(() => (one = list(owner, 1, { limit: 1 }).slice(0, 1)));
    const forFive = statementsDuring(() => (five = list(owner, 1)));
    expect(one).toHaveLength(1);
    expect(five).toHaveLength(5);
    expect(forFive).toHaveLength(forOne.length);
    expect(forFive).toHaveLength(3);
  });
});
