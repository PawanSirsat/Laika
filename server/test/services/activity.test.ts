import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity, readActivityAfter, type ActivityEvent } from '../../src/db/activity.ts';
import { type ActivityType, type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import * as activityService from '../../src/services/activity.ts';
import {
  listOrgActivity,
  listProjectActivity,
  visibleProjectIds,
} from '../../src/services/activity.ts';
import { eventView, visibleTo } from '../../src/services/events.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let ownerId: string;
let orgId: string;
let alphaId: string;
let betaId: string;

const PAGE = { limit: 50, cursor: null };

function makeUser(orgRole: OrgRole): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole,
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function member(slug: string, role: 'lead' | 'member' | 'viewer'): string {
  const id = makeUser(role === 'viewer' ? 'viewer' : 'member');
  addMember(t.db, actor(ownerId), slug, id, role);
  return id;
}

/** Append one row at a chosen time, so ordering tests are not clock-dependent. */
function write(
  projectId: string | null,
  type: ActivityType,
  now: number,
  taskId: string | null = null,
): void {
  appendActivity(t.db, {
    orgId,
    projectId,
    taskId,
    actorId: ownerId,
    actorKind: 'user',
    type,
    payload: { at: now },
    now,
  });
}

/** Every row in the table, for the equivalence check. */
function allRows(): ActivityEvent[] {
  return readActivityAfter(t.db, 0, 1000);
}

function expectApiError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    expect(err.code).toBe(code);
    return;
  }
  throw new Error(`Expected an ApiError with code "${code}", but nothing was thrown`);
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  ownerId = makeUser('owner');
  orgId = newId();
  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();

  // `createProject` writes a `project.created` row. Stamping these at time 1 and
  // 2 keeps them at the bottom of every newest-first feed, so a test can say what
  // it means about the rows it wrote without arithmetic.
  alphaId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Alpha',
    slug: 'alpha',
    prefix: 'ALP',
    now: 1,
  }).id;
  betaId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Beta',
    slug: 'beta',
    prefix: 'BET',
    now: 2,
  }).id;
});
afterEach(() => {
  t.close();
});

describe('the module is read-only (AC6)', () => {
  it('exports readers and nothing that could write', () => {
    // §4.8 is append-only. `db/activity.ts` has the one writer and the database
    // refuses UPDATE and DELETE; a mutation here would be a door above a locked
    // door, so the export list is asserted rather than trusted.
    expect(Object.keys(activityService).sort()).toEqual([
      'listOrgActivity',
      'listProjectActivity',
      'visibleProjectIds',
    ]);
  });
});

describe('a project feed (AC1)', () => {
  it('returns that project’s rows, newest first (AC4)', () => {
    write(alphaId, 'task.created', 1000);
    write(alphaId, 'task.updated', 3000);
    write(alphaId, 'comment.added', 2000);
    write(betaId, 'task.created', 4000);

    const feed = listProjectActivity(t.db, actor(ownerId), 'alpha', PAGE);

    // …, 1 is Alpha's own `project.created` from setup.
    expect(feed.map((row) => row.created_at)).toEqual([3000, 2000, 1000, 1]);
    expect(feed.every((row) => row.project_id === alphaId)).toBe(true);
  });

  it('is open to every role in the project and closed to everyone else', () => {
    write(alphaId, 'task.created', 1000);

    for (const role of ['lead', 'member', 'viewer'] as const) {
      // The write above plus Alpha's `project.created`, and for the two non-viewer
      // roles the `member.added` written when they joined.
      expect(
        listProjectActivity(t.db, actor(member('alpha', role)), 'alpha', PAGE).length,
      ).toBeGreaterThanOrEqual(2);
    }

    expectApiError(
      () => listProjectActivity(t.db, actor(member('beta', 'member')), 'alpha', PAGE),
      'forbidden',
    );
    expectApiError(
      () => listProjectActivity(t.db, actor(makeUser('member')), 'alpha', PAGE),
      'forbidden',
    );
  });

  it('404s an unknown slug', () => {
    expectApiError(() => listProjectActivity(t.db, actor(ownerId), 'nope', PAGE), 'not_found');
  });
});

