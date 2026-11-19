import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, handoffOffers, taskClaims, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { addComment } from '../../src/services/comments.ts';
import { addMember, projectSummaries } from '../../src/services/projects.ts';
import {
  addTaskDependency,
  changeStatus,
  createTask,
  getTask,
  listTasks,
  setTaskArchived,
  setTaskDeleted,
  startWorking,
  updateTask,
} from '../../src/services/tasks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * The space's Trash (LAI-1354): a soft delete on the archive's shelf
 * mechanism — out of every list, read-only to people, absent to tokens,
 * restorable with its subtasks. The route is
 * `test/http/routes/task-trash.test.ts`'s.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
const T0 = 1_800_000_000_000;
const LIST = { limit: 50, cursor: null, updatedSince: null };

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, T0);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function task(title = 'Work', extra: Record<string, unknown> = {}, by: ResolvedActor = owner) {
  return createTask(t.sqlite, t.db, by, 'laika', { title, now: T0, ...extra });
}

function person(role: 'member' | 'viewer' = 'member'): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Mira',
      orgRole: 'member',
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    })
    .run();
  addMember(t.db, owner, 'laika', id, role, T0);
  return loadActor(t.db, id)!;
}

let fixtureDevices = 0;

function agent() {
  const created = registerAgent(t.sqlite, t.db, owner, {
    displayName: 'Claude',
    harness: 'claude-code',
    deviceLabel: `device-${++fixtureDevices}`,
    grants: [{ projectId: s.projectId, scope: 'full' }],
  });
  return { id: created.agent.id, actor: resolveTokenActor(t.db, created.secret, T0) };
}

const ids = (views: readonly { id: string }[]) => views.map((v) => v.id).sort();

function refusal(fn: () => unknown): { code: string; reason: unknown } {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    return { code: api.code, reason: (api.details as { reason?: unknown } | undefined)?.reason };
  }
  throw new Error('expected a refusal, and nothing was thrown');
}

