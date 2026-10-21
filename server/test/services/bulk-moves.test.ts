import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../src/db/activity.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { listProjectActivity } from '../../src/services/activity.ts';
import {
  BULK_MOVE_TASKS,
  BULK_MOVE_WINDOW_MS,
  bulkIds,
  type BulkCandidate,
} from '../../src/services/bulk-moves.ts';
import { projectMetrics } from '../../src/services/metrics.ts';
import { getPeopleActivity } from '../../src/services/people-activity.ts';
import { createProject } from '../../src/services/projects.ts';
import { getSprintForecast } from '../../src/services/sprint-forecast.ts';
import { addTasksToSprint, createSprint } from '../../src/services/sprints.ts';
import { changeStatus, claimTask, createTask, finishTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Bulk moves (D-093, LAI-823): more than {@link BULK_MOVE_TASKS} distinct
 * tasks moved, or created, by one actor within a minute are a sweep, kept in
 * the feed and marked, and left out of throughput, cycle time, the sprint
 * forecast and the heatmap.
 */

vi.setConfig({ testTimeout: 60_000 });

const SECOND = 1000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 15, 12);

describe('bulkIds — the rule', () => {
  function rows(
    n: number,
    opts: { gap?: number; actor?: string | null; type?: string; tasks?: number } = {},
  ): BulkCandidate[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `${opts.actor ?? 'a'}-${opts.type ?? 's'}-${String(i)}`,
      actorId: opts.actor === undefined ? 'a' : opts.actor,
      taskId: `task-${String(i % (opts.tasks ?? n))}`,
      type: opts.type ?? 'task.status_changed',
      createdAt: NOW + i * (opts.gap ?? SECOND),
    }));
  }

  it('calls more than ten distinct tasks by one actor in a minute a sweep, every row of it', () => {
    expect(BULK_MOVE_TASKS).toBe(10);
    expect(BULK_MOVE_WINDOW_MS).toBe(60_000);
    expect(bulkIds(rows(11)).size).toBe(11);
  });

  it('leaves ten alone', () => {
    expect(bulkIds(rows(10)).size).toBe(0);
  });

  it('counts tasks, not rows: a claim and a finish of one task are one', () => {
    expect(bulkIds(rows(20, { tasks: 10 })).size).toBe(0);
  });

  it('holds the window to under a minute', () => {
    // Eleven moves 5.9 s apart span 59 s: one minute holds them all.
    expect(bulkIds(rows(11, { gap: 5_900 })).size).toBe(11);
    // Six seconds apart they span exactly 60 s, and no minute holds eleven.
    expect(bulkIds(rows(11, { gap: 6_000 })).size).toBe(0);
  });

  it('marks only the rows inside a sweep, not the quiet work either side of it', () => {
    const quiet = rows(3, { gap: 10 * 60 * SECOND, actor: 'a', type: 'task.status_changed' }).map(
      (r, i) => ({
        ...r,
        id: `quiet-${String(i)}`,
        taskId: `q-${String(i)}`,
        createdAt: NOW - (i + 1) * HOUR,
      }),
    );
    const bulk = bulkIds([...quiet, ...rows(12)]);
    expect(bulk.size).toBe(12);
    expect([...bulk].some((id) => id.startsWith('quiet'))).toBe(false);
  });

  it('keeps actors and kinds apart, and gives a system row to nobody', () => {
    expect(bulkIds([...rows(6, { actor: 'a' }), ...rows(6, { actor: 'b' })]).size).toBe(0);
    expect(
      bulkIds([
        ...rows(6),
        ...rows(6, { type: 'task.created' }).map((r, i) => ({ ...r, taskId: `t2-${String(i)}` })),
      ]).size,
    ).toBe(0);
    expect(bulkIds(rows(11, { actor: null })).size).toBe(0);
    expect(bulkIds(rows(11, { type: 'task.updated' })).size).toBe(0);
  });
});

let t: TestDb;
let adminId: string;
let orgId: string;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}
const admin = () => actor(adminId);

beforeEach(() => {
  t = freshDb();
  adminId = newId();
  orgId = newId();
  t.db
    .insert(users)
    .values({
      id: adminId,
      email: 'ada@example.test',
      name: 'Ada',
      orgRole: 'admin',
      createdAt: new Date(NOW - 400 * DAY),
      updatedAt: new Date(NOW - 400 * DAY),
    })
    .run();
  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: adminId, createdAt: NOW, updatedAt: NOW })
    .run();
  createProject(t.sqlite, t.db, admin(), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

/** Created, claimed, finished into review and accepted into done, one by one. */
function doneTask(at: number, opts: { built?: number; waited?: number } = {}): string {
  const built = opts.built ?? HOUR;
  const waited = opts.waited ?? HOUR;
  const task = createTask(t.sqlite, t.db, admin(), 'laika', {
    title: 'Done work',
    now: at - built - waited - HOUR,
  });
  claimTask(t.sqlite, t.db, admin(), task.id, at - built - waited);
  finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: at - waited });
  changeStatus(t.db, admin(), task.id, 'done', at);
  return task.id;
}

