import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, tasks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { projectMetrics } from '../../src/services/metrics.ts';
import { createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Throughput and cycle time (LAI-124).
 *
 * Both read `tasks.started_at` and `completed_at` rather than replaying
 * `task.status_changed` — LAI-126 made the first a column with the rule the
 * reconstruction would have needed (**first entry, never overwritten**), and
 * LAI-146 made the second the **latest** completion.
 */

const DAY = 24 * 60 * 60 * 1000;
/** A round UTC midnight, so day bucketing is legible in the assertions. */
const T0 = Date.UTC(2026, 7, 1);

let t: TestDb;
let adminId: string;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function makeUser(orgRole: 'admin' | 'member'): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole,
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    })
    .run();
  return id;
}

/** A task with the exact history the metrics read. */
function task(opts: {
  status?: 'done' | 'cancelled' | 'in_progress';
  startedAt?: number | null;
  completedAt?: number | null;
}): string {
  const created = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'A task' });
  t.db
    .update(tasks)
    .set({
      status: opts.status ?? 'done',
      startedAt: opts.startedAt === undefined ? T0 : opts.startedAt,
      completedAt: opts.completedAt === undefined ? T0 + DAY : opts.completedAt,
    })
    .where(eq(tasks.id, created.id))
    .run();
  return created.id;
}

beforeEach(() => {
  t = freshDb();
  adminId = makeUser('admin');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: T0, updatedAt: T0 })
    .run();
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

function metrics(since = T0 - DAY, now = T0 + 3 * DAY) {
  return projectMetrics(t.db, actor(adminId), 'laika', since, now);
}

describe('cycle time', () => {
  it('is completed_at minus started_at', () => {
    task({ startedAt: T0, completedAt: T0 + 2 * DAY });

    const { cycle_time } = metrics();

    expect(cycle_time?.measured).toBe(1);
    expect(cycle_time?.p50_ms).toBe(2 * DAY);
  });

  it('counts a reopened-and-finished task once, at its latest completion', () => {
    // §5 allows `done → in_progress`, so reopening is legal and a query over
    // `activity` would count two completions. The row holds one `completed_at`.
    task({ startedAt: T0, completedAt: T0 + 3 * DAY });

    const { throughput, cycle_time } = metrics();

    expect(throughput.reduce((n, b) => n + b.completed, 0)).toBe(1);
    expect(cycle_time?.p50_ms).toBe(3 * DAY);
  });

  it('ignores a task that is reopened right now, even though it has a completed_at', () => {
    // **The one place LAI-146's asymmetry can bite.** `completed_at` survives a
    // reopen deliberately, so this task carries a timestamp for a cycle it is in
    // the middle of. Counting it would report a finished cycle for unfinished
    // work — which is why the filter is `status = 'done'` and not
    // `completed_at IS NOT NULL`.
    task({ status: 'in_progress', startedAt: T0, completedAt: T0 + DAY });

    expect(metrics().cycle_time).toBeNull();
  });

  it('excludes cancelled work', () => {
    // A task cancelled after two weeks in progress is not a two-week cycle time;
    // it is not a cycle. LAI-083 and LAI-085 already make that call.
    task({ status: 'cancelled', startedAt: T0, completedAt: T0 + 14 * DAY });

    expect(metrics().cycle_time).toBeNull();
  });

  it('counts a task with no start, and does not measure it', () => {
    task({ startedAt: null, completedAt: T0 + DAY });

    const { throughput, cycle_time } = metrics();

    // Real throughput — somebody finished something — and no cycle to report.
    // Reported rather than dropped, because a board where most work never passes
    // through `in_progress` is a fact about the board, not a gap in the data.
    expect(throughput.reduce((n, b) => n + b.completed, 0)).toBe(1);
    expect(cycle_time?.measured).toBe(0);
    expect(cycle_time?.unmeasured).toBe(1);
  });

  it('reports percentiles by nearest rank, on values that happened', () => {
    for (const days of [1, 2, 3, 4, 10]) {
      task({ startedAt: T0, completedAt: T0 + days * DAY });
    }

    const { cycle_time } = metrics(T0 - DAY, T0 + 20 * DAY);

    // Nearest rank, not interpolation: a p90 no task actually took invites
    // somebody to go looking for it.
    expect(cycle_time?.p50_ms).toBe(3 * DAY);
    expect(cycle_time?.p90_ms).toBe(10 * DAY);
  });
});

describe('throughput', () => {
  it('buckets completions by UTC day', () => {
    task({ completedAt: T0 });
    task({ completedAt: T0 + 60_000 });
    task({ completedAt: T0 + DAY });

    const { throughput } = metrics();

    expect(throughput.find((b) => b.day === '2026-08-01')?.completed).toBe(2);
    expect(throughput.find((b) => b.day === '2026-08-02')?.completed).toBe(1);
  });

  it('includes empty days as zero, so a chart need not fill gaps', () => {
    task({ completedAt: T0 });

    const { throughput } = metrics();

    expect(throughput.find((b) => b.day === '2026-08-03')).toEqual({
      day: '2026-08-03',
      completed: 0,
    });
  });

  it('excludes completions before the window', () => {
    task({ completedAt: T0 - 10 * DAY });
    task({ completedAt: T0 + DAY });

    expect(metrics().throughput.reduce((n, b) => n + b.completed, 0)).toBe(1);
  });

  it('answers null for cycle time when nothing completed, not a zeroed shape', () => {
    // `null` says "no data"; zeros say "measured, and it was nothing". A chart
    // renders those differently and should.
    expect(metrics().cycle_time).toBeNull();
    expect(metrics().throughput.every((b) => b.completed === 0)).toBe(true);
  });
});

describe('permissions', () => {
  it('refuses a reader who cannot see the project', () => {
    const outsider = makeUser('member');

    expect(() => projectMetrics(t.db, actor(outsider), 'laika', T0)).toThrow(ApiError);
  });

  it('404s an unknown project', () => {
    expect(() => projectMetrics(t.db, actor(adminId), 'nope', T0)).toThrow(ApiError);
  });
});