describe('the org-wide feed (AC2)', () => {
  it('does not leak a project the actor is not a member of', () => {
    write(alphaId, 'task.created', 1000);
    write(betaId, 'task.created', 2000);

    const inAlpha = listOrgActivity(t.db, actor(member('alpha', 'member')), PAGE);

    // The failure this criterion exists for: nothing from Beta, at all.
    expect(inAlpha.every((row) => row.project_id === alphaId)).toBe(true);
    expect(inAlpha.map((row) => row.created_at)).toContain(1000);
    expect(inAlpha.map((row) => row.created_at)).not.toContain(2000);
  });

  it('keeps a Viewer to their own project', () => {
    write(alphaId, 'task.created', 1000);
    write(betaId, 'task.created', 2000);

    const feed = listOrgActivity(t.db, actor(member('alpha', 'viewer')), PAGE);

    expect(feed.every((row) => row.project_id === alphaId)).toBe(true);
    expect(feed.map((row) => row.created_at)).not.toContain(2000);
  });

  it('shows an org member with no project nothing at all', () => {
    write(alphaId, 'task.created', 1000);
    write(betaId, 'task.created', 2000);
    write(null, 'token.created', 3000);

    expect(listOrgActivity(t.db, actor(makeUser('member')), PAGE)).toEqual([]);
  });

  it('gives an Owner every project and the org-scoped rows too', () => {
    write(alphaId, 'task.created', 1000);
    write(betaId, 'task.created', 2000);
    write(null, 'token.created', 3000);

    const feed = listOrgActivity(t.db, actor(ownerId), PAGE);

    expect(feed.map((row) => row.type)).toContain('token.created');
    expect(new Set(feed.map((row) => row.project_id))).toEqual(new Set([alphaId, betaId, null]));
  });

  it('withholds org-scoped rows from a project lead', () => {
    write(null, 'token.created', 3000);
    write(alphaId, 'task.created', 1000);

    const feed = listOrgActivity(t.db, actor(member('alpha', 'lead')), PAGE);

    // `token.created` is the audit trail, and §3.1 grants that to Owner/Admin.
    expect(feed.map((row) => row.type)).not.toContain('token.created');
    expect(feed.map((row) => row.created_at)).toContain(1000);
  });

  it('still gives an Admin the audit trail when they can see no project', () => {
    // The composed case: an empty visible-project set must not swallow the
    // org-scoped rows, and must not be read as "all projects" either.
    write(null, 'token.created', 3000);
    write(alphaId, 'task.created', 1000);

    const empty = freshDb();
    try {
      const now = Date.now();
      const adminId = newId();
      const otherOrg = newId();
      empty.db
        .insert(users)
        .values({
          id: adminId,
          email: 'admin@example.test',
          name: 'Admin',
          orgRole: 'admin',
          avatarColor: '#123456',
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .run();
      empty.db
        .insert(orgs)
        .values({
          id: otherOrg,
          name: 'Laika',
          ownerUserId: adminId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      appendActivity(empty.db, {
        orgId: otherOrg,
        projectId: null,
        actorId: adminId,
        actorKind: 'user',
        type: 'org.created',
        now: 500,
      });

      const admin = loadActor(empty.db, adminId);
      if (admin === null) throw new Error('no admin');

      // No projects exist, so `visibleProjectIds` is empty.
      expect(visibleProjectIds(empty.db, admin)).toEqual([]);
      expect(listOrgActivity(empty.db, admin, PAGE).map((row) => row.type)).toEqual([
        'org.created',
      ]);
    } finally {
      empty.close();
    }
  });

  it('refuses a deactivated user', () => {
    write(alphaId, 'task.created', 1000);
    const id = member('alpha', 'member');
    const deactivated = { ...actor(id), isActive: false };

    expectApiError(() => listOrgActivity(t.db, deactivated, PAGE), 'forbidden');
  });

  it('is newest first, across projects (AC4)', () => {
    write(alphaId, 'task.created', 1000);
    write(betaId, 'task.updated', 5000);
    write(alphaId, 'comment.added', 3000);

    const feed = listOrgActivity(t.db, actor(ownerId), PAGE);
    const times = feed.map((row) => row.created_at);

    expect([...times]).toEqual([...times].sort((a, b) => b - a));
    expect(times[0]).toBe(5000);
    expect(times[times.length - 1]).toBe(1);
  });
});

describe('it answers exactly what the stream would (PM’s note)', () => {
  it('matches visibleTo row for row, for every kind of actor', () => {
    write(alphaId, 'task.created', 1000);
    write(betaId, 'task.created', 2000);
    write(null, 'token.created', 3000);
    write(alphaId, 'comment.added', 4000);

    const actors: [string, ResolvedActor][] = [
      ['owner', actor(ownerId)],
      ['admin', actor(makeUser('admin'))],
      ['alpha lead', actor(member('alpha', 'lead'))],
      ['alpha member', actor(member('alpha', 'member'))],
      ['alpha viewer', actor(member('alpha', 'viewer'))],
      ['beta member', actor(member('beta', 'member'))],
      ['no projects', actor(makeUser('member'))],
    ];

    // Snapshot *after* building the actors: `member(...)` calls `addMember`, which
    // writes `member.added` rows of its own. Taking the snapshot first made the
    // comparison compare two different tables and look like a leak.
    const rows = allRows();

    for (const [label, who] of actors) {
      // What the SSE stream would deliver, computed the way `events.ts` does it.
      const streamed = rows
        .filter((row) => visibleTo(who, row))
        .map(eventView)
        .map((row) => row.id)
        .sort();

      const fetched = listOrgActivity(t.db, who, { limit: 200, cursor: null })
        .map((row) => row.id)
        .sort();

      // Two different answers from one table is the bug this endpoint most
      // easily ships. `no projects` legitimately sees nothing, both ways.
      expect(fetched, `${label}: REST and SSE disagree`).toEqual(streamed);
    }
  });

  it('carries the same seq the stream puts in its id: field (AC5)', () => {
    write(alphaId, 'task.created', 1000);

    const fetched = listOrgActivity(t.db, actor(ownerId), PAGE);
    const streamed = allRows().map(eventView);

    expect(fetched[0]?.seq).toBe(streamed[streamed.length - 1]?.seq);
    expect(fetched[0]?.actor_kind).toBe('user');
  });

  it('agrees with the stream on the order of rows sharing a millisecond', () => {
    for (let i = 0; i < 6; i++) write(alphaId, 'task.updated', 9000);

    // The stream delivers in insert order; the feed is that order reversed. A
    // set-level match would hide a disagreement here, which is why this compares
    // sequences and not ids.
    const streamed = allRows()
      .filter((row) => row.createdAt === 9000)
      .map((row) => row.seq);
    const fetched = listOrgActivity(t.db, actor(ownerId), { limit: 200, cursor: null })
      .filter((row) => row.created_at === 9000)
      .map((row) => row.seq);

    expect(fetched).toEqual([...streamed].reverse());
  });
});

describe('filters (AC3)', () => {
  it('?since= is inclusive, like every other time filter', () => {
    write(alphaId, 'task.created', 1000);
    write(alphaId, 'task.updated', 2000);
    write(alphaId, 'comment.added', 3000);

    // Inclusive: 2000 is in, and Alpha's `project.created` at 1 is out.
    expect(
      listProjectActivity(t.db, actor(ownerId), 'alpha', { ...PAGE, since: 2000 }).map(
        (row) => row.created_at,
      ),
    ).toEqual([3000, 2000]);
  });

  it('?task_id= narrows to one task, on both feeds', () => {
    const taskId = createTask(t.sqlite, t.db, actor(ownerId), 'alpha', { title: 'T' }).id;
    write(alphaId, 'comment.added', 5000, taskId);
    write(alphaId, 'task.updated', 6000);

    const scoped = { ...PAGE, taskId };

    expect(
      listProjectActivity(t.db, actor(ownerId), 'alpha', scoped).every(
        (row) => row.task_id === taskId,
      ),
    ).toBe(true);
    expect(
      listOrgActivity(t.db, actor(ownerId), scoped).every((row) => row.task_id === taskId),
    ).toBe(true);
  });

  it('returns payload_json as it was written, whatever the verb', () => {
    write(alphaId, 'task.created', 1000);

    // §4.8's payloads differ per verb; normalising them would break a reader that
    // understands one verb when another gains a field.
    const newest = listProjectActivity(t.db, actor(ownerId), 'alpha', PAGE)[0];

    expect(newest?.type).toBe('task.created');
    expect(newest?.payload).toEqual({ at: 1000 });
  });
});

describe('cursor pagination (AC3)', () => {
  it('walks the whole feed newest-first, with no repeats and no gaps', () => {
    for (let i = 1; i <= 9; i++) write(alphaId, 'task.updated', i * 1000);

    const seen: string[] = [];
    let cursor: { sortKey: number; id: string } | null = null;

    for (let page = 0; page < 10; page++) {
      const rows: ReturnType<typeof listProjectActivity> = listProjectActivity(
        t.db,
        actor(ownerId),
        'alpha',
        { limit: 4, cursor },
      );
      const data = rows.slice(0, 4);
      seen.push(...data.map((row) => row.id));

      if (rows.length <= 4) break;
      const last = data[data.length - 1]!;
      cursor = { sortKey: last.created_at, id: String(last.seq) };
    }

    // 9 writes plus Alpha's `project.created` from setup.
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);

    const times = listProjectActivity(t.db, actor(ownerId), 'alpha', {
      limit: 200,
      cursor: null,
    }).map((row) => row.id);
    expect(seen).toEqual(times);
  });

  /**
   * Five rows in one millisecond is the normal case, not an edge: every mutation
   * writes its activity row inside its own transaction, and first-run setup
   * writes two together. Ordering by `(created_at, id)` made this arbitrary,
   * because a ULID is random within a millisecond — the symptom was a test that
   * passed alone and failed in a full run.
   */
  it('breaks a tie on seq, so rows sharing a timestamp keep insert order', () => {
    for (let i = 0; i < 5; i++) write(alphaId, 'task.updated', 7000);

    const all = listProjectActivity(t.db, actor(ownerId), 'alpha', { limit: 200, cursor: null });
    const tied = all.filter((row) => row.created_at === 7000);

    expect(tied).toHaveLength(5);
    // Newest first, so descending insert order — and deterministic.
    expect(tied.map((row) => row.seq)).toEqual(
      [...tied.map((row) => row.seq)].sort((a, b) => b - a),
    );

    const last = tied[1]!;
    const second = listProjectActivity(t.db, actor(ownerId), 'alpha', {
      limit: 2,
      cursor: { sortKey: last.created_at, id: String(last.seq) },
    });

    expect(second.map((row) => row.id)).not.toContain(last.id);
    expect(second[0]!.seq).toBe(last.seq - 1);
  });

  it('rejects a cursor whose sequence is not a number', () => {
    write(alphaId, 'task.updated', 7000);

    expectApiError(
      () =>
        listProjectActivity(t.db, actor(ownerId), 'alpha', {
          limit: 2,
          cursor: { sortKey: 7000, id: 'not-a-sequence' },
        }),
      'bad_request',
    );
  });
});

describe('the visible project set', () => {
  it('is derived by asking can(), so org roles are not restated in SQL', () => {
    expect(visibleProjectIds(t.db, actor(ownerId)).sort()).toEqual([alphaId, betaId].sort());
    expect(visibleProjectIds(t.db, actor(makeUser('admin'))).sort()).toEqual(
      [alphaId, betaId].sort(),
    );
    expect(visibleProjectIds(t.db, actor(member('alpha', 'member')))).toEqual([alphaId]);
    expect(visibleProjectIds(t.db, actor(makeUser('member')))).toEqual([]);
  });
});
