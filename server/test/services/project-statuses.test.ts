import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { readPayload } from '../../src/db/activity.ts';
import { TASK_STATUSES, type OrgRole, type TaskStatus } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, projectStatuses, tasks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  createProjectStatus,
  deleteProjectStatus,
  listProjectStatuses,
  reorderProjectStatuses,
  updateProjectStatus,
  type ProjectStatusView,
} from '../../src/services/project-statuses.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import {
  changeStatus,
  claimTask,
  createTask,
  getTask,
  listTasks,
  type TaskView,
} from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Project statuses (LAI-738, D-077) — the service, and how a task moves
 * between them.
 *
 * The bugs this replaces are each asserted by name below, because a status
 * model that quietly reintroduced one would otherwise pass every shape test:
 * unticking a status always failed, a donor column lost its primary, deleting
 * a column merged its statuses, an empty column vanished.
 */

let t: TestDb;
let adminId: string;
let memberId: string;
let viewerId: string;

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

/** The same person through a token — what MCP resolves to (§5's agent table). */
function agent(userId: string): ResolvedActor {
  return { ...actor(userId), token: { id: 'tok_1', scope: 'full', projectIds: null } };
}

function expectApiError(fn: () => unknown, code: string): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      expect(err.code, err.message).toBe(code);
      return err;
    }
    throw err;
  }
  throw new Error(`Expected an ApiError with code ${code}`);
}

function statuses(): ProjectStatusView[] {
  return listProjectStatuses(t.db, actor(adminId), 'laika');
}

function named(name: string): ProjectStatusView {
  const found = statuses().find((s) => s.name === name);
  if (found === undefined) {
    throw new Error(
      `no status ${name}; have ${statuses()
        .map((s) => s.name)
        .join(', ')}`,
    );
  }
  return found;
}

function add(name: string, category: TaskStatus, position?: number): ProjectStatusView {
  createProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', {
    name,
    category,
    ...(position === undefined ? {} : { position }),
  });
  return named(name);
}

function newTask(status: TaskStatus = 'backlog'): TaskView {
  return createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'A task', status });
}

/** The latest `task.status_changed` payload for a task, read from the table. */
function lastStatusChange(taskId: string): Record<string, unknown> {
  const row = t.db
    .select()
    .from(activity)
    .where(and(eq(activity.taskId, taskId), eq(activity.type, 'task.status_changed')))
    .orderBy(sql`rowid DESC`)
    .get();
  if (row === undefined) throw new Error('no status change recorded');
  return readPayload(row) as Record<string, unknown>;
}

function categoriesCovered(): Set<TaskStatus> {
  return new Set(
    t.db
      .select({ category: projectStatuses.category })
      .from(projectStatuses)
      .where(eq(projectStatuses.projectId, projectId))
      .all()
      .map((r) => r.category),
  );
}

let projectId: string;

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin');
  memberId = makeUser('member');
  viewerId = makeUser('viewer');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();

  projectId = createProject(t.sqlite, t.db, actor(adminId), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  }).id;

  addMember(t.db, actor(adminId), 'laika', memberId, 'member');
  addMember(t.db, actor(adminId), 'laika', viewerId, 'viewer');
});

afterEach(() => {
  t.close();
});

// ------------------------------------------------------------------ reading

describe('listing a project’s statuses', () => {
  it('gives a new project the six defaults, by position, with Cancelled hidden', () => {
    expect(statuses().map((s) => [s.name, s.category, s.position, s.hidden])).toEqual([
      ['Backlog', 'backlog', 0, false],
      ['To do', 'todo', 1, false],
      ['In progress', 'in_progress', 2, false],
      ['Review', 'review', 3, false],
      ['Done', 'done', 4, false],
      ['Cancelled', 'cancelled', 5, true],
    ]);
  });

  it('counts the tasks in each status', () => {
    newTask('todo');
    newTask('todo');
    expect(named('To do').task_count).toBe(2);
    expect(named('Backlog').task_count).toBe(0);
  });

  it('is readable by a viewer and writable only with project.settings.edit', () => {
    expect(listProjectStatuses(t.db, actor(viewerId), 'laika')).toHaveLength(6);
    expectApiError(
      () =>
        createProjectStatus(t.sqlite, t.db, actor(memberId), 'laika', {
          name: 'QA',
          category: 'review',
        }),
      'forbidden',
    );
  });
});

// ----------------------------------------------------------------- creating

