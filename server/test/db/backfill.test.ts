import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendActivity } from '../../src/db/activity.ts';
import { backfillTaskPositions, backfillTaskTimestamps } from '../../src/db/backfill.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, projects, tasks } from '../../src/db/schema.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * Recovering `started_at` / `completed_at` from the audit trail (LAI-435).
 *
 * **The opposite of the backfill LAI-113 forbade**: `activity` is read and never
 * written, and a derived column on `tasks` is what changes.
 */

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

let nextNumber = 1;

function task(status: string, dates: { startedAt?: number; completedAt?: number } = {}): string {
  const id = newId();
  nextNumber += 1;
  t.db
    .insert(tasks)
    .values({
      id,
      projectId: s.projectId,
      number: nextNumber,
      title: 'A task',
      status: status as 'todo',
      priority: 'p2',
      createdBy: s.userId,
      createdVia: 'web',
      startedAt: dates.startedAt ?? null,
      completedAt: dates.completedAt ?? null,
      createdAt: 1000,
      updatedAt: 1000,
    })
    .run();
  return id;
}

function moved(taskId: string, to: string, at: number, from = 'todo'): void {
  appendActivity(t.db, {
    orgId: s.orgId,
    projectId: s.projectId,
    taskId,
    actorId: s.userId,
    actorKind: 'user',
    type: 'task.status_changed',
    payload: { from, to },
    now: at,
  });
}

function row(id: string) {
  return t.db.select().from(tasks).where(eq(tasks.id, id)).get();
}

describe('what it recovers', () => {
  it('takes started_at from the first arrival at in_progress', () => {
    const id = task('done');
    moved(id, 'in_progress', 5000);
    moved(id, 'review', 6000);
    moved(id, 'in_progress', 7000);
    moved(id, 'done', 8000);

    backfillTaskTimestamps(t.db);

    // First, not last: rework does not restart the clock, which is the rule
    // `changeStatus` already follows for a live task (LAI-126).
    expect(row(id)?.startedAt).toBe(5000);
  });

  it('takes completed_at from the last arrival at done', () => {
    const id = task('done');
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);
    moved(id, 'in_progress', 7000);
    moved(id, 'done', 9000);

    backfillTaskTimestamps(t.db);

    // A task done, reopened and done again finished the second time.
    expect(row(id)?.completedAt).toBe(9000);
  });

  it('reports what it filled', () => {
    const id = task('done');
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);

    expect(backfillTaskTimestamps(t.db)).toEqual({ startedAt: 1, completedAt: 1 });
  });
});

describe('what it refuses to invent', () => {
  it('leaves a task with no status history alone', () => {
    const id = task('done');
    // Some other task has history, so the backfill runs at all.
    const other = task('done');
    moved(other, 'done', 6000);

    backfillTaskTimestamps(t.db);

    // Not `created_at`, not the sprint's start, not the activity row's own
    // timestamp. A task whose history does not say when it started does not get
    // a date — a plausible one is worse than none, because it cannot be told
    // from a real one.
    expect(row(id)?.startedAt).toBeNull();
    expect(row(id)?.completedAt).toBeNull();
  });

  it('never overwrites a stamped value', () => {
    const id = task('done', { startedAt: 100, completedAt: 200 });
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);

    backfillTaskTimestamps(t.db);

    // A stamped value is the real one. `started_at` is first-entry, and moving
    // it would silently shorten every cycle time computed from it.
    expect(row(id)?.startedAt).toBe(100);
    expect(row(id)?.completedAt).toBe(200);
  });

  it('fills only the missing half', () => {
    const id = task('done', { startedAt: 100 });
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);

    backfillTaskTimestamps(t.db);

    expect(row(id)?.startedAt).toBe(100);
    expect(row(id)?.completedAt).toBe(6000);
  });

  it('does not set completed_at on a task that is not done now', () => {
    const id = task('in_progress');
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);
    moved(id, 'in_progress', 7000, 'done');

    backfillTaskTimestamps(t.db);

    // It has a completion in its history and is not complete today. Whether a
    // reopen should *clear* a stamped `completed_at` is LAI-146's question, and
    // this must not answer it by accident — so it fills nothing here, which is
    // silent on the question in both directions.
    expect(row(id)?.completedAt).toBeNull();
    expect(row(id)?.startedAt).toBe(5000);
  });
});

