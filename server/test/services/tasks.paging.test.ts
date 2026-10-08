import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, sprints, tasks, users } from '../../src/db/schema.ts';
import { addComment } from '../../src/services/comments.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import {
  addTaskDependency,
  createTask,
  getTask,
  listTasks,
  type ListTasksFilter,
  type TaskView,
} from '../../src/services/tasks.ts';
import { freshDb, preparedDuring, type TestDb } from '../helpers/db.ts';

/**
 * `listTasks` pages in SQL (LAI-722).
 *
 * It used to read **every** row after the cursor, build the view context for
 * all of them, and slice one page off the front — so a full cursor walk was
 * quadratic in the project's size. The page is now `LIMIT limit + 1` in SQL
 * when nothing filters after the query, and bounded batches when `ready` does.
 *
 * The promise is that **no response changes**. So every query shape below is
 * walked to the end, at several page sizes, and each page is compared — as
 * serialised JSON — with what the unbounded list says that page must be. The
 * oracle builds each task's view on its own through `getTask` and applies the
 * filters, the order and the cursor in plain JS, so it shares no paging code
 * with the thing it checks.
 */

const BASE = 1_800_000_000_000;

let t: TestDb;
let adminId: string;
let memberId: string;
let projectId: string;
let sprintIds: [string, string];
let parentIds: [string, string];
let everyView: TaskView[];

function makeUser(orgRole: 'admin' | 'member', name: string): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name,
      orgRole,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE),
    })
    .run();
  return id;
}

function actor(userId: string = adminId): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

const STATUSES = ['backlog', 'todo', 'todo', 'in_progress', 'review', 'done', 'cancelled'] as const;
const PRIORITIES = ['p1', 'p2', 'p3'] as const;
const TAGS = [['api'], ['web'], ['api', 'web'], [], ['bug']] as const;

beforeAll(() => {
  t = freshDb();
  adminId = makeUser('admin', 'Admin');
  memberId = makeUser('member', 'Member');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: BASE, updatedAt: BASE })
    .run();
  projectId = createProject(t.sqlite, t.db, actor(), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  }).id;
  addMember(t.db, actor(), 'laika', memberId, 'member');

  sprintIds = [newId(), newId()];
  sprintIds.forEach((id, i) => {
    t.db
      .insert(sprints)
      .values({
        id,
        projectId,
        name: `S${String(i)}`,
        startsOn: BASE,
        endsOn: BASE + 1,
        createdAt: BASE,
        updatedAt: BASE,
      })
      .run();
  });

  const ids: string[] = [];
  for (let i = 0; i < 64; i++) {
    const parent = i > 1 && i % 7 === 3 ? ids[0] : i > 1 && i % 7 === 5 ? ids[1] : undefined;
    const assignee = i % 3 === 0 ? adminId : i % 3 === 1 ? memberId : undefined;
    const view = createTask(t.sqlite, t.db, actor(), 'laika', {
      title: `Task ${String(i)}`,
      description_md: `Body ${String(i)}`,
      status: STATUSES[i % STATUSES.length],
      priority: PRIORITIES[i % PRIORITIES.length],
      tags: [...TAGS[i % TAGS.length]!],
      ...(assignee === undefined ? {} : { assignee_id: assignee }),
      ...(parent === undefined ? {} : { parent_task_id: parent }),
      // Triples share a millisecond, so the `id` tiebreak is on every page edge.
      now: BASE + Math.floor(i / 3),
    });
    ids.push(view.id);
  }
  parentIds = [ids[0]!, ids[1]!];

  for (let i = 0; i < 64; i++) {
    const sprint = i % 4 === 0 ? sprintIds[0] : i % 4 === 1 ? sprintIds[1] : null;
    t.db.update(tasks).set({ sprintId: sprint }).where(eq(tasks.id, ids[i]!)).run();
  }

  // Dependencies on tasks of every status, so readiness differs within a status.
  for (let i = 10; i < 30; i++) {
    addTaskDependency(t.sqlite, t.db, actor(), ids[i]!, ids[i + 30]!, BASE + 100 + i);
  }
  for (let i = 0; i < 64; i += 5) {
    addComment(t.db, actor(), ids[i]!, `Comment on ${String(i)}`, BASE + 200 + i);
  }

  everyView = ids.map((id) => getTask(t.db, actor(), id));
});

afterAll(() => {
  t.close();
});

type Shape = Omit<ListTasksFilter, 'limit' | 'cursor'>;

