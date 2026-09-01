import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { eq } from 'drizzle-orm';
import { activity, orgs, tasks, tokens, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import {
  addTaskDependency,
  changeStatus,
  claimTask,
  createTask,
  getTask,
  listTasks,
  removeTaskDependency,
  updateTask,
} from '../../src/services/tasks.ts';
import { addComment, deleteComment } from '../../src/services/comments.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let adminId: string;

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

function newTask(title = 'Do the thing', extra: Record<string, unknown> = {}) {
  return createTask(t.sqlite, t.db, actor(adminId), 'laika', { title, ...extra });
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

describe('createTask and the display key (AC1, AC9)', () => {
  it('numbers per project and builds the LAI-n key', () => {
    expect(newTask('first').key).toBe('LAI-1');
    expect(newTask('second').key).toBe('LAI-2');
  });

  it('defaults to backlog and p2', () => {
    const task = newTask();
    expect(task.status).toBe('backlog');
    expect(task.priority).toBe('p2');
  });

  it('writes exactly one task.created row', () => {
    newTask();
    const types = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types.filter((x) => x === 'task.created')).toHaveLength(1);
  });

  it('refuses a viewer', () => {
    const viewerId = makeUser('viewer');
    expect(() => createTask(t.sqlite, t.db, actor(viewerId), 'laika', { title: 'nope' })).toThrow(
      ApiError,
    );
  });
});

describe('readiness is derived (AC7)', () => {
  it('is true for an unassigned backlog or todo task with no dependencies', () => {
    expect(newTask('a').ready).toBe(true);
    expect(newTask('b', { status: 'todo' }).ready).toBe(true);
  });

  it('is false once assigned, and false while a dependency is unfinished', () => {
    expect(newTask('c', { assignee_id: adminId }).ready).toBe(false);

    const blocker = newTask('blocker');
    const blocked = newTask('blocked');
    addTaskDependency(t.sqlite, t.db, actor(adminId), blocked.id, blocker.id);

    expect(getTask(t.db, actor(adminId), blocked.id).ready).toBe(false);

    changeStatus(t.db, actor(adminId), blocker.id, 'in_progress');
    changeStatus(t.db, actor(adminId), blocker.id, 'review');
    changeStatus(t.db, actor(adminId), blocker.id, 'done');

    expect(getTask(t.db, actor(adminId), blocked.id).ready).toBe(true);
  });

  it('filters by ready in both directions', () => {
    newTask('open');
    newTask('taken', { assignee_id: adminId });

    const ready = listTasks(t.db, actor(adminId), 'laika', { ...LIST, ready: true });
    const notReady = listTasks(t.db, actor(adminId), 'laika', { ...LIST, ready: false });

    expect(ready.map((x) => x.title)).toEqual(['open']);
    expect(notReady.map((x) => x.title)).toEqual(['taken']);
  });
});

describe('discovered_from is provenance, not a blocker (AC6)', () => {
  it('lets a discovered task be worked while its parent is open', () => {
    const parent = newTask('parent');
    const child = newTask('discovered while doing parent', { discovered_from: parent.id });

    expect(child.discovered_from).toBe(parent.id);
    // The parent is still `backlog`, and the child is ready anyway.
    expect(getTask(t.db, actor(adminId), parent.id).status).toBe('backlog');
    expect(child.ready).toBe(true);
    expect(child.blocked_by).toEqual([]);
  });
});

describe('claim is a compare-and-swap (AC3)', () => {
  it('assigns and moves to in_progress', () => {
    const task = newTask();
    const claimed = claimTask(t.sqlite, t.db, actor(adminId), task.id);

    expect(claimed.assignee_id).toBe(adminId);
    expect(claimed.status).toBe('in_progress');
  });

  it('tells a second claimant who holds it', () => {
    const task = newTask();
    const otherId = makeUser('admin');
    claimTask(t.sqlite, t.db, actor(adminId), task.id);

    try {
      claimTask(t.sqlite, t.db, actor(otherId), task.id);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
      // "conflict" alone does not tell an agent what to do next.
      expect((err as ApiError).details).toMatchObject({
        assignee_id: adminId,
        status: 'in_progress',
      });
    }
  });

  it('lets exactly one of many simultaneous claimants win', () => {
    const task = newTask();
    const claimants = Array.from({ length: 6 }, () => makeUser('admin'));

    const outcomes = claimants.map((id) => {
      try {
        claimTask(t.sqlite, t.db, actor(id), task.id);
        return 'won';
      } catch (err) {
        return err instanceof ApiError && err.code === 'conflict' ? 'conflict' : 'unexpected';
      }
    });

    expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(5);
  });
});

describe('status transitions (AC4)', () => {
  it('follows the §5 path and records each move once', () => {
    const task = newTask();

    changeStatus(t.db, actor(adminId), task.id, 'todo');
    changeStatus(t.db, actor(adminId), task.id, 'in_progress');
    changeStatus(t.db, actor(adminId), task.id, 'review');
    const done = changeStatus(t.db, actor(adminId), task.id, 'done');

    expect(done.status).toBe('done');

    const changes = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'task.status_changed');
    expect(changes).toHaveLength(4);
  });

  it('refuses an illegal jump', () => {
    const task = newTask();
    expect(() => changeStatus(t.db, actor(adminId), task.id, 'done')).toThrow(ApiError);
  });

  it('refuses a no-op transition', () => {
    const task = newTask();
    expect(() => changeStatus(t.db, actor(adminId), task.id, 'backlog')).toThrow(ApiError);
  });

  it('stamps completed_at only on done', () => {
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'in_progress');
    changeStatus(t.db, actor(adminId), task.id, 'review');
    changeStatus(t.db, actor(adminId), task.id, 'done');

    const row = t.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
    expect(row?.completedAt).not.toBeNull();
  });
});

