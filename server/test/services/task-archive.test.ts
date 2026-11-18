import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { activity, handoffOffers, taskClaims } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { addComment } from '../../src/services/comments.ts';
import { projectSummaries } from '../../src/services/projects.ts';
import { listReviewQueue } from '../../src/services/review.ts';
import {
  addTaskDependency,
  changeStatus,
  createTask,
  getTask,
  listAllTasks,
  listTasks,
  removeTaskDependency,
  setTaskArchived,
  startWorking,
  summariseAllTasks,
  updateTask,
} from '../../src/services/tasks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * Archiving a task (LAI-1353): it leaves every list, keeps its history, is
 * read-only until restored, and takes its subtasks with it. The route is
 * `test/http/routes/task-archive.test.ts`'s; the census of every reader is
 * `test/tooling/live-task-census.test.ts`'s.
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

function task(title = 'Work', extra: Record<string, unknown> = {}) {
  return createTask(t.sqlite, t.db, owner, 'laika', { title, now: T0, ...extra });
}

const ids = (views: readonly { id: string }[]) => views.map((v) => v.id).sort();

/** The refusal's `code` and `reason`; a call that does not throw fails the test. */
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

let fixtureDevices = 0;

/** A registered agent of the owner, fully granted, acting through its own token. */
function agent() {
  const created = registerAgent(t.sqlite, t.db, owner, {
    displayName: 'Claude',
    harness: 'claude-code',
    deviceLabel: `device-${++fixtureDevices}`,
    grants: [{ projectId: s.projectId, scope: 'full' }],
  });
  return { id: created.agent.id, actor: resolveTokenActor(t.db, created.secret, T0) };
}

