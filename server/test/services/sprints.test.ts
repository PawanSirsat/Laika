import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { readPayload } from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, sprints, tasks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import {
  addTasksToSprint,
  createSprint,
  deleteSprint,
  getSprint,
  listSprints,
  removeTaskFromSprint,
  updateSprint,
  type SprintView,
} from '../../src/services/sprints.ts';
import { changeStatus, createTask, listTasks } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let adminId: string;

const DAY = 86_400_000;
const JAN1 = Date.UTC(2026, 0, 1);
/** Day `n` of January 2026, so a date in a test reads as a date. */
const jan = (n: number): number => JAN1 + (n - 1) * DAY;

const LIST = { limit: 50, cursor: null, updatedSince: null };

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

/** An org member who belongs to the project, so no implicit lead is in play. */
function projectMember(role: 'member' | 'lead' | 'viewer' = 'member', slug = 'laika'): string {
  const id = makeUser(role === 'viewer' ? 'viewer' : 'member');
  addMember(t.db, actor(adminId), slug, id, role);
  return id;
}

function sprint(
  overrides: Partial<{
    name: string;
    starts_on: number;
    ends_on: number;
    status: SprintView['status'];
  }> = {},
  slug = 'laika',
): SprintView {
  return createSprint(t.sqlite, t.db, actor(adminId), slug, {
    name: overrides.name ?? `Sprint ${String(Math.random()).slice(2, 8)}`,
    starts_on: overrides.starts_on ?? jan(1),
    ends_on: overrides.ends_on ?? jan(14),
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
  });
}

function task(title = 'Do the thing', slug = 'laika'): string {
  return createTask(t.sqlite, t.db, actor(adminId), slug, { title }).id;
}

/** Activity rows for a sprint, newest last. */
function sprintActivity(sprintId: string): { action: string; payload: Record<string, unknown> }[] {
  return t.db
    .select()
    .from(activity)
    .where(eq(activity.type, 'project.updated'))
    .all()
    .map((row) => readPayload(row) as Record<string, unknown>)
    .filter((p) => p.entity === 'sprint' && p.sprint_id === sprintId)
    .map((payload) => ({ action: String(payload.action), payload }));
}

function expectApiError(fn: () => unknown, code: string, message?: RegExp): ApiError {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    expect(err.code).toBe(code);
    if (message !== undefined) expect(err.message).toMatch(message);
    return err;
  }
  throw new Error(`Expected an ApiError with code "${code}", but nothing was thrown`);
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

describe('creating a sprint (AC1)', () => {
  it('stores dates and a goal, and nothing that looks like an estimate', () => {
    const created = createSprint(t.sqlite, t.db, actor(adminId), 'laika', {
      name: 'Sprint 1',
      goal: 'Ship the board',
      starts_on: jan(1),
      ends_on: jan(14),
    });

    expect(created).toMatchObject({
      name: 'Sprint 1',
      goal: 'Ship the board',
      starts_on: jan(1),
      ends_on: jan(14),
      status: 'planned',
    });
    // D-013: story points remain a non-goal. If a field like this ever appears,
    // it did not come from the spec.
    expect(Object.keys(created)).not.toContain('points');
    expect(Object.keys(created)).not.toContain('velocity');
  });

  it('is lead-or-above, per §3.2 "Create / edit / delete sprints"', () => {
    expect(() => sprint({}, 'laika')).not.toThrow();

    const asLead = createSprint(t.sqlite, t.db, actor(projectMember('lead')), 'laika', {
      name: 'By the lead',
      starts_on: jan(20),
      ends_on: jan(24),
    });
    expect(asLead.name).toBe('By the lead');

    for (const role of ['member', 'viewer'] as const) {
      expectApiError(
        () =>
          createSprint(t.sqlite, t.db, actor(projectMember(role)), 'laika', {
            name: `By a ${role}`,
            starts_on: jan(28),
            ends_on: jan(30),
          }),
        'forbidden',
      );
    }
  });

  it('refuses a name the project already uses', () => {
    sprint({ name: 'Sprint 1' });

    expectApiError(
      () => sprint({ name: 'Sprint 1', starts_on: jan(20), ends_on: jan(24) }),
      'conflict',
      /already has a sprint called/,
    );
  });

  it('writes one activity row naming the sprint', () => {
    const created = sprint({ name: 'Sprint 1' });

    expect(sprintActivity(created.id)).toEqual([
      {
        action: 'created',
        payload: { entity: 'sprint', action: 'created', sprint_id: created.id, name: 'Sprint 1' },
      },
    ]);
  });
});