describe('sending to review needs the assignee, a lead, or an admin (§5)', () => {
  /** An org member who belongs to the project — no implicit lead. */
  function projectMember(role: 'member' | 'lead' = 'member'): string {
    const id = makeUser('member');
    addMember(t.db, actor(adminId), 'laika', id, role);
    return id;
  }

  it('allows the assignee', () => {
    const memberId = projectMember();
    const task = newTask('theirs');

    updateTask(t.db, actor(adminId), task.id, { assignee_id: memberId });
    changeStatus(t.db, actor(memberId), task.id, 'in_progress');

    expect(changeStatus(t.db, actor(memberId), task.id, 'review').status).toBe('review');
  });

  it('allows a project lead who is not the assignee', () => {
    // The task text said "assignee, Admin or Owner" and omitted lead; §5 includes
    // it, and the spec wins (D-011).
    const assigneeId = projectMember();
    const leadId = projectMember('lead');
    const task = newTask('theirs');

    updateTask(t.db, actor(adminId), task.id, { assignee_id: assigneeId });
    changeStatus(t.db, actor(adminId), task.id, 'in_progress');

    expect(changeStatus(t.db, actor(leadId), task.id, 'review').status).toBe('review');
  });

  it('refuses a plain member who is not the assignee', () => {
    const assigneeId = projectMember();
    const bystanderId = projectMember();
    const task = newTask('theirs');

    updateTask(t.db, actor(adminId), task.id, { assignee_id: assigneeId });
    changeStatus(t.db, actor(adminId), task.id, 'in_progress');

    expect(() => changeStatus(t.db, actor(bystanderId), task.id, 'review')).toThrow(
      /Only the assignee/,
    );
  });
});

