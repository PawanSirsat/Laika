import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { immediateTransaction } from '../../src/db/numbering.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createProject } from '../../src/services/projects.ts';
import {
  getSprintForecast,
  sprintForecastCounters,
  THROUGHPUT_MIN_TASKS,
} from '../../src/services/sprint-forecast.ts';
import { addTasksToSprint, createSprint, updateSprint } from '../../src/services/sprints.ts';
import { changeStatus, claimTask, createTask, finishTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The sprint forecast in the database (LAI-772, the R&D's idea 10): "85%
 * likely to finish 18–23 of 26", from the project's own recent throughput —
 * the size weight it finished per day — and the weights still to do. Bounded
 * and cached: the same inputs never simulate twice.
 */

vi.setConfig({ testTimeout: 60_000 });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 15, 12);

let t: TestDb;
let adminId: string;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}
const admin = () => actor(adminId);

/** A task done `daysAgo` days before NOW. */
function doneTask(daysAgo: number, slug = 'laika'): string {
  const at = NOW - daysAgo * DAY;
  const task = createTask(t.sqlite, t.db, admin(), slug, {
    title: 'Done work',
    acceptance_md: 'work work work work work',
    now: at - 2 * HOUR,
  });
  claimTask(t.sqlite, t.db, admin(), task.id, at - HOUR);
  finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: at - HOUR / 2 });
  changeStatus(t.db, admin(), task.id, 'done', at);
  return task.id;
}

function openTask(slug = 'laika'): string {
  return createTask(t.sqlite, t.db, admin(), slug, {
    title: 'Open work',
    acceptance_md: 'work work work work work',
    now: NOW - DAY,
  }).id;
}

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

beforeEach(() => {
  t = freshDb();
  adminId = newId();
  t.db
    .insert(users)
    .values({
      id: adminId,
      email: 'ada@example.test',
      name: 'Ada',
      orgRole: 'admin',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: NOW, updatedAt: NOW })
    .run();
  createProject(t.sqlite, t.db, admin(), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

describe('getSprintForecast', () => {
  it('says how many of the sprint’s tasks are likely done by its end, and how likely', () => {
    const done = immediateTransaction(t.sqlite, () =>
      Array.from({ length: 24 }, (_, i) => doneTask(1 + i)),
    );
    const left = Array.from({ length: 12 }, () => openTask());
    const id = sprint(5, [...done.slice(0, 4), ...left]);

    const view = getSprintForecast(t.db, admin(), id, NOW);
    expect(view.total).toBe(16);
    expect(view.done).toBe(4);
    expect(view.reason).toBeNull();
    const f = view.forecast!;
    // About one task a day for five days: more than are done, fewer than all.
    expect(f.low).toBeGreaterThanOrEqual(4);
    expect(f.high).toBeLessThanOrEqual(16);
    expect(f.low).toBeLessThanOrEqual(f.median);
    expect(f.median).toBeLessThanOrEqual(f.high);
    expect(f.high).toBeGreaterThan(4);
    expect(f.probability).toBeGreaterThanOrEqual(0.85);
    expect(f.days_left).toBe(5);
    expect(view.basis.tasks_done).toBe(24);
  });

  it('forecasts nothing from too little history', () => {
    const done = Array.from({ length: THROUGHPUT_MIN_TASKS - 1 }, (_, i) => doneTask(1 + i));
    const id = sprint(5, [...done, openTask()]);
    const view = getSprintForecast(t.db, admin(), id, NOW);
    expect(view.forecast).toBeNull();
    expect(view.reason).toBe('not_enough_history');
    expect(view.basis.tasks_done).toBe(THROUGHPUT_MIN_TASKS - 1);
  });

  it('forecasts nothing for a completed sprint', () => {
    immediateTransaction(t.sqlite, () => {
      for (let i = 0; i < 12; i += 1) doneTask(1 + i);
    });
    const id = sprint(5, [openTask()]);
    updateSprint(t.sqlite, t.db, admin(), id, { status: 'completed', now: NOW });
    const view = getSprintForecast(t.db, admin(), id, NOW);
    expect(view.forecast).toBeNull();
    expect(view.reason).toBe('completed');
  });

  it('is cached: the same inputs never simulate twice; a change does', () => {
    immediateTransaction(t.sqlite, () => {
      for (let i = 0; i < 12; i += 1) doneTask(1 + i);
    });
    const left = [openTask(), openTask(), openTask()];
    const id = sprint(5, left);
    const before = sprintForecastCounters.simulated;
    const first = getSprintForecast(t.db, admin(), id, NOW);
    expect(sprintForecastCounters.simulated).toBe(before + 1);
    expect(getSprintForecast(t.db, admin(), id, NOW + 1000)).toEqual(first);
    expect(sprintForecastCounters.simulated).toBe(before + 1);

    claimTask(t.sqlite, t.db, admin(), left[0]!, NOW + 2000);
    finishTask(t.sqlite, t.db, admin(), left[0]!, { summary: 'Done', now: NOW + 3000 });
    changeStatus(t.db, admin(), left[0]!, 'done', NOW + 4000);
    const after = getSprintForecast(t.db, admin(), id, NOW + 5000);
    expect(sprintForecastCounters.simulated).toBe(before + 2);
    expect(after.done).toBe(1);
  });

  it('answers only someone who may read the project', () => {
    const outsider = newId();
    t.db
      .insert(users)
      .values({
        id: outsider,
        email: 'eve@example.test',
        name: 'Eve',
        orgRole: 'member',
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      })
      .run();
    const id = sprint(5, [openTask()]);
    let refused: unknown;
    try {
      getSprintForecast(t.db, actor(outsider), id, NOW);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBeGreaterThanOrEqual(403);
  });
});