describe('ends_on after starts_on (AC5)', () => {
  it('rejects a backwards range and a zero-length one', () => {
    for (const [starts, ends] of [
      [jan(14), jan(1)],
      [jan(1), jan(1)],
    ] as const) {
      expectApiError(
        () => sprint({ starts_on: starts, ends_on: ends }),
        'unprocessable',
        /ends_on must be after starts_on/,
      );
    }
  });

  it('rejects it on update too, including when only one end moves', () => {
    const s = sprint({ starts_on: jan(1), ends_on: jan(14) });

    expectApiError(
      () => updateSprint(t.sqlite, t.db, actor(adminId), s.id, { ends_on: jan(1) }),
      'unprocessable',
    );
    expectApiError(
      () => updateSprint(t.sqlite, t.db, actor(adminId), s.id, { starts_on: jan(20) }),
      'unprocessable',
    );
  });
});

describe('sprints of a project may not overlap (AC4)', () => {
  beforeEach(() => {
    sprint({ name: 'Sprint 1', starts_on: jan(10), ends_on: jan(20) });
  });

  it.each([
    ['identical', jan(10), jan(20)],
    ['contained', jan(12), jan(18)],
    ['containing', jan(5), jan(25)],
    ['overlapping the start', jan(5), jan(12)],
    ['overlapping the end', jan(18), jan(25)],
    ['touching the first day', jan(5), jan(10)],
    ['touching the last day', jan(20), jan(25)],
  ])('rejects one %s, and names what it collided with', (_label, starts, ends) => {
    const err = expectApiError(
      () => sprint({ name: 'Clash', starts_on: starts, ends_on: ends }),
      'conflict',
      /overlap sprint "Sprint 1"/,
    );

    expect(err.details).toMatchObject({ name: 'Sprint 1', starts_on: jan(10), ends_on: jan(20) });
  });

  it('allows the day after, because both ends are inclusive', () => {
    expect(() => sprint({ name: 'Next', starts_on: jan(21), ends_on: jan(30) })).not.toThrow();
    expect(() => sprint({ name: 'Before', starts_on: jan(1), ends_on: jan(9) })).not.toThrow();
  });

  it('does not count a sprint against itself when its dates are edited', () => {
    const s = listSprints(t.db, actor(adminId), 'laika', LIST)[0]!;

    // Still overlapping its own old range — the exclusion is what makes any edit
    // to an existing sprint's dates possible at all.
    const moved = updateSprint(t.sqlite, t.db, actor(adminId), s.id, { ends_on: jan(22) });
    expect(moved.ends_on).toBe(jan(22));
  });

  it('applies across the whole project but not between projects', () => {
    createProject(t.sqlite, t.db, actor(adminId), { name: 'Other', slug: 'other', prefix: 'OTH' });

    expect(() =>
      createSprint(t.sqlite, t.db, actor(adminId), 'other', {
        name: 'Same dates elsewhere',
        starts_on: jan(10),
        ends_on: jan(20),
      }),
    ).not.toThrow();
  });
});