describe('dependencies (AC5)', () => {
  it('adds and removes, each with its own verb', () => {
    const a = newTask('a');
    const b = newTask('b');

    addTaskDependency(t.sqlite, t.db, actor(adminId), a.id, b.id);
    expect(getTask(t.db, actor(adminId), a.id).blocked_by).toEqual([b.id]);

    removeTaskDependency(t.db, actor(adminId), a.id, b.id);
    expect(getTask(t.db, actor(adminId), a.id).blocked_by).toEqual([]);

    const types = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types).toContain('task.dependency_added');
    expect(types).toContain('task.dependency_removed');
  });

  it('rejects a self-link and a cycle as unprocessable', () => {
    const a = newTask('a');
    const b = newTask('b');

    expect(() => addTaskDependency(t.sqlite, t.db, actor(adminId), a.id, a.id)).toThrow(ApiError);

    addTaskDependency(t.sqlite, t.db, actor(adminId), a.id, b.id);
    try {
      addTaskDependency(t.sqlite, t.db, actor(adminId), b.id, a.id);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('unprocessable');
      expect((err as ApiError).details).toMatchObject({ reason: 'cycle' });
    }
  });

  it('rejects a duplicate as conflict', () => {
    const a = newTask('a');
    const b = newTask('b');
    addTaskDependency(t.sqlite, t.db, actor(adminId), a.id, b.id);

    try {
      addTaskDependency(t.sqlite, t.db, actor(adminId), a.id, b.id);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
    }
  });

  it('404s a dependency on a task that does not exist', () => {
    const a = newTask('a');
    expect(() => addTaskDependency(t.sqlite, t.db, actor(adminId), a.id, newId())).toThrow(
      /No task with id/,
    );
  });

  it('404s removing a link that was never there', () => {
    const a = newTask('a');
    const b = newTask('b');
    expect(() => removeTaskDependency(t.db, actor(adminId), a.id, b.id)).toThrow(/does not exist/);
  });
});

describe('updateTask (AC2)', () => {
  it('edits fields and writes task.updated', () => {
    const task = newTask();
    const updated = updateTask(t.db, actor(adminId), task.id, { title: 'Renamed', priority: 'p1' });

    expect(updated.title).toBe('Renamed');
    expect(updated.priority).toBe('p1');
    expect(
      t.db
        .select()
        .from(activity)
        .all()
        .map((r) => r.type),
    ).toContain('task.updated');
  });

  it('records a reassignment as task.assigned, not a status change (§5)', () => {
    const memberId = makeUser('member');
    const task = newTask();

    updateTask(t.db, actor(adminId), task.id, { assignee_id: memberId });

    const types = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types).toContain('task.assigned');
    expect(types).not.toContain('task.status_changed');
  });

  it('unassigns with an explicit null', () => {
    const task = newTask('x', { assignee_id: adminId });
    const updated = updateTask(t.db, actor(adminId), task.id, { assignee_id: null });

    expect(updated.assignee_id).toBeNull();
  });

  it('writes no activity when nothing changed', () => {
    const task = newTask();
    const before = t.db.select().from(activity).all().length;

    updateTask(t.db, actor(adminId), task.id, {});

    expect(t.db.select().from(activity).all()).toHaveLength(before);
  });
});

describe('listing and filters (AC1)', () => {
  it('filters by status, priority and assignee', () => {
    newTask('a', { priority: 'p1' });
    newTask('b', { status: 'todo' });
    newTask('c', { assignee_id: adminId });

    expect(listTasks(t.db, actor(adminId), 'laika', { ...LIST, priority: 'p1' })).toHaveLength(1);
    expect(listTasks(t.db, actor(adminId), 'laika', { ...LIST, status: 'todo' })).toHaveLength(1);
    expect(listTasks(t.db, actor(adminId), 'laika', { ...LIST, assignee: adminId })).toHaveLength(
      1,
    );
    expect(listTasks(t.db, actor(adminId), 'laika', { ...LIST, assignee: 'none' })).toHaveLength(2);
  });

  it('refuses a non-member', () => {
    const outsider = makeUser('member');
    expect(() => listTasks(t.db, actor(outsider), 'laika', LIST)).toThrow(ApiError);
  });
});

/**
 * LAI-091 — both directions of §4.6, and the cost of rendering a page of them.
 */