describe('setTaskArchived', () => {
  it('takes the task out of both lists and the summary, and puts it back', () => {
    const kept = task('Kept');
    const put = task('Put away');

    const archived = setTaskArchived(t.db, owner, put.id, true, T0 + 10);
    expect(archived).toMatchObject({ archived_at: T0 + 10, archived_by: s.userId });

    expect(ids(listTasks(t.db, owner, 'laika', LIST))).toEqual([kept.id]);
    expect(ids(listAllTasks(t.db, owner, LIST))).toEqual([kept.id]);
    expect(summariseAllTasks(t.db, owner, {}).total).toBe(1);
    expect(projectSummaries(t.db, [s.projectId]).get(s.projectId)?.task_counts.backlog).toBe(1);

    // The Archived view, on both lists.
    const only = { ...LIST, archived: 'only' as const };
    expect(ids(listTasks(t.db, owner, 'laika', only))).toEqual([put.id]);
    expect(ids(listAllTasks(t.db, owner, only))).toEqual([put.id]);
    expect(summariseAllTasks(t.db, owner, { archived: 'only' }).total).toBe(1);

    // Reading it by id still works, and says so.
    expect(getTask(t.db, owner, put.id).archived_at).toBe(T0 + 10);

    const restored = setTaskArchived(t.db, owner, put.id, false, T0 + 20);
    expect(restored).toMatchObject({ archived_at: null, archived_by: null, status: 'backlog' });
    expect(ids(listTasks(t.db, owner, 'laika', LIST))).toEqual(ids([kept, put]));
  });

  it('keeps an archived task on a catching-up read, so the route can tombstone it', () => {
    task('Kept');
    const put = task('Put away');
    setTaskArchived(t.db, owner, put.id, true, T0 + 10);

    const since = listTasks(t.db, owner, 'laika', { ...LIST, updatedSince: T0 + 5 });
    expect(since.map((v) => [v.id, v.archived_at])).toEqual([[put.id, T0 + 10]]);
    // …and leaves it out of the figures, which are about work.
    expect(summariseAllTasks(t.db, owner, { updatedSince: T0 + 5 }).total).toBe(0);
  });

  it('writes one row per task, and nothing when it is already what was asked', () => {
    const put = task();
    setTaskArchived(t.db, owner, put.id, true, T0 + 10);
    setTaskArchived(t.db, owner, put.id, true, T0 + 11);
    setTaskArchived(t.db, owner, put.id, false, T0 + 12);
    setTaskArchived(t.db, owner, put.id, false, T0 + 13);

    const rows = t.db
      .select({ type: activity.type, payload: activity.payloadJson, at: activity.createdAt })
      .from(activity)
      .where(eq(activity.taskId, put.id))
      .all()
      .filter((r) => r.type === 'task.archived' || r.type === 'task.restored');
    expect(rows).toEqual([
      { type: 'task.archived', payload: '{}', at: T0 + 10 },
      { type: 'task.restored', payload: '{}', at: T0 + 12 },
    ]);
  });

  it('takes the subtasks with it, and restores exactly those', () => {
    const parent = task('Parent');
    const child = task('Child', { parent_task_id: parent.id });
    const earlier = task('Put away before', { parent_task_id: parent.id });
    setTaskArchived(t.db, owner, earlier.id, true, T0 + 5);

    setTaskArchived(t.db, owner, parent.id, true, T0 + 10);
    expect(getTask(t.db, owner, child.id).archived_at).toBe(T0 + 10);
    expect(getTask(t.db, owner, earlier.id).archived_at).toBe(T0 + 5);
    const childRow = t.db
      .select({ payload: activity.payloadJson })
      .from(activity)
      .where(and(eq(activity.taskId, child.id), eq(activity.type, 'task.archived')))
      .get();
    expect(JSON.parse(childRow!.payload)).toEqual({ with_parent: parent.id });

    // A subtask cannot come back while its parent is put away.
    expect(refusal(() => setTaskArchived(t.db, owner, child.id, false, T0 + 15))).toEqual({
      code: 'conflict',
      reason: 'parent_archived',
    });

    setTaskArchived(t.db, owner, parent.id, false, T0 + 20);
    expect(getTask(t.db, owner, child.id).archived_at).toBeNull();
    // The one archived on its own stays archived.
    expect(getTask(t.db, owner, earlier.id).archived_at).toBe(T0 + 5);
  });

  it('is signed in only: a token, an agent’s included, is refused', () => {
    const put = task();
    const { actor } = agent();
    expect(refusal(() => setTaskArchived(t.db, actor, put.id, true, T0 + 10)).code).toBe(
      'forbidden',
    );
    expect(getTask(t.db, owner, put.id).archived_at).toBeNull();
  });
});

describe('an archived task is read-only', () => {
  it('refuses every write but the restore, 409 archived', () => {
    const put = task('Put away');
    const other = task('Other');
    setTaskArchived(t.db, owner, put.id, true, T0 + 10);
    const archived = { code: 'conflict', reason: 'archived' };

    expect(refusal(() => updateTask(t.db, owner, put.id, { title: 'Edited' }))).toEqual(archived);
    expect(refusal(() => changeStatus(t.db, owner, put.id, 'todo', T0 + 11))).toEqual(archived);
    expect(
      refusal(() => addTaskDependency(t.sqlite, t.db, owner, put.id, other.id, T0 + 11)),
    ).toEqual(archived);
    // …as a blocker too: an archived blocker blocks nothing, so it is not added as one.
    expect(
      refusal(() => addTaskDependency(t.sqlite, t.db, owner, other.id, put.id, T0 + 11)),
    ).toEqual(archived);
    expect(refusal(() => removeTaskDependency(t.db, owner, put.id, other.id, T0 + 11))).toEqual(
      archived,
    );
    expect(refusal(() => addComment(t.db, owner, put.id, 'Hello', T0 + 11))).toEqual(archived);
    expect(refusal(() => startWorking(t.sqlite, t.db, owner, put.id, { now: T0 + 11 }))).toEqual(
      archived,
    );
    expect(refusal(() => task('Child', { parent_task_id: put.id }))).toEqual(archived);

    expect(getTask(t.db, owner, put.id).title).toBe('Put away');
  });
});

