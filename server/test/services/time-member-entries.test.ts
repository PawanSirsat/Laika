import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  memberNotices,
  orgTimeSettings,
  timeEntries,
  timeEntryRevisions,
  users,
} from '../../src/db/schema.ts';
import { requireOrgId } from '../../src/db/orgs.ts';
import { ApiError } from '../../src/errors.ts';
import { createTask } from '../../src/services/tasks.ts';
import { createEntry, listRevisions } from '../../src/services/time-entries.ts';
import {
  createMemberEntry,
  deleteMemberEntry,
  listMemberRevisions,
  updateMemberEntry,
} from '../../src/services/time-member-entries.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * A member's confirmed time, changed by an owner or admin (D-143, LAI-1165):
 * who may, on whom; imports and the closed period read-only; every change a
 * revision by the editor; and the person told.
 */

const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;

let t: TestDb;
let owner: ResolvedActor;
let al: ResolvedActor;
let bea: ResolvedActor;
let cy: ResolvedActor;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function person(name: string, orgRole: 'admin' | 'member'): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return load(id);
}

/** The refusal's code and reason, so only the real path satisfies it. */
function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return `${err.code}:${String((err.details as { reason?: string } | null)?.reason ?? '')}`;
    }
    throw err;
  }
  return 'no error';
}

function revisions(entryId: string) {
  return t.db
    .select()
    .from(timeEntryRevisions)
    .where(eq(timeEntryRevisions.entryId, entryId))
    .all()
    .sort((a, b) => a.revision - b.revision);
}

function notices(userId: string) {
  return t.db
    .select()
    .from(memberNotices)
    .where(eq(memberNotices.userId, userId))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
}

const SPAN = { started_at: NOW - 4 * 3_600_000, ended_at: NOW - 3.5 * 3_600_000 };

beforeEach(() => {
  t = freshDb();
  owner = load(seed(t.db, NOW).userId);
  al = person('Al', 'admin');
  bea = person('Bea', 'member');
  cy = person('Cy', 'member');
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Time', now: NOW }); // LAI-1
  setOrgTimeMode(t.db, owner, 'manual', NOW);
});

afterEach(() => {
  t.close();
});

describe('an owner changes a member’s confirmed time', () => {
  it('adds an entry on their day, by the owner, and tells them', () => {
    const made = createMemberEntry(
      t.db,
      owner,
      bea.userId,
      { day: DAY, tz: 'UTC', minutes: 30, task: 'LAI-1', ...SPAN },
      NOW,
    );
    const row = t.db.select().from(timeEntries).where(eq(timeEntries.id, made.id)).get();
    expect(row?.userId).toBe(bea.userId);
    expect(row?.source).toBe('manual');
    expect(revisions(made.id).map((r) => [r.change, r.changedBy])).toEqual([
      ['created', owner.userId],
    ]);
    const told = notices(bea.userId);
    expect(told.map((n) => [n.kind, n.actorUserId, n.subject])).toEqual([
      ['time_changed', owner.userId, `created ${DAY} +30`],
    ]);
    expect(told[0]?.taskId).toBe(made.task?.id);
  });

  it('lengthens one, the revision the owner’s and the notice saying by how much', () => {
    const own = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 30, ...SPAN }, NOW);
    const changed = updateMemberEntry(
      t.db,
      owner,
      bea.userId,
      own.id,
      { minutes: 45, ended_at: SPAN.started_at + 45 * 60_000 },
      NOW + 1,
    );
    expect(changed.minutes).toBe(45);
    expect(revisions(own.id).map((r) => [r.change, r.changedBy, r.minutes])).toEqual([
      ['created', bea.userId, 30],
      ['edited', owner.userId, 45],
    ]);
    expect(notices(bea.userId).map((n) => n.subject)).toEqual([`edited ${DAY} +15`]);

    // A patch that changes nothing writes no revision and tells nobody.
    updateMemberEntry(t.db, owner, bea.userId, own.id, { minutes: 45 }, NOW + 2);
    expect(revisions(own.id)).toHaveLength(2);
    expect(notices(bea.userId)).toHaveLength(1);
  });

  it('deletes one, kept with a deleted revision by the owner', () => {
    const own = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 60 }, NOW);
    deleteMemberEntry(t.db, owner, bea.userId, own.id, NOW + 1);
    const row = t.db.select().from(timeEntries).where(eq(timeEntries.id, own.id)).get();
    expect(row?.deletedAt).toBe(NOW + 1);
    expect(revisions(own.id).at(-1)).toMatchObject({ change: 'deleted', changedBy: owner.userId });
    expect(notices(bea.userId).map((n) => n.subject)).toEqual([`deleted ${DAY} -60`]);
  });

  it('names the editor in the history, for the editor and for the person', () => {
    const own = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    updateMemberEntry(t.db, owner, bea.userId, own.id, { minutes: 40 }, NOW + 1);
    const asEditor = listMemberRevisions(t.db, owner, bea.userId, own.id);
    expect(asEditor.map((r) => [r.changed_by, r.changed_by_name])).toEqual([
      [bea.userId, 'Bea'],
      [owner.userId, 'Owner'],
    ]);
    expect(listRevisions(t.db, bea, own.id).map((r) => r.changed_by_name)).toEqual([
      'Bea',
      'Owner',
    ]);
  });
});