describe('what a task blocks (SPEC §4.6, §4.13)', () => {
  /** a ← b ← c: c depends on b, b depends on a. */
  function chain(): [string, string, string] {
    const a = newTask('a').id;
    const b = newTask('b').id;
    const c = newTask('c').id;
    addTaskDependency(t.sqlite, t.db, actor(adminId), b, a);
    addTaskDependency(t.sqlite, t.db, actor(adminId), c, b);
    return [a, b, c];
  }

  /** Count the statements a call prepares, by instrumenting the driver. */
  function statementsDuring(run: () => void): string[] {
    const recorded: string[] = [];
    const real = t.sqlite.prepare.bind(t.sqlite);

    (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      recorded.push(source);
      return real(source);
    };

    try {
      run();
    } finally {
      (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
    }

    return recorded;
  }

  it('reports both directions separately on one view', () => {
    const [a, b, c] = chain();

    // The head of the chain blocks something and is blocked by nothing — the
    // exact case that used to render as no dependency information at all.
    expect(getTask(t.db, actor(adminId), a).blocked_by).toEqual([]);
    expect(getTask(t.db, actor(adminId), a).blocks).toEqual([b]);

    expect(getTask(t.db, actor(adminId), b).blocked_by).toEqual([a]);
    expect(getTask(t.db, actor(adminId), b).blocks).toEqual([c]);

    expect(getTask(t.db, actor(adminId), c).blocked_by).toEqual([b]);
    expect(getTask(t.db, actor(adminId), c).blocks).toEqual([]);
  });

  it('never merges them — they mean opposite things', () => {
    const [a, , c] = chain();
    const head = getTask(t.db, actor(adminId), a);
    const tail = getTask(t.db, actor(adminId), c);

    // Merged into one list, the head and the tail would look identical: each has
    // exactly one edge. The direction is the entire content.
    expect(head.blocked_by).toHaveLength(0);
    expect(head.blocks).toHaveLength(1);
    expect(tail.blocked_by).toHaveLength(1);
    expect(tail.blocks).toHaveLength(0);
  });

  it('leaves `ready` a function of what blocks you, never of what you block (AC4)', () => {
    const [a, b] = chain();

    // `a` blocks `b` and is blocked by nothing: still ready.
    const head = getTask(t.db, actor(adminId), a);
    expect(head.blocks).toHaveLength(1);
    expect(head.ready).toBe(true);

    // `b` is blocked by an unfinished `a`, and its own `blocks` has no bearing.
    expect(getTask(t.db, actor(adminId), b).ready).toBe(false);

    for (const status of ['todo', 'in_progress', 'review', 'done'] as const) {
      changeStatus(t.db, actor(adminId), a, status);
    }

    // Finishing `a` unblocks `b`. `a` is no longer ready because it is done —
    // not because of anything it blocks.
    expect(getTask(t.db, actor(adminId), b).ready).toBe(true);
    expect(getTask(t.db, actor(adminId), a).ready).toBe(false);
  });

  it('renders a whole page with one dependency query, not one per row (AC2)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => newTask(`t${String(i)}`).id);
    for (let i = 1; i < ids.length; i += 1) {
      addTaskDependency(t.sqlite, t.db, actor(adminId), ids[i]!, ids[i - 1]!);
    }

    let page: ReturnType<typeof listTasks> = [];
    const statements = statementsDuring(() => {
      page = listTasks(t.db, actor(adminId), 'laika', LIST);
    });

    expect(page).toHaveLength(20);
    // Every row carries real edges, so this is not passing on an empty graph.
    expect(page.every((task) => task.blocks.length + task.blocked_by.length > 0)).toBe(true);

    const dependencyQueries = statements.filter((sql) => sql.includes('task_dependencies'));

    // One, whatever the page size. Before LAI-091 this was one per row.
    expect(dependencyQueries).toHaveLength(1);
    expect(dependencyQueries[0]).toContain('UNION ALL');
  });

  it('costs the same for twenty tasks as for four', () => {
    // The property behind the number above, and the one that actually matters:
    // the cost must not move with the page. Pinning a total would break on any
    // legitimate extra query; this only fails if something became per-row.
    const measure = (size: number): number => {
      const ids = Array.from({ length: size }, (_, i) => newTask(`m${String(i)}`).id);
      for (let i = 1; i < ids.length; i += 1) {
        addTaskDependency(t.sqlite, t.db, actor(adminId), ids[i]!, ids[i - 1]!);
      }

      return statementsDuring(() => {
        listTasks(t.db, actor(adminId), 'laika', { ...LIST, limit: 200 });
      }).length;
    };

    const small = measure(4);
    const large = measure(20);

    expect(large).toBe(small);
  });
});

