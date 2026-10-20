import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  timeDrafts,
  timeEntries,
  timeEntryRevisions,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneTime } from '../../src/jobs/jobs.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  createEntry,
  deleteEntry,
  entriesOn,
  listRevisions,
  updateEntry,
} from '../../src/services/time-entries.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import { expectSqliteError, freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Confirmed time (D-088 items 2, 6, 11 and 12, LAI-787): the person's own
 * entries, every change an append-only revision, kept three years, and never
 * an `activity` row.
 */

const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;

let t: TestDb;
let owner: ResolvedActor;
let bea: ResolvedActor;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

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

beforeEach(() => {
  t = freshDb();
  owner = load(seed(t.db, NOW).userId);
  const beaId = newId();
  t.db
    .insert(users)
    .values({
      id: beaId,
      email: 'bea@example.test',
      name: 'Bea',
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  bea = load(beaId);
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Time', now: NOW }); // LAI-1
  setOrgTimeMode(t.db, owner, 'manual', NOW);
});

afterEach(() => {
  t.close();
});

describe('a manual entry', () => {
  it('goes on a card, a project or General, with its zone and day', () => {
    const onCard = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'Africa/Johannesburg', minutes: 45, task: 'LAI-1', note: 'Pairing' },
      NOW,
    );
    expect(onCard).toMatchObject({
      day: DAY,
      tz: 'Africa/Johannesburg',
      minutes: 45,
      source: 'manual',
      task: { key: 'LAI-1', title: 'Time' },
      project: { slug: 'laika' },
      note: 'Pairing',
      revision: 1,
    });
    const onProject = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 30, project: 'laika' },
      NOW,
    );
    expect([onProject.task, onProject.project?.slug]).toEqual([null, 'laika']);
    const general = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 15, note: 'Client call' },
      NOW,
    );
    expect([general.task, general.project]).toEqual([null, null]);
  });

  it('is refused while the organisation keeps no time, and to any token', () => {
    setOrgTimeMode(t.db, owner, 'off', NOW);
    expect(reason(() => createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 5 }, NOW))).toBe(
      'forbidden:time_off',
    );
    setOrgTimeMode(t.db, owner, 'manual', NOW);
    expect(
      reason(() =>
        createEntry(t.db, { ...owner, token: TOKEN }, { day: DAY, tz: 'UTC', minutes: 5 }, NOW),
      ),
    ).toBe('forbidden:session_required');
  });

  it('is refused for a card the person cannot read', () => {
    expect(
      reason(() => createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 5, task: 'LAI-1' }, NOW)),
    ).toBe('not_found:');
  });

  it('keeps a day to a day', () => {
    createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 1400 }, NOW);
    expect(reason(() => createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 41 }, NOW))).toBe(
      'unprocessable:day_full',
    );
    expect(reason(() => createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 40 }, NOW))).toBe(
      'no error',
    );
  });

  it('refuses a day outside the window and a zone nobody knows', () => {
    expect(
      reason(() => createEntry(t.db, bea, { day: '2026-10-23', tz: 'UTC', minutes: 5 }, NOW)),
    ).toBe('unprocessable:day_out_of_range');
    expect(
      reason(() => createEntry(t.db, bea, { day: DAY, tz: 'Mars/Olympus', minutes: 5 }, NOW)),
    ).toBe('unprocessable:invalid_tz');
  });

  it('writes no activity row', () => {
    const entry = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 5, task: 'LAI-1' }, NOW);
    updateEntry(t.db, owner, entry.id, { minutes: 10 }, NOW);
    deleteEntry(t.db, owner, entry.id, NOW);
    const verbs = t.db
      .select({ type: activity.type })
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(verbs).toEqual(['task.created']);
  });
});

describe('history', () => {
  it('a change is the next revision, the entry as it then stood; no change writes none', () => {
    const entry = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 30, task: 'LAI-1' },
      NOW,
    );
    updateEntry(t.db, owner, entry.id, { minutes: 30 }, NOW + 1);
    const edited = updateEntry(t.db, owner, entry.id, { minutes: 50, task: null }, NOW + 2);
    expect([edited.revision, edited.minutes, edited.task, edited.project]).toEqual([
      2,
      50,
      null,
      null,
    ]);
    deleteEntry(t.db, owner, entry.id, NOW + 3);
    expect(
      listRevisions(t.db, owner, entry.id).map((r) => [
        r.revision,
        r.change,
        r.minutes,
        r.task_id === null,
      ]),
    ).toEqual([
      [1, 'created', 30, false],
      [2, 'edited', 50, true],
      [3, 'deleted', 50, true],
    ]);
    expect(entriesOn(t.db, owner.userId, DAY)).toEqual([]);
    expect(t.db.select().from(timeEntries).all()).toHaveLength(1);
  });

  it('is the person’s alone', () => {
    const entry = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    expect(reason(() => listRevisions(t.db, bea, entry.id))).toBe('not_found:');
    expect(reason(() => updateEntry(t.db, bea, entry.id, { minutes: 1 }, NOW))).toBe('not_found:');
    expect(reason(() => deleteEntry(t.db, bea, entry.id, NOW))).toBe('not_found:');
    expect(reason(() => listRevisions(t.db, { ...owner, token: TOKEN }, entry.id))).toBe(
      'forbidden:session_required',
    );
  });

  it('cannot be rewritten, replaced or removed while its entry exists', () => {
    const entry = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    const [rev] = t.db.select().from(timeEntryRevisions).all();
    expectSqliteError(
      () => t.db.update(timeEntryRevisions).set({ minutes: 1 }).run(),
      /append-only: UPDATE/,
    );
    expectSqliteError(
      () => t.db.delete(timeEntryRevisions).where(eq(timeEntryRevisions.entryId, entry.id)).run(),
      /append-only: DELETE/,
    );
    expectSqliteError(
      () =>
        t.db.run(
          sql`INSERT OR REPLACE INTO time_entry_revisions (id, entry_id, revision, change, changed_by, day, tz, minutes, created_at) VALUES (${rev?.id ?? ''}, ${entry.id}, 1, 'created', ${owner.userId}, ${DAY}, 'UTC', 1, ${NOW})`,
        ),
      /append-only: INSERT OR REPLACE/,
    );
  });
});

