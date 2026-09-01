import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, tags, tasks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import {
  deleteTag,
  listProjectTags,
  MAX_TAGS_PER_TASK,
  normaliseTagName,
  normaliseTagNames,
  renameTag,
  tagsForTasks,
} from '../../src/services/tags.ts';
import { createTask, getTask, listTasks, updateTask } from '../../src/services/tasks.ts';
import { expectSqliteError, freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Tags (§4.16, D-027, LAI-079).
 *
 * The rule that matters most is the lowercase one, and it is enforced in the
 * database rather than only in the service — because `UI`/`Ui`/`ui` as three
 * tags cannot be undone once the rows exist.
 */

let t: TestDb;
let adminId: string;
let memberId: string;
let projectId: string;

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

const LIST = { limit: 50, cursor: null, updatedSince: null };

function newTask(title = 'A task', extra: Record<string, unknown> = {}) {
  return createTask(t.sqlite, t.db, actor(adminId), 'laika', { title, ...extra });
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

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin');
  memberId = makeUser('member');
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
});
afterEach(() => {
  t.close();
});

describe('the name rule is enforced by the database, not only the service', () => {
  it('refuses every case variant at the CHECK constraint', () => {
    // The service lowercases, so the only way to prove the constraint does real
    // work is to write past the service. `UI`, `Ui` and `ui` living as three
    // tags is the failure that cannot be undone once the rows exist.
    for (const name of ['UI', 'Ui', 'uI']) {
      expectSqliteError(
        () =>
          t.db.insert(tags).values({ id: newId(), projectId, name, createdAt: Date.now() }).run(),
        /CHECK constraint failed/,
      );
    }
  });

  it('refuses the other shapes §4.16 excludes', () => {
    for (const name of ['-lead', 'has space', 'has_underscore', 'accénted', '', 'a'.repeat(25)]) {
      expectSqliteError(
        () =>
          t.db.insert(tags).values({ id: newId(), projectId, name, createdAt: Date.now() }).run(),
        /CHECK constraint failed/,
      );
    }
  });

  it('accepts the shapes §4.16 allows, including the boundary', () => {
    for (const name of ['ui', 'core', 'a', '9lives', 'multi-word-tag', 'a'.repeat(24)]) {
      t.db.insert(tags).values({ id: newId(), projectId, name, createdAt: Date.now() }).run();
    }

    expect(t.db.select().from(tags).all()).toHaveLength(6);
  });

  it('is unique per project, not per org', () => {
    const other = createProject(t.sqlite, t.db, actor(adminId), {
      name: 'Web',
      slug: 'web',
      prefix: 'WEB',
    }).id;

    for (const id of [projectId, other]) {
      t.db.insert(tags).values({ id: newId(), projectId: id, name: 'ui', createdAt: 1 }).run();
    }

    // Two `ui` tags, one per project — §4.16 is explicit that they are different
    // concerns.
    expect(t.db.select().from(tags).where(eq(tags.name, 'ui')).all()).toHaveLength(2);

    expectSqliteError(
      () => t.db.insert(tags).values({ id: newId(), projectId, name: 'ui', createdAt: 1 }).run(),
      /UNIQUE constraint failed/,
    );
  });
});

describe('normalising a name', () => {
  it('lowercases and trims rather than erroring on a paste', () => {
    expect(normaliseTagName('  UI  ')).toBe('ui');
  });

  it('refuses rather than guessing at a space', () => {
    // Rewriting `two words` to `two-words` invents a name the caller did not
    // type, which is worse than telling them.
    expectApiError(() => normaliseTagName('two words'), 'unprocessable');
  });

  it('rejects a list that collapses to a duplicate', () => {
    // `['UI', 'ui']` silently collapsing means the caller's list and the stored
    // list differ in length with no error — "the tag I added vanished".
    expectApiError(() => normaliseTagNames(['UI', 'ui']), 'unprocessable');
  });

  it('caps how many one task may carry', () => {
    const many = Array.from({ length: MAX_TAGS_PER_TASK + 1 }, (_, i) => `t${String(i)}`);
    expectApiError(() => normaliseTagNames(many), 'unprocessable');
  });
});