/**
 * LAI-072 — the count every card in the design shows, and what it costs.
 */
describe('comment count on a task view (SPEC §4.7)', () => {
  /** Same driver instrumentation the dependency tests use. */
  function statementsDuring(run: () => void): string[] {
    const recorded: string[] = [];
    const real = t.sqlite.prepare.bind(t.sqlite);

    (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      recorded.push(source);
      return real(source);
    };

    try {
      run();
    } finally {
      (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
    }

    return recorded;
  }

  it('is zero for a task nobody has commented on', () => {
    expect(newTask('Quiet').comment_count).toBe(0);
  });

  it('counts live comments and drops soft-deleted ones', () => {
    const task = newTask('Chatty');

    addComment(t.db, actor(adminId), task.id, 'one');
    const doomed = addComment(t.db, actor(adminId), task.id, 'two');

    expect(getTask(t.db, actor(adminId), task.id).comment_count).toBe(2);

    deleteComment(t.db, actor(adminId), doomed.id);

    // The card must agree with the thread it opens onto.
    expect(getTask(t.db, actor(adminId), task.id).comment_count).toBe(1);
  });

  it('counts a whole page in one query, not one per card (AC3)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => newTask(`c${String(i)}`).id);
    for (const id of ids) addComment(t.db, actor(adminId), id, 'hello');

    let page: ReturnType<typeof listTasks> = [];
    const statements = statementsDuring(() => {
      page = listTasks(t.db, actor(adminId), 'laika', LIST);
    });

    expect(page).toHaveLength(20);
    // Not passing on an empty set: every card really has a comment.
    expect(page.every((task) => task.comment_count === 1)).toBe(true);

    const commentQueries = statements.filter((sql) => sql.includes('comments'));
    expect(commentQueries).toHaveLength(1);
  });

  it('does not make the page cost grow with the page', () => {
    const measure = (size: number): number => {
      const ids = Array.from({ length: size }, (_, i) => newTask(`n${String(i)}`).id);
      for (const id of ids) addComment(t.db, actor(adminId), id, 'x');

      return statementsDuring(() => {
        listTasks(t.db, actor(adminId), 'laika', { ...LIST, limit: 200 });
      }).length;
    };

    expect(measure(20)).toBe(measure(4));
  });
});

/**
 * LAI-092. "What does done mean here" as a field an agent can read, rather than
 * prose buried in a description where it stops being checkable.
 */