describe('setTaskDeleted', () => {
  it('moves a task out of every list into Trash, and back', () => {
    const kept = task('Kept');
    const gone = task('Deleted');

    expect(setTaskDeleted(t.db, owner, gone.id, true, T0 + 10)).toMatchObject({
      deleted_at: T0 + 10,
      deleted_by: s.userId,
      ready: false,
    });
    expect(ids(listTasks(t.db, owner, 'laika', LIST))).toEqual([kept.id]);
    expect(ids(listTasks(t.db, owner, 'laika', { ...LIST, trash: 'only' }))).toEqual([gone.id]);
    expect(projectSummaries(t.db, [s.projectId]).get(s.projectId)?.task_counts.backlog).toBe(1);
    // A catching-up read keeps it, for the route's tombstone.
    expect(ids(listTasks(t.db, owner, 'laika', { ...LIST, updatedSince: T0 + 5 }))).toEqual([
      gone.id,
    ]);

    expect(setTaskDeleted(t.db, owner, gone.id, false, T0 + 20)).toMatchObject({
      deleted_at: null,
      deleted_by: null,
    });
    expect(ids(listTasks(t.db, owner, 'laika', LIST))).toEqual(ids([kept, gone]));

    const verbs = t.db
      .select({ type: activity.type, at: activity.createdAt })
      .from(activity)
      .where(eq(activity.taskId, gone.id))
      .all()
      .filter((r) => r.type === 'task.deleted' || r.type === 'task.undeleted');
    expect(verbs).toEqual([
      { type: 'task.deleted', at: T0 + 10 },
      { type: 'task.undeleted', at: T0 + 20 },
    ]);
  });

  it('keeps the archive and Trash apart: an archived task deleted comes back archived', () => {
    const put = task('Archived first');
    setTaskArchived(t.db, owner, put.id, true, T0 + 5);
    setTaskDeleted(t.db, owner, put.id, true, T0 + 10);

    // The Archived view never shows what is in Trash.
    expect(listTasks(t.db, owner, 'laika', { ...LIST, archived: 'only' })).toEqual([]);
    // In Trash, it is neither archived nor restored from the archive.
    expect(refusal(() => setTaskArchived(t.db, owner, put.id, false, T0 + 11))).toEqual({
      code: 'conflict',
      reason: 'deleted',
    });

    setTaskDeleted(t.db, owner, put.id, false, T0 + 20);
    expect(getTask(t.db, owner, put.id)).toMatchObject({ archived_at: T0 + 5, deleted_at: null });
    expect(ids(listTasks(t.db, owner, 'laika', { ...LIST, archived: 'only' }))).toEqual([put.id]);
  });

  it('takes the subtasks with it, archived ones included, and brings back exactly those', () => {
    const parent = task('Parent');
    const child = task('Child', { parent_task_id: parent.id });
    const archivedChild = task('Archived child', { parent_task_id: parent.id });
    const earlier = task('Deleted before', { parent_task_id: parent.id });
    setTaskArchived(t.db, owner, archivedChild.id, true, T0 + 3);
    setTaskDeleted(t.db, owner, earlier.id, true, T0 + 5);

    setTaskDeleted(t.db, owner, parent.id, true, T0 + 10);
    for (const id of [child.id, archivedChild.id]) {
      expect(getTask(t.db, owner, id).deleted_at).toBe(T0 + 10);
    }
    expect(getTask(t.db, owner, earlier.id).deleted_at).toBe(T0 + 5);
    expect(refusal(() => setTaskDeleted(t.db, owner, child.id, false, T0 + 15))).toEqual({
      code: 'conflict',
      reason: 'parent_deleted',
    });

    setTaskDeleted(t.db, owner, parent.id, false, T0 + 20);
    expect(getTask(t.db, owner, child.id).deleted_at).toBeNull();
    expect(getTask(t.db, owner, archivedChild.id)).toMatchObject({
      deleted_at: null,
      archived_at: T0 + 3,
    });
    expect(getTask(t.db, owner, earlier.id).deleted_at).toBe(T0 + 5);
  });

  it('never brings a subtask back live under an archived parent', () => {
    const parent = task('Parent');
    const child = task('Child', { parent_task_id: parent.id });
    setTaskDeleted(t.db, owner, child.id, true, T0 + 5);
    setTaskArchived(t.db, owner, parent.id, true, T0 + 10);

    expect(refusal(() => setTaskDeleted(t.db, owner, child.id, false, T0 + 15))).toEqual({
      code: 'conflict',
      reason: 'parent_archived',
    });
  });
});

describe('who may delete', () => {
  it('a member their own task and not another’s; a viewer none', () => {
    const member = person('member');
    const theirs = task('Theirs', {}, member);
    const owners = task('The owner’s');

    expect(setTaskDeleted(t.db, member, theirs.id, true, T0 + 10).deleted_at).toBe(T0 + 10);
    expect(setTaskDeleted(t.db, member, theirs.id, false, T0 + 11).deleted_at).toBeNull();
    expect(refusal(() => setTaskDeleted(t.db, member, owners.id, true, T0 + 12)).code).toBe(
      'forbidden',
    );
    expect(refusal(() => setTaskDeleted(t.db, person('viewer'), theirs.id, true)).code).toBe(
      'forbidden',
    );
  });

  it('never a token: a live task is session_required, a deleted one does not exist', () => {
    const live = task('Live');
    const gone = task('In Trash');
    setTaskDeleted(t.db, owner, gone.id, true, T0 + 10);
    const { actor } = agent();

    expect(refusal(() => setTaskDeleted(t.db, actor, live.id, true))).toEqual({
      code: 'forbidden',
      reason: 'session_required',
    });
    expect(refusal(() => setTaskDeleted(t.db, actor, gone.id, false)).code).toBe('not_found');
    expect(getTask(t.db, owner, live.id).deleted_at).toBeNull();
    expect(getTask(t.db, owner, gone.id).deleted_at).toBe(T0 + 10);
  });
});