describe('adding a status', () => {
  it('lands straight after the last status of its category when no position is given', () => {
    add('QA', 'review');
    expect(statuses().map((s) => s.name)).toEqual([
      'Backlog',
      'To do',
      'In progress',
      'Review',
      'QA',
      'Done',
      'Cancelled',
    ]);
    expect(statuses().map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('goes where it is told, and everything from there moves one right', () => {
    add('Triage', 'backlog', 0);
    expect(
      statuses()
        .map((s) => s.name)
        .slice(0, 3),
    ).toEqual(['Triage', 'Backlog', 'To do']);
    expect(statuses().map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('starts empty and stays on the list — an empty column does not vanish', () => {
    add('Blocked', 'in_progress');
    expect(named('Blocked').task_count).toBe(0);
    newTask('todo');
    expect(statuses().map((s) => s.name)).toContain('Blocked');
  });

  it('refuses a name the project already has, whatever its case', () => {
    const err = expectApiError(() => add('review', 'review'), 'conflict');
    expect(err.message).toBe('This project already has a status called Review');
  });

  it('trims the name and refuses an empty or over-long one', () => {
    createProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', {
      name: '  QA  ',
      category: 'review',
    });
    expect(named('QA').name).toBe('QA');
    expectApiError(() => add('   ', 'review'), 'unprocessable');
    expectApiError(() => add('x'.repeat(41), 'review'), 'unprocessable');
  });

  it('refuses a position past the end', () => {
    expectApiError(() => add('QA', 'review', 7), 'unprocessable');
  });

  it('records the change as project configuration, not a new verb', () => {
    const status = add('QA', 'review');
    const row = t.db
      .select()
      .from(activity)
      .where(eq(activity.type, 'project.updated'))
      .orderBy(sql`rowid DESC`)
      .get()!;
    expect(readPayload(row)).toMatchObject({
      entity: 'project_status',
      action: 'created',
      status_id: status.id,
      name: 'QA',
      category: 'review',
    });
  });
});

// ----------------------------------------------------------------- updating

describe('renaming and hiding a status', () => {
  it('renames, and the task views follow', () => {
    const task = newTask('review');
    updateProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', named('Review').id, {
      name: 'Code review',
    });
    expect(getTask(t.db, actor(adminId), task.id).status_name).toBe('Code review');
  });

  it('hides and shows', () => {
    const id = named('Review').id;
    updateProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', id, { hidden: true });
    expect(named('Review').hidden).toBe(true);
    updateProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', id, { hidden: false });
    expect(named('Review').hidden).toBe(false);
  });

  it('refuses a rename onto another status’s name, but not onto its own', () => {
    expectApiError(
      () =>
        updateProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', named('Review').id, {
          name: 'DONE',
        }),
      'conflict',
    );
    updateProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', named('Review').id, {
      name: 'REVIEW',
    });
    expect(named('REVIEW').category).toBe('review');
  });

  it('answers 404 for a status of no project', () => {
    expectApiError(
      () => updateProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', 'nope', { name: 'X' }),
      'not_found',
    );
  });
});

// ---------------------------------------------------------------- reordering