/** `n` tasks in review, each made hours apart, then all moved to done within `n` seconds. */
function sweptToDone(n: number, at: number): string[] {
  const ids = Array.from({ length: n }, (_, i) => {
    const task = createTask(t.sqlite, t.db, admin(), 'laika', {
      title: 'Swept',
      now: at - 2 * DAY - i * HOUR,
    });
    claimTask(t.sqlite, t.db, admin(), task.id, at - DAY - i * HOUR);
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: at - DAY - i * HOUR + 1 });
    return task.id;
  });
  ids.forEach((id, i) => changeStatus(t.db, admin(), id, 'done', at + i * SECOND));
  return ids;
}

/** `n` tasks created straight into done within `n` seconds — an import. */
function importedDone(n: number, at: number): string[] {
  return Array.from(
    { length: n },
    (_, i) =>
      createTask(t.sqlite, t.db, admin(), 'laika', {
        title: 'Imported',
        status: 'done',
        now: at + i * SECOND,
      }).id,
  );
}

const totalThroughput = (m: ReturnType<typeof projectMetrics>) =>
  m.throughput.reduce((n, b) => n + b.completed, 0);

describe('throughput and cycle time leave bulk moves out', () => {
  it('drops a sweep into done, and says how many it dropped', () => {
    doneTask(NOW - 3 * DAY);
    doneTask(NOW - 2 * DAY);
    sweptToDone(BULK_MOVE_TASKS + 1, NOW - DAY);

    const m = projectMetrics(t.db, admin(), 'laika', NOW - 10 * DAY, NOW);
    expect(totalThroughput(m)).toBe(2);
    expect(m.bulk_excluded).toBe(BULK_MOVE_TASKS + 1);
    expect(m.cycle_time?.measured).toBe(2);
  });

  it('counts the same tasks moved one at a time', () => {
    // Ten in a minute is not a sweep: the control for the test above.
    sweptToDone(BULK_MOVE_TASKS, NOW - DAY);
    const m = projectMetrics(t.db, admin(), 'laika', NOW - 10 * DAY, NOW);
    expect(totalThroughput(m)).toBe(BULK_MOVE_TASKS);
    expect(m.bulk_excluded).toBe(0);
  });

  it('drops tasks created straight into done in bulk, which never moved', () => {
    doneTask(NOW - 2 * DAY);
    importedDone(BULK_MOVE_TASKS + 1, NOW - DAY);

    const m = projectMetrics(t.db, admin(), 'laika', NOW - 10 * DAY, NOW);
    expect(totalThroughput(m)).toBe(1);
    expect(m.bulk_excluded).toBe(BULK_MOVE_TASKS + 1);
    expect(m.cycle_time?.unmeasured).toBe(0);
  });

  it('keeps a task created into done on its own', () => {
    importedDone(1, NOW - DAY);
    const m = projectMetrics(t.db, admin(), 'laika', NOW - 10 * DAY, NOW);
    expect(totalThroughput(m)).toBe(1);
    expect(m.cycle_time?.unmeasured).toBe(1);
  });
});

describe('cycle time is split into building and waiting for review', () => {
  it('measures start to review, and review to done', () => {
    doneTask(NOW - 2 * DAY, { built: 3 * HOUR, waited: 2 * HOUR });

    const c = projectMetrics(t.db, admin(), 'laika', NOW - 10 * DAY, NOW).cycle_time!;
    expect(c.p50_ms).toBe(5 * HOUR);
    expect(c.building).toEqual({
      measured: 1,
      p50_ms: 3 * HOUR,
      p75_ms: 3 * HOUR,
      p90_ms: 3 * HOUR,
    });
    expect(c.waiting_for_review).toEqual({
      measured: 1,
      p50_ms: 2 * HOUR,
      p75_ms: 2 * HOUR,
      p90_ms: 2 * HOUR,
    });
  });

  it('times from the latest entry into review, so a sent-back round is building', () => {
    const task = createTask(t.sqlite, t.db, admin(), 'laika', {
      title: 'Reworked',
      now: NOW - 9 * HOUR,
    });
    claimTask(t.sqlite, t.db, admin(), task.id, NOW - 8 * HOUR);
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'One', now: NOW - 7 * HOUR });
    changeStatus(t.db, admin(), task.id, 'in_progress', NOW - 6 * HOUR);
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Two', now: NOW - 3 * HOUR });
    changeStatus(t.db, admin(), task.id, 'done', NOW - HOUR);

    const c = projectMetrics(t.db, admin(), 'laika', NOW - 10 * DAY, NOW).cycle_time!;
    expect(c.building?.p50_ms).toBe(5 * HOUR);
    expect(c.waiting_for_review?.p50_ms).toBe(2 * HOUR);
  });

  it('counts a task done without review as all building, and no wait', () => {
    const task = createTask(t.sqlite, t.db, admin(), 'laika', {
      title: 'Straight',
      now: NOW - 5 * HOUR,
    });
    claimTask(t.sqlite, t.db, admin(), task.id, NOW - 4 * HOUR);
    changeStatus(t.db, admin(), task.id, 'done', NOW - HOUR);

    const c = projectMetrics(t.db, admin(), 'laika', NOW - 10 * DAY, NOW).cycle_time!;
    expect(c.building?.p50_ms).toBe(3 * HOUR);
    expect(c.waiting_for_review).toBeNull();
  });
});