describe('at most one active sprint per project (AC3)', () => {
  it('refuses a second, and names the one holding it', () => {
    const first = sprint({
      name: 'Sprint 1',
      starts_on: jan(1),
      ends_on: jan(14),
      status: 'active',
    });
    const second = sprint({ name: 'Sprint 2', starts_on: jan(15), ends_on: jan(28) });

    const err = expectApiError(
      () => updateSprint(t.sqlite, t.db, actor(adminId), second.id, { status: 'active' }),
      'conflict',
      /Sprint 1" is already active/,
    );
    expect(err.details).toMatchObject({ sprint_id: first.id });
  });

  it('refuses one created directly as active', () => {
    sprint({ name: 'Sprint 1', starts_on: jan(1), ends_on: jan(14), status: 'active' });

    expectApiError(
      () => sprint({ name: 'Sprint 2', starts_on: jan(15), ends_on: jan(28), status: 'active' }),
      'conflict',
    );
  });

  it('allows the next one once the first is completed', () => {
    const first = sprint({
      name: 'Sprint 1',
      starts_on: jan(1),
      ends_on: jan(14),
      status: 'active',
    });
    const second = sprint({ name: 'Sprint 2', starts_on: jan(15), ends_on: jan(28) });

    updateSprint(t.sqlite, t.db, actor(adminId), first.id, { status: 'completed' });
    const activated = updateSprint(t.sqlite, t.db, actor(adminId), second.id, { status: 'active' });

    expect(activated.status).toBe('active');
  });

  it('lets the active sprint be updated without tripping over itself', () => {
    const s = sprint({ name: 'Sprint 1', status: 'active' });

    const renamed = updateSprint(t.sqlite, t.db, actor(adminId), s.id, {
      name: 'Sprint One',
      status: 'active',
    });
    expect(renamed).toMatchObject({ name: 'Sprint One', status: 'active' });
  });

  it('is also true of the database, not merely of this code path', () => {
    const first = sprint({
      name: 'Sprint 1',
      starts_on: jan(1),
      ends_on: jan(14),
      status: 'active',
    });
    const second = sprint({ name: 'Sprint 2', starts_on: jan(15), ends_on: jan(28) });

    // Bypassing the service entirely: the partial unique index has to hold.
    expect(() =>
      t.db.update(sprints).set({ status: 'active' }).where(eq(sprints.id, second.id)).run(),
    ).toThrow(/UNIQUE constraint failed|constraint/i);

    expect(
      t.db
        .select()
        .from(sprints)
        .where(eq(sprints.status, 'active'))
        .all()
        .map((r) => r.id),
    ).toEqual([first.id]);
  });
});

describe('deleting a sprint never deletes a task (AC6)', () => {
  it('releases its tasks and leaves them otherwise untouched', () => {
    const s = sprint({ name: 'Sprint 1' });
    const a = task('Task A');
    const b = task('Task B');
    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [a, b]);
    changeStatus(t.db, actor(adminId), a, 'todo');

    deleteSprint(t.sqlite, t.db, actor(adminId), s.id);

    const rows = t.db.select().from(tasks).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sprintId)).toEqual([null, null]);
    // Releasing is not a status change.
    expect(t.db.select().from(tasks).where(eq(tasks.id, a)).get()?.status).toBe('todo');
  });

  it('records how many tasks it released, in one row rather than one per task', () => {
    const s = sprint({ name: 'Sprint 1' });
    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [task('A'), task('B'), task('C')]);

    deleteSprint(t.sqlite, t.db, actor(adminId), s.id);

    expect(sprintActivity(s.id).map((a) => a.action)).toEqual(['created', 'deleted']);
    expect(sprintActivity(s.id)[1]?.payload).toMatchObject({ tasks_released: 3 });
  });

  it('is lead-or-above', () => {
    const s = sprint({ name: 'Sprint 1' });

    expectApiError(
      () => deleteSprint(t.sqlite, t.db, actor(projectMember('member')), s.id),
      'forbidden',
    );
    expect(() => deleteSprint(t.sqlite, t.db, actor(projectMember('lead')), s.id)).not.toThrow();
  });
});