describe('applying tags to a task', () => {
  it('creates a tag by applying it — there is no create step', () => {
    const task = newTask('Tagged', { tags: ['core', 'agent'] });

    expect(task.tags).toEqual(['agent', 'core']);
    expect(t.db.select().from(tags).all()).toHaveLength(2);
  });

  it('sorts them, so a card renders the same order every read', () => {
    expect(newTask('Sorted', { tags: ['ui', 'agent', 'core'] }).tags).toEqual([
      'agent',
      'core',
      'ui',
    ]);
  });

  it('reuses an existing tag rather than creating a second', () => {
    newTask('First', { tags: ['core'] });
    newTask('Second', { tags: ['core'] });

    expect(t.db.select().from(tags).all()).toHaveLength(1);
  });

  it('replaces the whole set on update, so a tag can be removed', () => {
    const task = newTask('Changing', { tags: ['core', 'ui'] });

    expect(updateTask(t.db, actor(adminId), task.id, { tags: ['core'] }).tags).toEqual(['core']);
    expect(updateTask(t.db, actor(adminId), task.id, { tags: [] }).tags).toEqual([]);
  });

  it('leaves tags alone when an update does not mention them', () => {
    const task = newTask('Untouched', { tags: ['core'] });

    expect(updateTask(t.db, actor(adminId), task.id, { title: 'Renamed' }).tags).toEqual(['core']);
  });

  it('records task.updated naming the field, and adds no §4.8 verb', () => {
    const task = newTask('Audited');
    updateTask(t.db, actor(adminId), task.id, { tags: ['core'] });

    const rows = t.db
      .select()
      .from(activity)
      .where(eq(activity.taskId, task.id))
      .all()
      .filter((row) => row.type === 'task.updated');

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.payloadJson ?? '{}')).toEqual({
      field: 'tags',
      from: [],
      to: ['core'],
    });

    const types = new Set(
      t.db
        .select()
        .from(activity)
        .where(eq(activity.taskId, task.id))
        .all()
        .map((r) => r.type),
    );
    expect([...types].some((type) => type.startsWith('tag.'))).toBe(false);
  });

  it('writes no activity row when the set did not change', () => {
    const task = newTask('Same', { tags: ['core'] });
    updateTask(t.db, actor(adminId), task.id, { tags: ['core'] });

    const updates = t.db
      .select()
      .from(activity)
      .where(eq(activity.taskId, task.id))
      .all()
      .filter((row) => row.type === 'task.updated');

    expect(updates).toHaveLength(0);
  });

  it('is a member’s to do — applying is `task.write` (§3.2)', () => {
    const task = newTask('Members may tag');
    expect(updateTask(t.db, actor(memberId), task.id, { tags: ['core'] }).tags).toEqual(['core']);
  });
});

describe('tagsForTasks', () => {
  it('reads a whole page in one query', () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => newTask(`t${String(i)}`, { tags: ['core'] }).id,
    );

    const prepared: string[] = [];
    const real = t.sqlite.prepare.bind(t.sqlite);
    (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      prepared.push(source);
      return real(source);
    };

    try {
      expect(tagsForTasks(t.db, ids).size).toBe(12);
    } finally {
      (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
    }

    expect(prepared.filter((sql) => sql.includes('task_tags'))).toHaveLength(1);
  });

  it('gives every requested id an entry, so empty never looks like missing', () => {
    const task = newTask('Bare');
    expect(tagsForTasks(t.db, [task.id]).get(task.id)).toEqual([]);
  });

  it('renders a whole task page with one tag query, not one per card', () => {
    // Asserted through `listTasks`, not through `tagsForTasks`. Instrumenting
    // the function only proves the function; the mistake would be made in
    // `loadViewContext`, where a per-row call looks perfectly reasonable — and a
    // function-level test stays green through it. Same gap I found in LAI-053.
    const ids = Array.from(
      { length: 15 },
      (_, i) => newTask(`p${String(i)}`, { tags: ['core'] }).id,
    );

    const prepared: string[] = [];
    const real = t.sqlite.prepare.bind(t.sqlite);
    (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      prepared.push(source);
      return real(source);
    };

    let page: ReturnType<typeof listTasks> = [];
    try {
      page = listTasks(t.db, actor(adminId), 'laika', LIST);
    } finally {
      (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
    }

    expect(page).toHaveLength(ids.length);
    // Not passing on an empty graph: every card really carries a tag.
    expect(page.every((task) => task.tags.length === 1)).toBe(true);
    expect(prepared.filter((sql) => sql.includes('task_tags'))).toHaveLength(1);
  });
});

describe('listing a project’s tags with usage counts', () => {
  it('counts the tasks carrying each', () => {
    newTask('One', { tags: ['core', 'ui'] });
    newTask('Two', { tags: ['core'] });

    expect(listProjectTags(t.db, actor(adminId), 'laika')).toEqual([
      { name: 'core', task_count: 2 },
      { name: 'ui', task_count: 1 },
    ]);
  });

  it('keeps a tag nothing carries any more, with a count of zero', () => {
    // It still occupies its name, so a picker that hid it would offer a name the
    // unique index then refuses.
    //
    // Emptied by removing the label rather than deleting the task: a task row
    // cannot be hard-deleted at all while it has activity, because
    // `activity.task_id`'s `ON DELETE set null` is an UPDATE and §4.8's
    // append-only trigger refuses it. Nothing in Laika deletes tasks — §5
    // cancels them — so that is latent rather than broken, and it is LAI-135.
    const task = newTask('Only', { tags: ['orphan'] });
    updateTask(t.db, actor(adminId), task.id, { tags: [] });

    expect(listProjectTags(t.db, actor(adminId), 'laika')).toEqual([
      { name: 'orphan', task_count: 0 },
    ]);
  });
});