describe('acceptance criteria (SPEC §4.5)', () => {
  it('is null when nobody specified any, not an empty string', () => {
    // The two are different claims: `null` says nobody said, `''` says somebody
    // said there is none.
    expect(newTask('No acceptance').acceptance_md).toBeNull();
  });

  it('is stored and returned when given at creation', () => {
    const task = newTask('With acceptance', {
      acceptance_md: 'Second claim returns 409 and an audit row is written.',
    });

    expect(task.acceptance_md).toBe('Second claim returns 409 and an audit row is written.');
    expect(getTask(t.db, actor(adminId), task.id).acceptance_md).toBe(task.acceptance_md);
  });

  it('can be set, changed and cleared afterwards', () => {
    const task = newTask('Later');

    expect(
      updateTask(t.db, actor(adminId), task.id, { acceptance_md: 'first' }).acceptance_md,
    ).toBe('first');
    expect(
      updateTask(t.db, actor(adminId), task.id, { acceptance_md: 'second' }).acceptance_md,
    ).toBe('second');

    // `null` clears it; absent leaves it alone. Different requests.
    expect(
      updateTask(t.db, actor(adminId), task.id, { acceptance_md: null }).acceptance_md,
    ).toBeNull();
  });

  it('is left alone by an update that does not mention it', () => {
    const task = newTask('Untouched', { acceptance_md: 'keep me' });

    const after = updateTask(t.db, actor(adminId), task.id, { title: 'Renamed' });

    expect(after.title).toBe('Renamed');
    expect(after.acceptance_md).toBe('keep me');
  });

  it('records the change as task.updated with the field named, and adds no verb', () => {
    // AC5: §4.8's vocabulary has been extended enough (LAI-110). This must ride
    // on the existing verb.
    const task = newTask('Audited');
    updateTask(t.db, actor(adminId), task.id, { acceptance_md: 'done means this' });

    const rows = t.db
      .select()
      .from(activity)
      .where(eq(activity.taskId, task.id))
      .all()
      .filter((row) => row.type === 'task.updated');

    expect(rows).toHaveLength(1);
    // `acceptance_md`, not `acceptanceMd` — LAI-045 made the audit trail speak
    // the same names as the API. This assertion pinned the old spelling.
    expect(JSON.parse(rows[0]?.payloadJson ?? '{}')).toMatchObject({
      changed: ['acceptance_md'],
    });

    // And nothing invented a new type.
    const types = new Set(
      t.db
        .select()
        .from(activity)
        .where(eq(activity.taskId, task.id))
        .all()
        .map((r) => r.type),
    );
    expect([...types].some((type) => type.startsWith('acceptance.'))).toBe(false);
  });

  it('does not live inside the description', () => {
    // The Notes are explicit: a heading parsed out of markdown is a format
    // nobody can validate and every client re-implements.
    const task = newTask('Separate', {
      description_md: 'Why this matters.',
      acceptance_md: 'What done looks like.',
    });

    expect(task.description_md).toBe('Why this matters.');
    expect(task.acceptance_md).toBe('What done looks like.');
    expect(task.description_md).not.toContain('What done looks like.');
  });
});

describe('created_by_client — which agent, not just which channel (LAI-093)', () => {
  /**
   * §4.5's `created_via` is a closed enum, so the most a reader could see was
   * `created via api` — a token-created task and a curl were indistinguishable.
   * The name is **derived** from the `task.created` row's `actor_token_id`, so
   * there is no second copy to drift from `tokens.name`.
   */

  function tokenFor(userId: string, name: string): string {
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId,
        name,
        prefix: 'lai_test',
        tokenHash: `${id}-hash`,
        scope: 'full',
        projectIdsJson: null,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: Date.now(),
      })
      .run();
    return id;
  }

  /** The same person, acting through a named token. */
  function asAgent(userId: string, tokenName: string): ResolvedActor {
    return {
      ...actor(userId),
      token: { id: tokenFor(userId, tokenName), scope: 'full', projectIds: null },
    };
  }

  it('names the client that created it', () => {
    const created = createTask(t.sqlite, t.db, asAgent(adminId, 'mira-cli'), 'laika', {
      title: 'By an agent',
    });

    expect(created.created_by_client).toBe('mira-cli');
    expect(getTask(t.db, actor(adminId), created.id).created_by_client).toBe('mira-cli');
  });

  it('is null for a browser session, not "unknown"', () => {
    // The channel is known and the client is not. Inventing a name would be
    // worse than saying nothing, and a blank string would render as a gap.
    const created = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'By a person' });

    expect(created.created_by_client).toBeNull();
  });

  it('is null for a task created before the token existed', () => {
    // Old rows. `activity` is append-only, so a task created before tokens
    // simply has no `actor_token_id` — the same answer as a browser session,
    // which is why both render as `created via …` alone.
    const created = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Historic' });
    tokenFor(adminId, 'later-token');

    expect(getTask(t.db, actor(adminId), created.id).created_by_client).toBeNull();
  });

  it('survives the token being deleted, without inventing a name', () => {
    // `activity.actor_token_id` is ON DELETE set null, so the audit row outlives
    // the token and the name goes. A stored copy would still be claiming a
    // client that no longer exists.
    const agent = asAgent(adminId, 'doomed-cli');
    const created = createTask(t.sqlite, t.db, agent, 'laika', { title: 'Orphaned' });

    expect(created.created_by_client).toBe('doomed-cli');

    t.db
      .delete(tokens)
      .where(eq(tokens.id, agent.token?.id ?? ''))
      .run();

    expect(getTask(t.db, actor(adminId), created.id).created_by_client).toBeNull();
  });

  it('follows a rename rather than keeping the old name', () => {
    // The reason this is a join. A copy on `tasks` would still say `mira-cli`
    // after the token was renamed, and nothing would ever reconcile them.
    const agent = asAgent(adminId, 'old-name');
    const created = createTask(t.sqlite, t.db, agent, 'laika', { title: 'Renamed client' });

    t.db
      .update(tokens)
      .set({ name: 'new-name' })
      .where(eq(tokens.id, agent.token?.id ?? ''))
      .run();

    expect(getTask(t.db, actor(adminId), created.id).created_by_client).toBe('new-name');
  });

  it('names each task’s own client in a list', () => {
    // Batched, so this is also the assertion that the join keys per task rather
    // than smearing one name across the page.
    createTask(t.sqlite, t.db, asAgent(adminId, 'agent-one'), 'laika', { title: 'One' });
    createTask(t.sqlite, t.db, asAgent(adminId, 'agent-two'), 'laika', { title: 'Two' });
    createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Three' });

    const listed = listTasks(t.db, actor(adminId), 'laika', {
      limit: 50,
      cursor: null,
      updatedSince: null,
    });

    const byTitle = new Map(listed.map((task) => [task.title, task.created_by_client]));
    expect(byTitle.get('One')).toBe('agent-one');
    expect(byTitle.get('Two')).toBe('agent-two');
    expect(byTitle.get('Three')).toBeNull();
  });
});