/** What the unbounded list says one page must be. */
function oracle(shape: Shape, limit: number, cursor: ListTasksFilter['cursor']): TaskView[] {
  return everyView
    .filter((v) => shape.status === undefined || v.status === shape.status)
    .filter((v) => shape.priority === undefined || v.priority === shape.priority)
    .filter(
      (v) =>
        shape.assignee === undefined ||
        v.assignee_id === (shape.assignee === 'none' ? null : shape.assignee),
    )
    .filter(
      (v) =>
        shape.sprint === undefined ||
        v.sprint_id === (shape.sprint === 'none' ? null : shape.sprint),
    )
    .filter((v) => shape.parent === undefined || v.parent_task_id === shape.parent)
    .filter((v) => shape.tag === undefined || v.tags.includes(shape.tag))
    .filter((v) => shape.ready === undefined || v.ready === shape.ready)
    .filter(
      (v) =>
        shape.updatedSince === undefined ||
        shape.updatedSince === null ||
        v.updated_at >= shape.updatedSince,
    )
    .sort((a, b) => a.updated_at - b.updated_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter(
      (v) =>
        cursor === null ||
        v.updated_at > Number(cursor.sortKey) ||
        (v.updated_at === Number(cursor.sortKey) && v.id > cursor.id),
    )
    .slice(0, limit + 1);
}

const SHAPES: [string, () => Shape][] = [
  ['no filter', () => ({})],
  ['status', () => ({ status: 'todo' })],
  ['priority', () => ({ priority: 'p1' })],
  ['assignee', () => ({ assignee: adminId })],
  ['assignee=none', () => ({ assignee: 'none' })],
  ['sprint', () => ({ sprint: sprintIds[0] })],
  ['sprint=none', () => ({ sprint: 'none' })],
  ['subtasks of a parent', () => ({ parent: parentIds[0] })],
  ['tag', () => ({ tag: 'api' })],
  ['updated_since', () => ({ updatedSince: BASE + 9 })],
  ['ready=true', () => ({ ready: true })],
  ['ready=false', () => ({ ready: false })],
  ['ready=true with a tag', () => ({ ready: true, tag: 'web' })],
  [
    'ready=false, unassigned, in no sprint',
    () => ({ ready: false, assignee: 'none', sprint: 'none' }),
  ],
  ['ready=true and todo', () => ({ ready: true, status: 'todo' })],
  ['ready=false on subtasks', () => ({ ready: false, parent: parentIds[1] })],
];

describe('every page is the page the unbounded list implies (LAI-722)', () => {
  it('the fixture is varied enough to mean something', () => {
    // A fixture where every task is ready, or none is, would let a broken
    // `ready` path pass every comparison below.
    const ready = everyView.filter((v) => v.ready).length;
    expect(ready).toBeGreaterThan(2);
    expect(everyView.length - ready).toBeGreaterThan(2);
    expect(everyView.filter((v) => v.blocked_by.length > 0).length).toBeGreaterThan(5);
    expect(everyView.filter((v) => v.parent_task_id !== null).length).toBeGreaterThan(5);
    expect(everyView.filter((v) => v.comment_count > 0).length).toBeGreaterThan(5);
  });

  for (const [name, shapeOf] of SHAPES) {
    it(`${name}: identical over every cursor at limits 1, 2, 5, 13 and 200`, () => {
      const shape = shapeOf();
      let compared = 0;

      for (const limit of [1, 2, 5, 13, 200]) {
        let cursor: ListTasksFilter['cursor'] = null;

        for (let page = 0; page < 100; page++) {
          const got = listTasks(t.db, actor(), 'laika', { ...shape, limit, cursor });
          const want = oracle(shape, limit, cursor);

          expect(JSON.stringify(got), `${name}, limit ${String(limit)}, page ${String(page)}`).toBe(
            JSON.stringify(want),
          );
          compared += got.length;

          if (got.length <= limit) break;
          const last = got[limit - 1]!;
          cursor = { sortKey: last.updated_at, id: last.id };
        }
      }

      // Every shape must actually return rows, or "identical" is "both empty".
      expect(compared).toBeGreaterThan(0);
    });
  }
});

describe('the page is read in SQL, not sliced in JS (LAI-722)', () => {
  function taskSelects(statements: string[]): string[] {
    return statements.filter((sql) => /from "tasks"/.test(sql) && /order by/i.test(sql));
  }

  it('asks SQLite for limit + 1 rows when nothing filters after the query', () => {
    const statements = preparedDuring(t.sqlite, () =>
      listTasks(t.db, actor(), 'laika', { limit: 5, cursor: null }),
    );
    const selects = taskSelects(statements);

    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatch(/ limit \?$/);
  });

  it('builds the view context for the page only', () => {
    const statements = preparedDuring(t.sqlite, () =>
      listTasks(t.db, actor(), 'laika', { limit: 5, cursor: null }),
    );
    const tagRead = statements.find((sql) => /from "task_tags"/.test(sql));

    // One placeholder per task id: the six of `limit + 1`, not all 64.
    expect(tagRead).toBeDefined();
    expect((tagRead!.match(/\?/g) ?? []).length).toBe(6);
  });

  it('bounds every read when ready filters after the query', () => {
    const statements = preparedDuring(t.sqlite, () =>
      listTasks(t.db, actor(), 'laika', { limit: 5, cursor: null, ready: true }),
    );
    const selects = taskSelects(statements);

    expect(selects.length).toBeGreaterThan(0);
    for (const sql of selects) expect(sql).toMatch(/ limit \?$/);
  });
});