function sprint(daysLeft: number, taskIds: string[]): string {
  const s = createSprint(t.sqlite, t.db, admin(), 'laika', {
    name: 'Sprint',
    starts_on: Date.UTC(2026, 9, 1),
    ends_on: Date.UTC(2026, 9, 15) + (daysLeft - 1) * DAY,
    now: NOW - 20 * DAY,
  });
  addTasksToSprint(t.sqlite, t.db, admin(), s.id, taskIds, NOW - DAY);
  return s.id;
}

const openTask = (parent?: string) =>
  createTask(t.sqlite, t.db, admin(), 'laika', {
    title: 'Open work',
    now: NOW - DAY,
    ...(parent === undefined ? {} : { parent_task_id: parent }),
  }).id;

describe('the sprint forecast', () => {
  it('learns nothing from a sweep', () => {
    for (let i = 0; i < 9; i += 1) doneTask(NOW - (i + 1) * DAY - 3 * HOUR);
    sweptToDone(BULK_MOVE_TASKS + 1, NOW - 12 * DAY);
    const view = getSprintForecast(t.db, admin(), sprint(5, [openTask()]), NOW);
    expect(view.reason).toBe('not_enough_history');
    expect(view.basis.tasks_done).toBe(9);
    expect(view.basis.bulk_excluded).toBe(BULK_MOVE_TASKS + 1);
  });

  it('counts top-level tasks only', () => {
    const parent = openTask();
    const id = sprint(5, [parent, openTask(parent), openTask(parent), openTask()]);
    const view = getSprintForecast(t.db, admin(), id, NOW);
    expect(view.total).toBe(2);
  });

  it('never answers the whole range as a forecast', () => {
    // History on three days of the last seven: a day drawn finishes the one
    // task left about 3 times in 7, so "0–1 of 1" holds every draw — no answer.
    for (const daysAgo of [1, 2, 3]) {
      for (let i = 0; i < 4; i += 1) doneTask(NOW - daysAgo * DAY - i * 10 * 60 * SECOND);
    }
    const view = getSprintForecast(t.db, admin(), sprint(1, [openTask()]), NOW);
    expect(view.forecast).toBeNull();
    expect(view.reason).toBe('too_uncertain');
  });
});

describe('the heatmap', () => {
  it('leaves a sweep’s moves off the day, and keeps the rest of the day', () => {
    const tasks = Array.from(
      { length: BULK_MOVE_TASKS + 1 },
      (_, i) =>
        createTask(t.sqlite, t.db, admin(), 'laika', { title: 'x', now: NOW - 5 * DAY - i * HOUR })
          .id,
    );
    const day = NOW - DAY;
    const projectId = t.sqlite.prepare('SELECT id FROM projects').get() as { id: string };
    tasks.forEach((taskId, i) =>
      appendActivity(t.db, {
        orgId,
        projectId: projectId.id,
        taskId,
        actorId: adminId,
        actorKind: 'user',
        type: 'task.status_changed',
        payload: { from: 'backlog', to: 'todo' },
        now: day + i * SECOND,
      }),
    );
    appendActivity(t.db, {
      orgId,
      projectId: projectId.id,
      taskId: tasks[0]!,
      actorId: adminId,
      actorKind: 'user',
      type: 'task.updated',
      now: day + HOUR,
    });

    const view = getPeopleActivity(t.db, admin(), adminId, '12w', NOW);
    expect(view.series.board_self.at(-2)).toBe(1);
    expect(view.bulk_excluded).toBe(BULK_MOVE_TASKS + 1);
  });
});

describe('the feed', () => {
  it('marks a sweep’s rows as bulk and everything else not', () => {
    doneTask(NOW - 3 * DAY);
    sweptToDone(BULK_MOVE_TASKS + 1, NOW - DAY);

    const rows = listProjectActivity(t.db, admin(), 'laika', { limit: 200, cursor: null });
    const moves = rows.filter((r) => r.type === 'task.status_changed');
    const bulk = moves.filter((r) => r.bulk);
    expect(bulk).toHaveLength(BULK_MOVE_TASKS + 1);
    expect(bulk.every((r) => (r.payload as { to: string }).to === 'done')).toBe(true);
    expect(rows.filter((r) => !r.bulk).length).toBe(rows.length - bulk.length);
    expect(rows.every((r) => typeof r.bulk === 'boolean')).toBe(true);
  });
});