describe('what stays read-only', () => {
  function imported(userId: string): string {
    const id = newId();
    t.db
      .insert(timeEntries)
      .values({
        id,
        userId,
        day: DAY,
        tz: 'UTC',
        minutes: 20,
        source: 'import',
        sourceRef: 'solidtime-1',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    return id;
  }

  it('an import is changed in Solidtime, not here', () => {
    const id = imported(bea.userId);
    expect(reason(() => updateMemberEntry(t.db, owner, bea.userId, id, { minutes: 5 }))).toBe(
      'forbidden:imported_entry',
    );
    expect(reason(() => deleteMemberEntry(t.db, owner, bea.userId, id))).toBe(
      'forbidden:imported_entry',
    );
    expect(notices(bea.userId)).toEqual([]);
  });

  it('another person’s entry under this member’s id is not there', () => {
    const cys = createEntry(t.db, cy, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    expect(reason(() => updateMemberEntry(t.db, owner, bea.userId, cys.id, { minutes: 5 }))).toBe(
      'not_found:',
    );
    expect(reason(() => deleteMemberEntry(t.db, owner, bea.userId, cys.id))).toBe('not_found:');
    expect(reason(() => listMemberRevisions(t.db, owner, bea.userId, cys.id))).toBe('not_found:');
  });

  it('a day in the closed period is not changed', () => {
    const own = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    t.db
      .update(orgTimeSettings)
      .set({ closedThrough: DAY })
      .where(eq(orgTimeSettings.orgId, requireOrgId(t.db)))
      .run();
    expect(
      reason(() =>
        createMemberEntry(t.db, owner, bea.userId, { day: DAY, tz: 'UTC', minutes: 5 }, NOW),
      ),
    ).toBe('forbidden:closed_period');
    expect(reason(() => updateMemberEntry(t.db, owner, bea.userId, own.id, { minutes: 5 }))).toBe(
      'forbidden:closed_period',
    );
    expect(reason(() => deleteMemberEntry(t.db, owner, bea.userId, own.id))).toBe(
      'forbidden:closed_period',
    );
  });
});

describe('who may', () => {
  it('an admin changes a member’s time, never the owner’s', () => {
    const beas = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    updateMemberEntry(t.db, al, bea.userId, beas.id, { minutes: 20 }, NOW + 1);
    expect(revisions(beas.id).at(-1)?.changedBy).toBe(al.userId);

    const owners = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    expect(reason(() => updateMemberEntry(t.db, al, owner.userId, owners.id, { minutes: 5 }))).toBe(
      'forbidden:not_for_owner',
    );
    expect(
      reason(() =>
        createMemberEntry(t.db, al, owner.userId, { day: DAY, tz: 'UTC', minutes: 5 }, NOW),
      ),
    ).toBe('forbidden:not_for_owner');
    expect(reason(() => deleteMemberEntry(t.db, al, owner.userId, owners.id))).toBe(
      'forbidden:not_for_owner',
    );
  });

  it('a member may not, and nobody uses this path on themselves', () => {
    const beas = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    expect(reason(() => updateMemberEntry(t.db, cy, bea.userId, beas.id, { minutes: 5 }))).toBe(
      'forbidden:',
    );
    expect(reason(() => updateMemberEntry(t.db, bea, bea.userId, beas.id, { minutes: 5 }))).toBe(
      'unprocessable:use_own_time',
    );
    expect(
      reason(() =>
        createMemberEntry(t.db, owner, owner.userId, { day: DAY, tz: 'UTC', minutes: 5 }, NOW),
      ),
    ).toBe('unprocessable:use_own_time');
  });

  it('a token is refused, the owner’s full one included', () => {
    const beas = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    expect(
      reason(() =>
        updateMemberEntry(t.db, { ...owner, token: TOKEN }, bea.userId, beas.id, { minutes: 5 }),
      ),
    ).toBe('forbidden:session_required');
  });
});