describe('a task in Trash', () => {
  it('is read-only to a person, 409 deleted', () => {
    const gone = task('In Trash');
    const other = task('Other');
    setTaskDeleted(t.db, owner, gone.id, true, T0 + 10);
    const deleted = { code: 'conflict', reason: 'deleted' };

    expect(refusal(() => updateTask(t.db, owner, gone.id, { title: 'No' }))).toEqual(deleted);
    expect(refusal(() => changeStatus(t.db, owner, gone.id, 'todo', T0 + 11))).toEqual(deleted);
    expect(refusal(() => addComment(t.db, owner, gone.id, 'Hello', T0 + 11))).toEqual(deleted);
    expect(
      refusal(() => addTaskDependency(t.sqlite, t.db, owner, other.id, gone.id, T0 + 11)),
    ).toEqual(deleted);
    expect(refusal(() => task('Child', { parent_task_id: gone.id }))).toEqual(deleted);
    // …and a person still reads it, for its banner.
    expect(getTask(t.db, owner, gone.id).title).toBe('In Trash');
  });

  it('does not exist to a token: a read, a write and a claim are 404, and Trash is refused', () => {
    const gone = task('In Trash');
    setTaskDeleted(t.db, owner, gone.id, true, T0 + 10);
    const { actor } = agent();

    expect(refusal(() => getTask(t.db, actor, gone.id)).code).toBe('not_found');
    expect(refusal(() => updateTask(t.db, actor, gone.id, { title: 'No' })).code).toBe('not_found');
    expect(refusal(() => addComment(t.db, actor, gone.id, 'Hello')).code).toBe('not_found');
    // …and as a parent, the 404 too, never `deleted` (review finding).
    expect(
      refusal(() =>
        createTask(t.sqlite, t.db, actor, 'laika', { title: 'Child', parent_task_id: gone.id }),
      ).code,
    ).toBe('not_found');
    expect(refusal(() => startWorking(t.sqlite, t.db, actor, gone.id, { now: T0 + 11 })).code).toBe(
      'not_found',
    );
    expect(refusal(() => listTasks(t.db, actor, 'laika', { ...LIST, trash: 'only' }))).toEqual({
      code: 'forbidden',
      reason: 'session_required',
    });
  });

  it('blocks nothing, and blocks again on restore', () => {
    const blocker = task('Blocker');
    const waiting = task('Waiting', { status: 'todo' });
    addTaskDependency(t.sqlite, t.db, owner, waiting.id, blocker.id, T0 + 1);
    expect(getTask(t.db, owner, waiting.id).ready).toBe(false);

    setTaskDeleted(t.db, owner, blocker.id, true, T0 + 10);
    expect(getTask(t.db, owner, waiting.id).ready).toBe(true);
    expect(projectSummaries(t.db, [s.projectId]).get(s.projectId)?.blocked_count).toBe(0);

    setTaskDeleted(t.db, owner, blocker.id, false, T0 + 20);
    expect(getTask(t.db, owner, waiting.id).ready).toBe(false);
  });

  it('ends the work in flight, and asks the agent again on restore', () => {
    const claude = agent();
    const claimed = task('Claimed');
    startWorking(t.sqlite, t.db, claude.actor, claimed.id, { now: T0 + 1 });
    const selected = task('Selected');
    updateTask(t.db, owner, selected.id, { selected_agent_id: claude.id, now: T0 + 2 });

    setTaskDeleted(t.db, owner, claimed.id, true, T0 + 10);
    setTaskDeleted(t.db, owner, selected.id, true, T0 + 10);

    const claims = t.db.select().from(taskClaims).where(eq(taskClaims.taskId, claimed.id)).all();
    expect(claims.map((c) => c.state)).toEqual(['released']);
    const requests = () =>
      t.db
        .select({ state: handoffOffers.state })
        .from(handoffOffers)
        .where(and(eq(handoffOffers.taskId, selected.id), eq(handoffOffers.kind, 'work_request')))
        .all()
        .map((r) => r.state)
        .sort();
    expect(requests()).toEqual(['cancelled']);

    setTaskDeleted(t.db, owner, selected.id, false, T0 + 20);
    expect(requests()).toEqual(['cancelled', 'open']);
  });
});