describe('completing a sprint does not sweep its tasks (AC6)', () => {
  it('leaves every status exactly where it was', () => {
    const s = sprint({ name: 'Sprint 1' });
    const done = task('Finished');
    const unfinished = task('Not finished');
    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [done, unfinished]);
    changeStatus(t.db, actor(adminId), done, 'in_progress');

    updateSprint(t.sqlite, t.db, actor(adminId), s.id, { status: 'completed' });

    const after = t.db.select().from(tasks).all();
    expect(after.find((r) => r.id === done)?.status).toBe('in_progress');
    expect(after.find((r) => r.id === unfinished)?.status).toBe('backlog');
    // And they stay in the sprint — completing is not releasing.
    expect(after.every((r) => r.sprintId === s.id)).toBe(true);
  });
});

describe('assigning tasks (AC2)', () => {
  it('is member-or-above, not lead', () => {
    const s = sprint({ name: 'Sprint 1' });

    const assigned = addTasksToSprint(t.sqlite, t.db, actor(projectMember('member')), s.id, [
      task('A'),
    ]);
    expect(assigned[0]?.sprint_id).toBe(s.id);

    expectApiError(
      () => addTasksToSprint(t.sqlite, t.db, actor(projectMember('viewer')), s.id, [task('B')]),
      'forbidden',
    );
  });

  it('returns the tasks as they now are', () => {
    const s = sprint({ name: 'Sprint 1' });
    const ids = [task('A'), task('B')];

    const returned = addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, ids);

    expect(returned.map((v) => v.id)).toEqual(ids);
    expect(returned.every((v) => v.sprint_id === s.id)).toBe(true);
  });

  it('is all-or-nothing when one id is unknown', () => {
    const s = sprint({ name: 'Sprint 1' });
    const good = task('A');

    const err = expectApiError(
      () =>
        addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [
          good,
          '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ]),
      'not_found',
    );
    expect(err.details).toMatchObject({ task_ids: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'] });

    // The good one must not have been assigned on the way past.
    expect(t.db.select().from(tasks).where(eq(tasks.id, good)).get()?.sprintId).toBeNull();
  });

  it('refuses a task from another project, and assigns none of them', () => {
    createProject(t.sqlite, t.db, actor(adminId), { name: 'Other', slug: 'other', prefix: 'OTH' });
    const s = sprint({ name: 'Sprint 1' });
    const mine = task('Mine');
    const theirs = task('Theirs', 'other');

    const err = expectApiError(
      () => addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [mine, theirs]),
      'unprocessable',
      /different project/,
    );
    expect(err.details).toMatchObject({ task_ids: [theirs] });
    expect(t.db.select().from(tasks).where(eq(tasks.id, mine)).get()?.sprintId).toBeNull();
  });

  it('writes one task.updated per task moved, and none for a task already there', () => {
    const s = sprint({ name: 'Sprint 1' });
    const a = task('A');

    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [a]);
    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [a]);

    const moves = t.db
      .select()
      .from(activity)
      .where(and(eq(activity.type, 'task.updated'), eq(activity.taskId, a)))
      .all()
      .map((row) => readPayload(row));

    expect(moves).toEqual([{ field: 'sprint_id', from: null, to: s.id }]);
  });

  it('moves a task straight from one sprint to another', () => {
    const first = sprint({ name: 'Sprint 1', starts_on: jan(1), ends_on: jan(14) });
    const second = sprint({ name: 'Sprint 2', starts_on: jan(15), ends_on: jan(28) });
    const a = task('A');

    addTasksToSprint(t.sqlite, t.db, actor(adminId), first.id, [a]);
    const moved = addTasksToSprint(t.sqlite, t.db, actor(adminId), second.id, [a]);

    expect(moved[0]?.sprint_id).toBe(second.id);
  });
});

