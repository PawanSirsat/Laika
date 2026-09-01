import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import {
  activityAtSeq,
  appendActivity,
  latestActivitySeq,
  readActivityAfter,
  type ActivityEvent,
} from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import {
  eventView,
  MAX_REPLAY,
  parseLastEventId,
  resumeFrom,
  visibleTo,
} from '../../src/services/events.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let ownerId: string;
let orgId: string;
let laikaId: string;
let otherId: string;

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

/** Append one row and hand back the version the stream would see. */
function write(projectId: string | null, type: 'task.created' | 'token.created'): ActivityEvent {
  const before = readActivityAfter(t.db, 0, 1000).length;
  appendActivity(t.db, {
    orgId,
    projectId,
    actorId: ownerId,
    actorKind: 'user',
    type,
    payload: { note: 'hello' },
  });
  const rows = readActivityAfter(t.db, before, 1000);
  const row = rows[0];
  if (row === undefined) throw new Error('nothing written');
  return row;
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

  laikaId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  }).id;
  otherId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Other',
    slug: 'other',
    prefix: 'OTH',
  }).id;
});
afterEach(() => {
  t.close();
});

describe('project-scoped rows follow project.read (AC2)', () => {
  it('reaches every role that belongs to the project', () => {
    const row = write(laikaId, 'task.created');

    for (const role of ['lead', 'member', 'viewer'] as const) {
      expect(visibleTo(actor(member('laika', role)), row)).toBe(true);
    }
  });

  it('does not reach a member of a different project', () => {
    const outsider = actor(member('other', 'member'));

    expect(visibleTo(outsider, write(laikaId, 'task.created'))).toBe(false);
    expect(visibleTo(outsider, write(otherId, 'task.created'))).toBe(true);
  });

  it('does not reach an org member who belongs to no project', () => {
    expect(visibleTo(actor(makeUser('member')), write(laikaId, 'task.created'))).toBe(false);
  });

  it('reaches org owner and admin without a membership row (implicit lead, §3.3)', () => {
    const row = write(laikaId, 'task.created');

    expect(visibleTo(actor(ownerId), row)).toBe(true);
    expect(visibleTo(actor(makeUser('admin')), row)).toBe(true);
  });

  it('stops the moment the user is deactivated', () => {
    const id = member('laika', 'member');
    const row = write(laikaId, 'task.created');
    expect(visibleTo(actor(id), row)).toBe(true);

    const stale = actor(id);
    expect(visibleTo({ ...stale, isActive: false }, row)).toBe(false);
  });
});

describe('org-scoped rows are the audit trail', () => {
  it('reach Owner and Admin only', () => {
    const row = write(null, 'token.created');

    expect(visibleTo(actor(ownerId), row)).toBe(true);
    expect(visibleTo(actor(makeUser('admin')), row)).toBe(true);
    expect(visibleTo(actor(member('laika', 'lead')), row)).toBe(false);
    expect(visibleTo(actor(member('laika', 'member')), row)).toBe(false);
    expect(visibleTo(actor(member('laika', 'viewer')), row)).toBe(false);
  });
});

describe('the wire shape', () => {
  it('renames §4.8 columns to §6.3 style and parses the payload', () => {
    const view = eventView(write(laikaId, 'task.created'));

    expect(view).toMatchObject({
      type: 'task.created',
      project_id: laikaId,
      task_id: null,
      actor_id: ownerId,
      actor_kind: 'user',
      actor_token_id: null,
      payload: { note: 'hello' },
    });
    expect(view.seq).toBeGreaterThan(0);
    expect(typeof view.created_at).toBe('number');
  });

  it('carries actor_kind so a UI needs no second lookup', () => {
    appendActivity(t.db, {
      orgId,
      projectId: laikaId,
      actorId: null,
      actorKind: 'system',
      type: 'webhook.commit',
    });
    const rows = readActivityAfter(t.db, 0, 10);

    expect(eventView(rows[rows.length - 1]!).actor_kind).toBe('system');
  });
});

describe('where a reconnect resumes (AC3, AC4)', () => {
  /** Creating the two projects already wrote rows, so nothing here starts at 0. */
  let base: number;

  beforeEach(() => {
    base = latestActivitySeq(t.db);
    expect(base).toBeGreaterThan(0);
  });

  function fill(count: number): void {
    for (let i = 0; i < count; i++) write(laikaId, 'task.created');
  }

  it('starts a fresh client at the head, with no replay', () => {
    fill(3);

    expect(resumeFrom(t.db, null)).toEqual({ from: base + 3, gap: null });
  });

  it('replays from Last-Event-ID when the gap is small enough', () => {
    fill(5);

    expect(resumeFrom(t.db, base + 2)).toEqual({ from: base + 2, gap: null });
  });

  it('replays right up to the limit', () => {
    fill(MAX_REPLAY);

    // Exactly MAX_REPLAY missed — still replayable.
    expect(resumeFrom(t.db, base)).toEqual({ from: base, gap: null });
  });

  it('refuses one past the limit, and says where to catch up from instead', () => {
    fill(MAX_REPLAY + 1);
    const at = resumeFrom(t.db, base);

    expect(at.from).toBe(base + MAX_REPLAY + 1);
    expect(at.gap).toMatchObject({
      reason: 'replay_too_large',
      missed: MAX_REPLAY + 1,
      limit: MAX_REPLAY,
    });
    // The client's last confirmed event is the `?updated_since=` watermark.
    expect(at.gap?.updated_since).toBe(activityAtSeq(t.db, base)?.createdAt);
  });

  it('reports an id from ahead of the log rather than pretending to be caught up', () => {
    fill(2);
    const at = resumeFrom(t.db, base + 999);

    expect(at.from).toBe(base + 2);
    expect(at.gap).toEqual({
      reason: 'unknown_last_event_id',
      missed: -1,
      limit: MAX_REPLAY,
      updated_since: null,
    });
  });
});

describe('an empty log', () => {
  it('is position zero', () => {
    const empty = freshDb();
    try {
      expect(resumeFrom(empty.db, null)).toEqual({ from: 0, gap: null });
      expect(resumeFrom(empty.db, 7).gap?.reason).toBe('unknown_last_event_id');
    } finally {
      empty.close();
    }
  });
});

describe('parsing Last-Event-ID', () => {
  it('accepts a sequence', () => {
    expect(parseLastEventId('42')).toBe(42);
    expect(parseLastEventId('0')).toBe(0);
  });

  it('ignores anything that is not one of ours', () => {
    for (const raw of [undefined, null, '', '   ', 'abc', '-1', '1.5', '1e400', '01ARZ3NDEK']) {
      expect(parseLastEventId(raw)).toBeNull();
    }
  });
});