describe('renaming and deleting, which are lead-only (§3.2)', () => {
  it('refuses a member — that is `project.settings.edit`', () => {
    newTask('Tagged', { tags: ['core'] });

    expectApiError(
      () => renameTag(t.sqlite, t.db, actor(memberId), 'laika', 'core', 'kernel'),
      'forbidden',
    );
    expectApiError(() => deleteTag(t.sqlite, t.db, actor(memberId), 'laika', 'core'), 'forbidden');
  });

  it('renames project-wide without touching any task', () => {
    const task = newTask('Tagged', { tags: ['core'] });

    expect(renameTag(t.sqlite, t.db, actor(adminId), 'laika', 'core', 'kernel')).toEqual({
      name: 'kernel',
      task_count: 1,
    });
    expect(getTask(t.db, actor(adminId), task.id).tags).toEqual(['kernel']);
  });

  it('merges into an existing name rather than refusing', () => {
    // Two names for one concept is usually what a rename is fixing; "that name
    // is taken" would leave a lead to delete and re-apply across every task.
    const both = newTask('Both', { tags: ['core', 'kernel'] });
    const one = newTask('One', { tags: ['core'] });

    expect(renameTag(t.sqlite, t.db, actor(adminId), 'laika', 'core', 'kernel').name).toBe(
      'kernel',
    );

    expect(getTask(t.db, actor(adminId), both.id).tags).toEqual(['kernel']);
    expect(getTask(t.db, actor(adminId), one.id).tags).toEqual(['kernel']);
    expect(listProjectTags(t.db, actor(adminId), 'laika')).toEqual([
      { name: 'kernel', task_count: 2 },
    ]);
  });

  it('deletes the tag and never the tasks (AC9)', () => {
    const first = newTask('First', { tags: ['core'] });
    const second = newTask('Second', { tags: ['core', 'ui'] });

    expect(deleteTag(t.sqlite, t.db, actor(adminId), 'laika', 'core')).toEqual({ released: 2 });

    // Exactly as deleting a sprint releases its tasks rather than destroying
    // them (§4.15).
    expect(t.db.select().from(tasks).all()).toHaveLength(2);
    expect(getTask(t.db, actor(adminId), first.id).tags).toEqual([]);
    expect(getTask(t.db, actor(adminId), second.id).tags).toEqual(['ui']);
  });

  it('answers not_found for a tag this project does not have', () => {
    expectApiError(() => deleteTag(t.sqlite, t.db, actor(adminId), 'laika', 'nope'), 'not_found');
  });
});

describe('the ?tag= filter', () => {
  it('returns only tasks carrying it', () => {
    const tagged = newTask('Tagged', { tags: ['core'] });
    newTask('Untagged');
    newTask('Other', { tags: ['ui'] });

    const rows = listTasks(t.db, actor(adminId), 'laika', { ...LIST, tag: 'core' });

    expect(rows.map((row) => row.id)).toEqual([tagged.id]);
  });

  it('normalises the query, so ?tag=CORE finds `core`', () => {
    const tagged = newTask('Tagged', { tags: ['core'] });

    expect(
      listTasks(t.db, actor(adminId), 'laika', { ...LIST, tag: 'CORE' }).map((r) => r.id),
    ).toEqual([tagged.id]);
  });

  it('returns nothing for a tag nobody has used, rather than erroring', () => {
    newTask('Tagged', { tags: ['core'] });

    // Filtering by a tag that does not exist yet is a reasonable thing to do,
    // and "no such tag" would make the UI handle a case meaning "no matches".
    expect(listTasks(t.db, actor(adminId), 'laika', { ...LIST, tag: 'nope' })).toEqual([]);
  });

  it('combines with the other filters rather than replacing them', () => {
    newTask('Backlog', { tags: ['core'] });
    const todo = newTask('Todo', { tags: ['core'], status: 'todo' });

    expect(
      listTasks(t.db, actor(adminId), 'laika', { ...LIST, tag: 'core', status: 'todo' }).map(
        (r) => r.id,
      ),
    ).toEqual([todo.id]);
  });
});