describe('it reads the audit trail and never writes to it', () => {
  it('adds no activity row', () => {
    const id = task('done');
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);
    const before = t.db.select().from(activity).all().length;

    backfillTaskTimestamps(t.db);

    // LAI-113's rule is do not rewrite `activity`. This is the opposite
    // direction: the audit log is the source, not the casualty. It is also
    // append-only, so an attempted write would abort loudly.
    expect(t.db.select().from(activity).all()).toHaveLength(before);
  });

  it('does not move updated_at', () => {
    const id = task('done');
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);

    backfillTaskTimestamps(t.db);

    // This recovers what already happened; it is not a change anybody made.
    // Moving `updated_at` would put every backfilled task at the top of an
    // `updated_since` catch-up (§6.3).
    expect(row(id)?.updatedAt).toBe(1000);
  });

  it('ignores an activity row that names no status', () => {
    const id = task('done');
    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      taskId: id,
      actorId: s.userId,
      actorKind: 'user',
      type: 'task.updated',
      payload: { changed: ['title'] },
      now: 5000,
    });

    backfillTaskTimestamps(t.db);

    expect(row(id)?.startedAt).toBeNull();
  });

  it('reads the type, not the payload — a from/to on another verb is ignored', () => {
    const id = task('done');
    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      taskId: id,
      actorId: s.userId,
      actorKind: 'user',
      // Synthetic: nothing writes a status into `task.updated` today. It is here
      // because the filter's whole job is that the **verb** decides — without
      // this test, removing `where(type = 'task.status_changed')` changes
      // nothing observable and the guard is decoration. A future verb carrying
      // `to: 'done'` would otherwise feed this silently.
      type: 'task.updated',
      payload: { from: 'todo', to: 'in_progress' },
      now: 5000,
    });

    backfillTaskTimestamps(t.db);

    expect(row(id)?.startedAt).toBeNull();
  });
});

describe('idempotence', () => {
  it('changes nothing the second time, asserted by running it twice', () => {
    const id = task('done');
    moved(id, 'in_progress', 5000);
    moved(id, 'done', 6000);

    expect(backfillTaskTimestamps(t.db)).toEqual({ startedAt: 1, completedAt: 1 });
    expect(backfillTaskTimestamps(t.db)).toEqual({ startedAt: 0, completedAt: 0 });
    expect(row(id)?.startedAt).toBe(5000);
  });

  it('is safe on an empty database', () => {
    expect(backfillTaskTimestamps(t.db)).toEqual({ startedAt: 0, completedAt: 0 });
  });
});

describe('backfillTaskPositions (LAI-472, D-070)', () => {
  /** A raw row, as a database from before LAI-472 holds it: no position. */
  function raw(number: number, priority: 'p1' | 'p2' | 'p3', projectId = s.projectId): string {
    const id = newId();
    t.db
      .insert(tasks)
      .values({
        id,
        projectId,
        number,
        title: `Task ${String(number)}`,
        status: 'todo',
        priority,
        createdBy: s.userId,
        createdVia: 'web',
        createdAt: 1000,
        updatedAt: 1000,
      })
      .run();
    return id;
  }

  const byPosition = () =>
    t.db
      .select({ number: tasks.number, position: tasks.position })
      .from(tasks)
      .all()
      .sort((a, b) => ((a.position ?? '') < (b.position ?? '') ? -1 : 1))
      .map((r) => r.number);

  it('fills every null in the order the board already shows — priority, then number', () => {
    // The board has sorted each lane by priority then number since LAI-606.
    // Positions in that order mean no lane reshuffles on the upgrade.
    raw(1, 'p3');
    raw(2, 'p1');
    raw(3, 'p2');
    raw(4, 'p1');
    raw(5, 'p3');

    expect(backfillTaskPositions(t.db)).toBe(5);
    expect(byPosition()).toEqual([2, 4, 3, 1, 5]);
    expect(
      t.db
        .select()
        .from(tasks)
        .all()
        .every((r) => r.position !== null),
    ).toBe(true);
  });

  it('is idempotent and touches nothing it has already placed', () => {
    raw(1, 'p2');
    raw(2, 'p2');
    backfillTaskPositions(t.db);
    const before = t.db.select().from(tasks).all();

    expect(backfillTaskPositions(t.db)).toBe(0);
    expect(t.db.select().from(tasks).all()).toEqual(before);
  });

  it('leaves updated_at alone — placing a card is not an edit anybody made', () => {
    raw(1, 'p2');
    backfillTaskPositions(t.db);
    expect(t.db.select().from(tasks).get()!.updatedAt).toBe(1000);
  });

  it('places late arrivals after the project’s existing order, never among it', () => {
    raw(1, 'p3');
    raw(2, 'p3');
    backfillTaskPositions(t.db);
    const placed = new Map(
      t.db
        .select()
        .from(tasks)
        .all()
        .map((r) => [r.number, r.position]),
    );

    // A p1 that arrives later still goes to the end: it was not in the order
    // anybody arranged, and putting it at the top would move every card below.
    raw(3, 'p1');
    expect(backfillTaskPositions(t.db)).toBe(1);
    expect(byPosition()).toEqual([1, 2, 3]);
    for (const row of t.db.select().from(tasks).all()) {
      if (row.number !== 3) expect(row.position).toBe(placed.get(row.number));
    }
  });

  it('can be confined to one project', () => {
    const otherProject = newId();
    t.db
      .insert(projects)
      .values({
        id: otherProject,
        orgId: s.orgId,
        name: 'Other',
        slug: 'other',
        prefix: 'OTH',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    raw(1, 'p2');
    const elsewhere = raw(1, 'p2', otherProject);

    expect(backfillTaskPositions(t.db, s.projectId)).toBe(1);
    expect(t.db.select().from(tasks).where(eq(tasks.id, elsewhere)).get()!.position).toBeNull();
  });
});