describe('what archiving ends', () => {
  it('an archived blocker blocks nothing, and blocks again on restore', () => {
    const blocker = task('Blocker');
    const waiting = task('Waiting', { status: 'todo' });
    addTaskDependency(t.sqlite, t.db, owner, waiting.id, blocker.id, T0 + 1);
    expect(getTask(t.db, owner, waiting.id).ready).toBe(false);

    setTaskArchived(t.db, owner, blocker.id, true, T0 + 10);
    const unblocked = getTask(t.db, owner, waiting.id);
    expect(unblocked).toMatchObject({ ready: true, blocked_by: [blocker.id] });
    expect(summariseAllTasks(t.db, owner, {}).blocked).toBe(0);
    expect(projectSummaries(t.db, [s.projectId]).get(s.projectId)?.blocked_count).toBe(0);

    setTaskArchived(t.db, owner, blocker.id, false, T0 + 20);
    expect(getTask(t.db, owner, waiting.id).ready).toBe(false);
  });

  it('is never ready itself', () => {
    const put = task('Ready work', { status: 'todo' });
    expect(put.ready).toBe(true);
    expect(setTaskArchived(t.db, owner, put.id, true, T0 + 10).ready).toBe(false);
  });

  it('leaves the review queue', () => {
    const put = task('In review', { status: 'review' });
    expect(listReviewQueue(t.db, owner).tasks.map((x) => x.task.id)).toEqual([put.id]);
    setTaskArchived(t.db, owner, put.id, true, T0 + 10);
    expect(listReviewQueue(t.db, owner).tasks).toEqual([]);
  });

  it('releases the live claim and cancels the open work request; restore asks again', () => {
    const claude = agent();
    const claimed = task('Claimed');
    startWorking(t.sqlite, t.db, claude.actor, claimed.id, { now: T0 + 1 });
    const selected = task('Selected');
    updateTask(t.db, owner, selected.id, { selected_agent_id: claude.id, now: T0 + 2 });

    setTaskArchived(t.db, owner, claimed.id, true, T0 + 10);
    setTaskArchived(t.db, owner, selected.id, true, T0 + 10);

    const claims = t.db.select().from(taskClaims).where(eq(taskClaims.taskId, claimed.id)).all();
    expect(claims.map((c) => [c.state, c.endedAt])).toEqual([['released', T0 + 10]]);
    const requests = () =>
      t.db
        .select({ state: handoffOffers.state, reason: handoffOffers.closedReason })
        .from(handoffOffers)
        .where(and(eq(handoffOffers.taskId, selected.id), eq(handoffOffers.kind, 'work_request')))
        .all();
    expect(requests()).toEqual([{ state: 'cancelled', reason: 'task_closed' }]);

    setTaskArchived(t.db, owner, selected.id, false, T0 + 20);
    expect(
      requests()
        .map((r) => r.state)
        .sort(),
    ).toEqual(['cancelled', 'open']);
  });

  it('does not ask again for a request declined before the archive', () => {
    const claude = agent();
    const selected = task('Selected');
    updateTask(t.db, owner, selected.id, { selected_agent_id: claude.id, now: T0 + 2 });
    t.db
      .update(handoffOffers)
      .set({ state: 'declined', closedAt: T0 + 3 })
      .where(eq(handoffOffers.taskId, selected.id))
      .run();

    setTaskArchived(t.db, owner, selected.id, true, T0 + 10);
    setTaskArchived(t.db, owner, selected.id, false, T0 + 20);
    const states = t.db
      .select({ state: handoffOffers.state })
      .from(handoffOffers)
      .where(eq(handoffOffers.taskId, selected.id))
      .all();
    expect(states).toEqual([{ state: 'declined' }]);
  });
});