/**
 * When work actually began and ended (§4.5, LAI-126).
 *
 * The columns have existed since 0000 and nothing serialised them, so no client
 * could tell when a task started — only when its row was last written.
 */
describe('started_at and completed_at', () => {
  function newTask(title = 'A task') {
    return createTask(t.sqlite, t.db, actor(adminId), 'laika', { title });
  }

  it('is null on a task nothing has happened to', () => {
    const task = newTask();

    expect(task.started_at).toBeNull();
    expect(task.completed_at).toBeNull();
  });

  it('reports both after todo → in_progress → done', () => {
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    const started = changeStatus(t.db, actor(adminId), task.id, 'in_progress');
    changeStatus(t.db, actor(adminId), task.id, 'review');
    const done = changeStatus(t.db, actor(adminId), task.id, 'done');

    // `claimTask` already stamped `started_at`; a lead moving somebody else's
    // task is the other way into `in_progress`, and before LAI-126 that route
    // left it null while the task was genuinely under way.
    expect(started.started_at).not.toBeNull();
    expect(done.started_at).toBe(started.started_at);
    expect(done.completed_at).not.toBeNull();
    expect(done.completed_at!).toBeGreaterThanOrEqual(done.started_at!);
  });

  it('keeps the first start when a task comes back for rework', () => {
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    const first = changeStatus(t.db, actor(adminId), task.id, 'in_progress', 1_000);
    changeStatus(t.db, actor(adminId), task.id, 'review', 2_000);
    const again = changeStatus(t.db, actor(adminId), task.id, 'in_progress', 3_000);

    // A task sent back and picked up again did not start twice. Overwriting
    // would silently shorten every cycle time computed from it (LAI-124).
    expect(first.started_at).toBe(1_000);
    expect(again.started_at).toBe(1_000);
  });

  it('still stamps a start when the task is claimed rather than moved', () => {
    const memberId = makeUser('member');
    addMember(t.db, actor(adminId), 'laika', memberId, 'member');
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'todo');

    const claimed = claimTask(t.sqlite, t.db, actor(memberId), task.id);

    expect(claimed.started_at).not.toBeNull();
  });

  it('serialises them on the wire shape, not only in the row', () => {
    // §6.4's task shape, named in full. A new field reaching clients without a
    // spec line is how `dependencies` came to need a footnote — this turns any
    // addition into a deliberate act rather than a diff nobody reads.
    const task = newTask();

    expect(Object.keys(task).sort()).toEqual(
      [
        'acceptance_md',
        'assignee_id',
        'blocks',
        'comment_count',
        'completed_at',
        'created_at',
        'created_by',
        'created_by_client',
        'created_via',
        'blocked_by',
        'description_md',
        'discovered_from',
        'id',
        'key',
        'number',
        'priority',
        'project_id',
        'ready',
        'sprint_id',
        'stale_flagged_at',
        'started_at',
        'status',
        'tags',
        'title',
        'updated_at',
      ].sort(),
    );
  });
});