/**
 * Review round 1, B2. A delete trigger cannot see `INSERT OR REPLACE`: with
 * `recursive_triggers` off, the row a replace removes fires no delete
 * trigger, and the cascade then takes every revision. A replace over an entry
 * — by its id, or by its `(user_id, source, source_ref)` — is refused.
 */
describe('an entry cannot be replaced', () => {
  it('refuses a replace by id or by source, and keeps both entries and their history', () => {
    const typed = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    updateEntry(t.db, owner, typed.id, { minutes: 40 }, NOW);
    const imported = newId();
    t.db
      .insert(timeEntries)
      .values({
        id: imported,
        userId: owner.userId,
        day: DAY,
        tz: 'UTC',
        minutes: 20,
        source: 'import',
        sourceRef: 'solidtime-1',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    t.db
      .insert(timeEntryRevisions)
      .values({
        id: newId(),
        entryId: imported,
        revision: 1,
        change: 'created',
        changedBy: owner.userId,
        day: DAY,
        tz: 'UTC',
        minutes: 20,
        createdAt: NOW,
      })
      .run();

    expectSqliteError(
      () =>
        t.db.run(
          sql`INSERT OR REPLACE INTO time_entries (id, user_id, day, tz, minutes, source, created_at, updated_at) VALUES (${typed.id}, ${owner.userId}, ${DAY}, 'UTC', 5, 'manual', ${NOW}, ${NOW})`,
        ),
      /INSERT OR REPLACE is not permitted/,
    );
    expectSqliteError(
      () =>
        t.db.run(
          sql`INSERT OR REPLACE INTO time_entries (id, user_id, day, tz, minutes, source, source_ref, created_at, updated_at) VALUES (${newId()}, ${owner.userId}, ${DAY}, 'UTC', 5, 'import', 'solidtime-1', ${NOW}, ${NOW})`,
        ),
      /INSERT OR REPLACE is not permitted/,
    );

    expect(
      t.db
        .select({ id: timeEntries.id, minutes: timeEntries.minutes })
        .from(timeEntries)
        .all()
        .sort((a, b) => a.minutes - b.minutes),
    ).toEqual([
      { id: imported, minutes: 20 },
      { id: typed.id, minutes: 40 },
    ]);
    expect(listRevisions(t.db, owner, typed.id).map((r) => r.change)).toEqual([
      'created',
      'edited',
    ]);
    expect(
      t.db.select().from(timeEntryRevisions).where(eq(timeEntryRevisions.entryId, imported)).all(),
    ).toHaveLength(1);
  });
});

describe('retention', () => {
  // Real dates: the trigger compares with SQLite's own clock.
  const now = Date.now();
  const isoDay = (msAgo: number) => new Date(now - msAgo).toISOString().slice(0, 10);
  const YEAR = 365.25 * 86_400_000;

  function entryOn(day: string): string {
    const id = newId();
    t.db
      .insert(timeEntries)
      .values({
        id,
        userId: owner.userId,
        day,
        tz: 'UTC',
        minutes: 10,
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    t.db
      .insert(timeEntryRevisions)
      .values({
        id: newId(),
        entryId: id,
        revision: 1,
        change: 'created',
        changedBy: owner.userId,
        day,
        tz: 'UTC',
        minutes: 10,
        createdAt: now,
      })
      .run();
    return id;
  }

  function draftOn(day: string): void {
    t.db
      .insert(timeDrafts)
      .values({
        id: newId(),
        userId: owner.userId,
        source: 'agent',
        day,
        tz: 'UTC',
        minutes: 5,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  it('keeps an entry three years: nothing deletes a younger one', () => {
    const id = entryOn(isoDay(2.9 * YEAR));
    expectSqliteError(
      () => t.db.delete(timeEntries).where(eq(timeEntries.id, id)).run(),
      /kept three years/,
    );
  });

  it('deletes entries past three years with their history, and drafts past 30 days', () => {
    const old = entryOn(isoDay(3.1 * YEAR));
    const young = entryOn(isoDay(2.9 * YEAR));
    draftOn(isoDay(31 * 86_400_000));
    draftOn(isoDay(29 * 86_400_000));
    expect(pruneTime(t.db, now).changed).toBe(2);
    expect(
      t.db
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .all()
        .map((r) => r.id),
    ).toEqual([young]);
    expect(
      t.db.select().from(timeEntryRevisions).where(eq(timeEntryRevisions.entryId, old)).all(),
    ).toEqual([]);
    expect(t.db.select().from(timeDrafts).all()).toHaveLength(1);
    expect(pruneTime(t.db, now).changed).toBe(0);
  });
});