describe('removing a task from a sprint (AC2)', () => {
  it('clears sprint_id and returns the task', () => {
    const s = sprint({ name: 'Sprint 1' });
    const a = task('A');
    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [a]);

    const removed = removeTaskFromSprint(t.sqlite, t.db, actor(adminId), s.id, a);

    expect(removed.sprint_id).toBeNull();
    expect(t.db.select().from(tasks).where(eq(tasks.id, a)).get()?.status).toBe('backlog');
  });

  it('404s a task that is in a different sprint, rather than quietly succeeding', () => {
    const first = sprint({ name: 'Sprint 1', starts_on: jan(1), ends_on: jan(14) });
    const second = sprint({ name: 'Sprint 2', starts_on: jan(15), ends_on: jan(28) });
    const a = task('A');
    addTasksToSprint(t.sqlite, t.db, actor(adminId), first.id, [a]);

    expectApiError(
      () => removeTaskFromSprint(t.sqlite, t.db, actor(adminId), second.id, a),
      'not_found',
      /not in this sprint/,
    );
    expect(t.db.select().from(tasks).where(eq(tasks.id, a)).get()?.sprintId).toBe(first.id);
  });
});

describe('reading (AC1)', () => {
  it('lists a project chronologically, not by updated_at', () => {
    const late = sprint({ name: 'Late', starts_on: jan(20), ends_on: jan(28) });
    const early = sprint({ name: 'Early', starts_on: jan(1), ends_on: jan(14) });

    // `late` was written first, so an `updated_at` order would put it first.
    expect(listSprints(t.db, actor(adminId), 'laika', LIST).map((s) => s.id)).toEqual([
      early.id,
      late.id,
    ]);
  });

  it('filters by status', () => {
    sprint({ name: 'Planned', starts_on: jan(20), ends_on: jan(28) });
    const active = sprint({
      name: 'Active',
      starts_on: jan(1),
      ends_on: jan(14),
      status: 'active',
    });

    expect(
      listSprints(t.db, actor(adminId), 'laika', { ...LIST, status: 'active' }).map((s) => s.id),
    ).toEqual([active.id]);
  });

  it('follows project membership, not sprint.manage', () => {
    const s = sprint({ name: 'Sprint 1' });
    const viewer = projectMember('viewer');

    expect(getSprint(t.db, actor(viewer), s.id).id).toBe(s.id);
    expect(listSprints(t.db, actor(viewer), 'laika', LIST)).toHaveLength(1);

    const outsider = makeUser('member');
    expectApiError(() => getSprint(t.db, actor(outsider), s.id), 'forbidden');
  });

  it('404s an unknown id', () => {
    expectApiError(
      () => getSprint(t.db, actor(adminId), '01ARZ3NDEKTSV4RRFFQ69G5FAV'),
      'not_found',
    );
  });
});

describe('the ?sprint= filter on tasks (AC7)', () => {
  it('selects a sprint, and `none` selects the unassigned', () => {
    const s = sprint({ name: 'Sprint 1' });
    const inSprint = task('In');
    const loose = task('Loose');
    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [inSprint]);

    const base = { limit: 50, cursor: null, updatedSince: null };
    const all = listTasks(t.db, actor(adminId), 'laika', base);
    expect(all).toHaveLength(2);

    expect(
      listTasks(t.db, actor(adminId), 'laika', { ...base, sprint: s.id }).map((v) => v.id),
    ).toEqual([inSprint]);
    expect(
      listTasks(t.db, actor(adminId), 'laika', { ...base, sprint: 'none' }).map((v) => v.id),
    ).toEqual([loose]);
  });

  it('puts sprint_id on the task view, so a client can see what it filtered on', () => {
    const s = sprint({ name: 'Sprint 1' });
    const a = task('A');
    addTasksToSprint(t.sqlite, t.db, actor(adminId), s.id, [a]);

    const [view] = listTasks(t.db, actor(adminId), 'laika', {
      limit: 50,
      cursor: null,
      updatedSince: null,
      sprint: s.id,
    });
    expect(view?.sprint_id).toBe(s.id);
  });
});