/**
 * `completed_at` across a reopen (§4.5, LAI-146).
 *
 * Filed from LAI-126 and stepped around by LAI-435's backfill, which
 * deliberately fills nothing on a task that is not `done` **now** so as not to
 * answer this by accident. This answers it.
 */
describe('completed_at when a task is reopened', () => {
  function newTask(title = 'A task') {
    return createTask(t.sqlite, t.db, actor(adminId), 'laika', { title });
  }

  function row(id: string) {
    return t.db.select().from(tasks).where(eq(tasks.id, id)).get();
  }

  it('keeps the latest completion, not the first', () => {
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    changeStatus(t.db, actor(adminId), task.id, 'in_progress', 1_000);
    changeStatus(t.db, actor(adminId), task.id, 'review', 2_000);
    changeStatus(t.db, actor(adminId), task.id, 'done', 3_000);
    expect(row(task.id)?.completedAt).toBe(3_000);

    changeStatus(t.db, actor(adminId), task.id, 'in_progress', 4_000);
    changeStatus(t.db, actor(adminId), task.id, 'review', 5_000);
    changeStatus(t.db, actor(adminId), task.id, 'done', 6_000);

    // A task done twice was completed the second time. A cycle time that lost
    // the second completion would be wrong about the whole history, not the end.
    expect(row(task.id)?.completedAt).toBe(6_000);
  });

  it('does not clear it while the task is reopened', () => {
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    changeStatus(t.db, actor(adminId), task.id, 'in_progress', 1_000);
    changeStatus(t.db, actor(adminId), task.id, 'review', 2_000);
    changeStatus(t.db, actor(adminId), task.id, 'done', 3_000);
    changeStatus(t.db, actor(adminId), task.id, 'in_progress', 4_000);

    // **The consequence, pinned rather than left to surprise somebody.** The
    // timestamp is a fact about the task's history; `status` is the claim about
    // its state, and nothing else should be read as one.
    expect(row(task.id)?.completedAt).toBe(3_000);
    expect(row(task.id)?.status).toBe('in_progress');
  });

  it('keeps started_at at its first value across the same journey', () => {
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    changeStatus(t.db, actor(adminId), task.id, 'in_progress', 1_000);
    changeStatus(t.db, actor(adminId), task.id, 'review', 2_000);
    changeStatus(t.db, actor(adminId), task.id, 'done', 3_000);
    changeStatus(t.db, actor(adminId), task.id, 'in_progress', 4_000);
    changeStatus(t.db, actor(adminId), task.id, 'review', 5_000);
    changeStatus(t.db, actor(adminId), task.id, 'done', 6_000);

    // **The asymmetry, asserted beside its opposite.** First for `started_at`,
    // latest for `completed_at` — the pair is what makes each one legible, and
    // testing either alone leaves the other looking arbitrary.
    expect(row(task.id)?.startedAt).toBe(1_000);
    expect(row(task.id)?.completedAt).toBe(6_000);
  });

  it('serialises both on the wire', () => {
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    changeStatus(t.db, actor(adminId), task.id, 'in_progress', 1_000);
    changeStatus(t.db, actor(adminId), task.id, 'review', 2_000);
    const done = changeStatus(t.db, actor(adminId), task.id, 'done', 3_000);
    const reopened = changeStatus(t.db, actor(adminId), task.id, 'in_progress', 4_000);

    expect(done.completed_at).toBe(3_000);
    expect(reopened.completed_at).toBe(3_000);
    expect(reopened.status).toBe('in_progress');
  });
});