describe('reordering', () => {
  it('writes the order it is sent', () => {
    const ids = statuses().map((s) => s.id);
    const reversed = [...ids].reverse();
    const after = reorderProjectStatuses(t.sqlite, t.db, actor(adminId), 'laika', reversed);
    expect(after.map((s) => s.id)).toEqual(reversed);
    expect(after.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('refuses anything that is not every status exactly once', () => {
    const ids = statuses().map((s) => s.id);
    expectApiError(
      () => reorderProjectStatuses(t.sqlite, t.db, actor(adminId), 'laika', ids.slice(1)),
      'unprocessable',
    );
    expectApiError(
      () =>
        reorderProjectStatuses(t.sqlite, t.db, actor(adminId), 'laika', [
          ids[0]!,
          ...ids.slice(0, -1),
        ]),
      'unprocessable',
    );
  });
});

// ------------------------------------------------------------------ deleting

describe('deleting a status', () => {
  it('refuses the last status of a category, and says which in words', () => {
    const err = expectApiError(
      () =>
        deleteProjectStatus(
          t.sqlite,
          t.db,
          actor(adminId),
          'laika',
          named('Review').id,
          named('Done').id,
        ),
      'conflict',
    );
    expect(err.message).toBe(
      'Review is this project’s only Review status, and every project keeps at least one',
    );
    expect(err.message).not.toMatch(/in_progress|review\b/);
  });

  it('refuses moving the work into the status being deleted', () => {
    const qa = add('QA', 'review');
    expectApiError(
      () => deleteProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', qa.id, qa.id),
      'unprocessable',
    );
  });

  it('refuses a destination from another project', () => {
    createProject(t.sqlite, t.db, actor(adminId), { name: 'Other', slug: 'other', prefix: 'OTH' });
    const theirs = listProjectStatuses(t.db, actor(adminId), 'other')[0]!;
    const qa = add('QA', 'review');
    expectApiError(
      () => deleteProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', qa.id, theirs.id),
      'unprocessable',
    );
  });

  it('moves work within a category as a column change, logged, and deletes only that status', () => {
    const qa = add('QA', 'review');
    const task = newTask('in_progress');
    changeStatus(t.db, actor(adminId), task.id, { status_id: qa.id });
    const before = statuses().filter((s) => s.id !== qa.id);

    const result = deleteProjectStatus(
      t.sqlite,
      t.db,
      actor(adminId),
      'laika',
      qa.id,
      named('Review').id,
    );

    expect(result.moved).toBe(1);
    const moved = getTask(t.db, actor(adminId), task.id);
    expect(moved).toMatchObject({ status: 'review', status_name: 'Review' });
    expect(lastStatusChange(task.id)).toMatchObject({
      from: 'review',
      to: 'review',
      from_status_name: 'QA',
      to_status_name: 'Review',
    });
    // Not a merge: every other status is exactly as it was, positions closed up.
    expect(result.data.map((s) => [s.id, s.name, s.category, s.hidden])).toEqual(
      before.map((s) => [s.id, s.name, s.category, s.hidden]),
    );
    expect(result.data.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('moves work across categories as a real status change, through §5', () => {
    const shipped = add('Shipped', 'done');
    const task = newTask('review');
    changeStatus(t.db, actor(adminId), task.id, { status_id: shipped.id });

    // Deleting Shipped into In progress reopens the task — §5 allows done →
    // in_progress — and the dates behave as a reopen does.
    deleteProjectStatus(
      t.sqlite,
      t.db,
      actor(adminId),
      'laika',
      shipped.id,
      named('In progress').id,
    );

    const moved = getTask(t.db, actor(adminId), task.id);
    expect(moved).toMatchObject({ status: 'in_progress', status_name: 'In progress' });
    expect(moved.completed_at).not.toBeNull();
    expect(lastStatusChange(task.id)).toMatchObject({ from: 'done', to: 'in_progress' });
  });

  it('moves nothing and deletes nothing when §5 refuses any one task', () => {
    const shipped = add('Shipped', 'done');
    const first = newTask('review');
    const second = newTask('review');
    changeStatus(t.db, actor(adminId), first.id, { status_id: shipped.id });
    changeStatus(t.db, actor(adminId), second.id, { status_id: shipped.id });

    // done → cancelled is refused by §5 for everyone.
    const err = expectApiError(
      () =>
        deleteProjectStatus(
          t.sqlite,
          t.db,
          actor(adminId),
          'laika',
          shipped.id,
          named('Cancelled').id,
        ),
      'unprocessable',
    );
    expect(err.message).toMatch(/^Shipped was not deleted: LAI-\d+ cannot move to Cancelled\./);
    expect(err.message).toContain('Cannot move a task from Shipped to Cancelled');

    expect(named('Shipped').task_count).toBe(2);
    expect(getTask(t.db, actor(adminId), first.id).status_name).toBe('Shipped');
  });

  it('keeps every category covered through any sequence of adds and deletes', () => {
    // Park–Miller: every product stays below 2^47, so it is exact in a double.
    // An LCG whose product passed 2^53 lost its low bits and returned 0 for
    // every `rand(2)` — a walk that only ever added, which proved nothing.
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    let deleted = 0;
    let refused = 0;

    for (let step = 0; step < 120; step += 1) {
      const all = statuses();
      if (rand(2) === 0) {
        add(`S${String(step)}`, TASK_STATUSES[rand(6)]!);
      } else {
        const victim = all[rand(all.length)]!;
        const sameCategory = all.filter(
          (s) => s.category === victim.category && s.id !== victim.id,
        );
        try {
          deleteProjectStatus(
            t.sqlite,
            t.db,
            actor(adminId),
            'laika',
            victim.id,
            (sameCategory[0] ?? all.find((s) => s.id !== victim.id)!).id,
          );
          deleted += 1;
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          refused += 1;
        }
      }
      expect(categoriesCovered().size, `after step ${String(step)}`).toBe(6);
      expect(statuses().map((s) => s.position)).toEqual(statuses().map((_, i) => i));
    }

    // The walk exercised both branches, or the invariant was never at risk.
    expect(deleted).toBeGreaterThan(10);
    expect(refused).toBeGreaterThan(5);
  });
});

// ------------------------------------------------- tasks moving between them

describe('a task moving between statuses (services/tasks.ts)', () => {
  it('carries status_id and status_name beside the category', () => {
    const task = newTask('todo');
    expect(task).toMatchObject({
      status: 'todo',
      status_id: named('To do').id,
      status_name: 'To do',
    });
  });

  it('moves within a category for anyone with task.write, without §5 and without touching dates', () => {
    const coding = add('Coding', 'in_progress');
    const task = createTask(t.sqlite, t.db, actor(memberId), 'laika', {
      title: 'Mine',
      status: 'in_progress',
    });
    const before = getTask(t.db, actor(adminId), task.id);

    const moved = changeStatus(t.db, actor(memberId), task.id, { status_id: coding.id });

    expect(moved).toMatchObject({ status: 'in_progress', status_name: 'Coding' });
    expect(moved.started_at).toBe(before.started_at);
    expect(lastStatusChange(task.id)).toEqual({
      from: 'in_progress',
      to: 'in_progress',
      from_status_id: named('In progress').id,
      from_status_name: 'In progress',
      to_status_id: coding.id,
      to_status_name: 'Coding',
    });
  });

  it('lets a viewer do none of it', () => {
    const coding = add('Coding', 'in_progress');
    const task = newTask('in_progress');
    expectApiError(
      () => changeStatus(t.db, actor(viewerId), task.id, { status_id: coding.id }),
      'forbidden',
    );
  });

  it('moves across categories by status_id under §5’s rules, names in the error', () => {
    const shipped = add('Shipped', 'done');
    const task = newTask('backlog');

    // A person may jump (LAI-266's widened table)…
    expect(changeStatus(t.db, actor(adminId), task.id, { status_id: shipped.id })).toMatchObject({
      status: 'done',
      status_name: 'Shipped',
    });

    // …an agent may not, whether it names the category, the status or its id —
    // and since D-081 it is told the rule for done, not the table's refusal.
    const other = newTask('backlog');
    for (const target of ['done', { status_id: shipped.id }, { status_name: 'shipped' }] as const) {
      const err = expectApiError(
        () => changeStatus(t.db, agent(adminId), other.id, target),
        'forbidden',
      );
      expect(err.details).toMatchObject({ reason: 'agent_cannot_mark_done', status: 'done' });
    }
    expect(getTask(t.db, actor(adminId), other.id).status).toBe('backlog');

    const err = expectApiError(
      () => changeStatus(t.db, agent(adminId), other.id, { status_id: shipped.id }),
      'forbidden',
    );
    expect(err.message).toMatch(/^An agent cannot move a task into Shipped\. Call finish_task/);
  });

  it('lets an agent move work only where the §5 agent table already let it', () => {
    add('QA', 'review');
    const task = newTask('in_progress');

    // in_progress → review is an agent move; landing in QA by name is the same move.
    expect(changeStatus(t.db, agent(adminId), task.id, { status_name: 'qa' })).toMatchObject({
      status: 'review',
      status_name: 'QA',
    });
  });

  it('treats a bare category the task is already in as a no-op, not a hop', () => {
    const qa = add('QA', 'review');
    const task = newTask('in_progress');
    changeStatus(t.db, actor(adminId), task.id, { status_id: qa.id });

    const err = expectApiError(
      () => changeStatus(t.db, actor(adminId), task.id, 'review'),
      'conflict',
    );
    expect(err.message).toBe('That task is already in QA');
    expect(getTask(t.db, actor(adminId), task.id).status_name).toBe('QA');
  });

  it('refuses a move to the status it is in', () => {
    const task = newTask('todo');
    expectApiError(
      () => changeStatus(t.db, actor(adminId), task.id, { status_id: named('To do').id }),
      'conflict',
    );
  });

  it('sends a bare category to the first visible status of it', () => {
    const qa = add('QA', 'review', 3);
    updateProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', qa.id, { hidden: true });
    const task = newTask('in_progress');

    // QA is first by position but hidden, so Review.
    expect(changeStatus(t.db, actor(adminId), task.id, 'review').status_name).toBe('Review');
  });

  it('refuses another project’s status and an unknown name, saying what the project has', () => {
    createProject(t.sqlite, t.db, actor(adminId), { name: 'Other', slug: 'other', prefix: 'OTH' });
    const theirs = listProjectStatuses(t.db, actor(adminId), 'other')[1]!;
    const task = newTask('backlog');

    expectApiError(
      () => changeStatus(t.db, actor(adminId), task.id, { status_id: theirs.id }),
      'unprocessable',
    );
    const err = expectApiError(
      () => changeStatus(t.db, actor(adminId), task.id, { status_name: 'Shipping' }),
      'unprocessable',
    );
    expect(err.message).toBe(
      'This project has no status called "Shipping". It has: Backlog, To do, In progress, Review, Done, Cancelled',
    );
  });

  it('prefers an exact name, then a case-insensitive one, and refuses an ambiguous one', () => {
    // SQLite's `lower()` folds ASCII only, so the unique index admits both of
    // these; the service would refuse the second, so they go in directly.
    const now = Date.now();
    const [upper, lower] = [newId(), newId()];
    t.db
      .insert(projectStatuses)
      .values([
        { id: upper, projectId, name: 'État', category: 'review', position: 6, createdAt: now },
        { id: lower, projectId, name: 'état', category: 'done', position: 7, createdAt: now },
      ])
      .run();

    const first = newTask('review');
    expect(changeStatus(t.db, actor(adminId), first.id, { status_name: 'état' })).toMatchObject({
      status_id: lower,
      status_name: 'état',
    });
    const second = newTask('in_progress');
    expect(changeStatus(t.db, actor(adminId), second.id, { status_name: ' État ' })).toMatchObject({
      status_id: upper,
      status_name: 'État',
    });

    // Neither spelling exactly: two statuses fold to it — say so, in board order.
    const third = newTask('in_progress');
    const err = expectApiError(
      () => changeStatus(t.db, actor(adminId), third.id, { status_name: 'ÉTAT' }),
      'unprocessable',
    );
    expect(err.message).toBe(
      'More than one status is called "ÉTAT" in this project: État, état. Use the exact name',
    );
    expect(err.details).toMatchObject({ field: 'status', candidates: ['État', 'état'] });

    // A unique case-insensitive match still resolves.
    expect(
      changeStatus(t.db, actor(adminId), third.id, { status_name: 'REVIEW' }).status_name,
    ).toBe('Review');
  });

  it('creates into an exact status, or a category’s first visible one, and refuses a disagreement', () => {
    const triage = add('Triage', 'backlog', 0);
    expect(
      createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'a', status_id: triage.id }),
    ).toMatchObject({ status: 'backlog', status_name: 'Triage' });
    expect(
      createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'b', status: 'backlog' }),
    ).toMatchObject({ status: 'backlog', status_name: 'Triage' });
    expectApiError(
      () =>
        createTask(t.sqlite, t.db, actor(adminId), 'laika', {
          title: 'c',
          status: 'done',
          status_id: triage.id,
        }),
      'unprocessable',
    );
  });

  it('claims into the first in-progress status, and leaves a task already in one where it is', () => {
    add('Coding', 'in_progress', 2);
    const fresh = newTask('todo');
    expect(claimTask(t.sqlite, t.db, actor(adminId), fresh.id).status_name).toBe('Coding');
    expect(lastStatusChange(fresh.id)).toMatchObject({
      from: 'todo',
      to: 'in_progress',
      from_status_name: 'To do',
      to_status_name: 'Coding',
      via: 'claim',
    });

    const underway = newTask('todo');
    changeStatus(t.db, actor(adminId), underway.id, { status_id: named('In progress').id });
    expect(claimTask(t.sqlite, t.db, actor(memberId), underway.id).status_name).toBe('In progress');
  });

  it('filters a list by status_id as well as by category', () => {
    const qa = add('QA', 'review');
    const inQa = newTask('in_progress');
    changeStatus(t.db, actor(adminId), inQa.id, { status_id: qa.id });
    const inReview = newTask('in_progress');
    changeStatus(t.db, actor(adminId), inReview.id, 'review');

    const page = { limit: 50, cursor: null, updatedSince: null };
    expect(
      listTasks(t.db, actor(adminId), 'laika', { ...page, status_id: qa.id }).map((v) => v.id),
    ).toEqual([inQa.id]);
    expect(
      listTasks(t.db, actor(adminId), 'laika', { ...page, status: 'review' })
        .map((v) => v.id)
        .sort(),
    ).toEqual([inQa.id, inReview.id].sort());
  });

  it('keeps tasks.status and status_id agreeing after every kind of move', () => {
    const task = newTask('backlog');
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    claimTask(t.sqlite, t.db, actor(adminId), task.id);
    changeStatus(t.db, actor(adminId), task.id, { status_name: 'review' });

    const row = t.db.select().from(tasks).where(eq(tasks.id, task.id)).get()!;
    const status = t.db
      .select()
      .from(projectStatuses)
      .where(eq(projectStatuses.id, row.statusId))
      .get()!;
    expect([row.status, status.category, status.projectId]).toEqual([
      'review',
      'review',
      projectId,
    ]);
  });
});
