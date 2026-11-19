import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  attachments,
  comments,
  taskDependencies,
  tasks,
  taskTags,
  taskWatchers,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { addComment } from '../../src/services/comments.ts';
import { addMember } from '../../src/services/projects.ts';
import { assertTaskReachable } from '../../src/services/task-archive.ts';
import {
  PURGED_TITLE,
  purgeExpiredTrash,
  purgeTask,
  TRASH_KEPT_MS,
} from '../../src/services/task-purge.ts';
import {
  addTaskDependency,
  createTask,
  listTasks,
  setTaskDeleted,
} from '../../src/services/tasks.ts';
import { watchTask } from '../../src/services/watchers.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * The Trash scrub (LAI-1355): 30 days after a task goes into Trash — or at
 * once, by a space admin's *Delete now* — what was written on it is erased,
 * and its row, key, history and time stay. The route is
 * `test/http/routes/task-purge.test.ts`'s.
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

function member(): ResolvedActor {
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
  addMember(t.db, owner, 'laika', id, 'member', T0);
  return loadActor(t.db, id)!;
}

function file(taskId: string, commentId: string | null = null): string {
  const id = newId();
  t.db
    .insert(attachments)
    .values({
      id,
      projectId: s.projectId,
      taskId,
      commentId,
      uploadedBy: s.userId,
      filename: 'payroll-2026.pdf',
      contentType: 'application/pdf',
      sizeBytes: 20,
      storageKey: `p/${s.projectId}/${id}`,
      state: 'ready',
      inline: 1,
      createdAt: T0,
      readyAt: T0,
    })
    .run();
  return id;
}

const row = (id: string) => t.db.select().from(tasks).where(eq(tasks.id, id)).get()!;

const purgedRows = (taskId: string) =>
  t.db
    .select({ actorKind: activity.actorKind, payload: activity.payloadJson })
    .from(activity)
    .where(and(eq(activity.taskId, taskId), eq(activity.type, 'task.purged')))
    .all()
    .map((r) => ({ actorKind: r.actorKind, payload: JSON.parse(r.payload) as unknown }));

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

/** A task with something written everywhere a scrub reaches. */
function written() {
  const other = task('Other');
  const waiting = task('Waiting');
  const doomed = task('Payroll for March', {
    description_md: 'Salaries: see the sheet',
    acceptance_md: 'Every slip sent',
    deliverables: [{ title: 'The slips' }],
    solves: ['Late pay'],
    unlocks: ['April'],
    tags: ['finance'],
    external_ref: 'JIRA-7',
  });
  t.db.update(tasks).set({ branch: 'LAI-9-payroll' }).where(eq(tasks.id, doomed.id)).run();
  const comment = addComment(t.db, owner, doomed.id, 'The sheet is on the drive', T0);
  const onTask = file(doomed.id);
  const onComment = file(doomed.id, comment.id);
  watchTask(t.db, owner, doomed.id, T0);
  addTaskDependency(t.sqlite, t.db, owner, doomed.id, other.id);
  addTaskDependency(t.sqlite, t.db, owner, waiting.id, doomed.id);
  return { doomed, comment, files: [onTask, onComment] };
}

describe('purgeTask — Delete now', () => {
  it('erases what was written on the task and keeps its row, key and history', () => {
    const { doomed, comment, files } = written();
    const before = t.db.select().from(activity).where(eq(activity.taskId, doomed.id)).all().length;
    setTaskDeleted(t.db, owner, doomed.id, true, T0 + 1);

    expect(purgeTask(t.db, owner, doomed.id, T0 + 2)).toEqual({ purged: [doomed.id] });

    const after = row(doomed.id);
    expect(after).toMatchObject({
      number: doomed.number,
      title: PURGED_TITLE,
      descriptionMd: null,
      acceptanceMd: null,
      deliverables: [],
      solves: [],
      unlocks: [],
      branch: null,
      externalRef: null,
      deletedAt: T0 + 1,
      purgedAt: T0 + 2,
    });
    const said = t.db.select().from(comments).where(eq(comments.id, comment.id)).get()!;
    expect(said).toMatchObject({ bodyMd: '', deletedAt: T0 + 2 });
    for (const id of files) {
      const f = t.db.select().from(attachments).where(eq(attachments.id, id)).get()!;
      // Removed, so §11.6's sweep deletes the object; its name goes now.
      expect(f).toMatchObject({ filename: 'deleted', deletedAt: T0 + 2, deletedBy: s.userId });
    }
    expect(t.db.select().from(taskTags).where(eq(taskTags.taskId, doomed.id)).all()).toEqual([]);
    expect(
      t.db.select().from(taskWatchers).where(eq(taskWatchers.taskId, doomed.id)).all(),
    ).toEqual([]);
    expect(t.db.select().from(taskDependencies).all()).toEqual([]);

    // History stays, and says what happened, by whom.
    const history = t.db.select().from(activity).where(eq(activity.taskId, doomed.id)).all();
    expect(history.length).toBe(before + 2);
    expect(purgedRows(doomed.id)).toEqual([{ actorKind: 'user', payload: {} }]);
  });

  it('never hands its number out again, and frees its outside id for another card', () => {
    const { doomed } = written();
    // Taken while the task is in Trash.
    setTaskDeleted(t.db, owner, doomed.id, true, T0 + 1);
    expect(refusal(() => task('Again', { external_ref: 'JIRA-7' }))).toEqual({
      code: 'unprocessable',
      reason: 'taken',
    });

    purgeTask(t.db, owner, doomed.id, T0 + 2);
    const again = task('Again', { external_ref: 'JIRA-7' });
    expect(again.external_ref).toBe('JIRA-7');
    expect(again.number).toBe(doomed.number + 1);
  });

  it('is gone to everyone: out of Trash, 404 to a person, and no restore', () => {
    const doomed = task('Gone');
    setTaskDeleted(t.db, owner, doomed.id, true, T0 + 1);
    expect(listTasks(t.db, owner, 'laika', { ...LIST, trash: 'only' }).map((v) => v.id)).toEqual([
      doomed.id,
    ]);
    purgeTask(t.db, owner, doomed.id, T0 + 2);

    expect(listTasks(t.db, owner, 'laika', { ...LIST, trash: 'only' })).toEqual([]);
    expect(refusal(() => assertTaskReachable(t.db, owner, doomed.id)).code).toBe('not_found');
    expect(refusal(() => setTaskDeleted(t.db, owner, doomed.id, false)).code).toBe('not_found');
    expect(refusal(() => purgeTask(t.db, owner, doomed.id)).code).toBe('not_found');
    expect(purgedRows(doomed.id)).toHaveLength(1);
  });

  it('takes its subtasks in Trash with it', () => {
    const parent = task('Parent');
    const child = task('Child', { parent_task_id: parent.id, description_md: 'secret' });
    setTaskDeleted(t.db, owner, parent.id, true, T0 + 1);

    expect(purgeTask(t.db, owner, parent.id, T0 + 2).purged.sort()).toEqual(
      [parent.id, child.id].sort(),
    );
    expect(row(child.id)).toMatchObject({ title: PURGED_TITLE, descriptionMd: null });
    expect(purgedRows(child.id)).toEqual([
      { actorKind: 'user', payload: { with_parent: parent.id } },
    ]);
  });

  it('only from Trash: a live task is 409 not_in_trash, and nothing changes', () => {
    const live = task('Live');
    expect(refusal(() => purgeTask(t.db, owner, live.id))).toEqual({
      code: 'conflict',
      reason: 'not_in_trash',
    });
    expect(row(live.id)).toMatchObject({ title: 'Live', purgedAt: null });
  });
});

describe('who may Delete now', () => {
  it('a space admin, and not a member — not even on a task they created', () => {
    const mira = member();
    const hers = task('Hers', {}, mira);
    setTaskDeleted(t.db, mira, hers.id, true, T0 + 1);
    expect(refusal(() => purgeTask(t.db, mira, hers.id)).code).toBe('forbidden');
    expect(row(hers.id).purgedAt).toBeNull();
    purgeTask(t.db, owner, hers.id, T0 + 2);
    expect(row(hers.id).purgedAt).toBe(T0 + 2);
  });

  it('never a token: a live task is session_required, one in Trash does not exist', () => {
    const created = registerAgent(t.sqlite, t.db, owner, {
      displayName: 'Claude',
      harness: 'claude-code',
      deviceLabel: 'device-1',
      grants: [{ projectId: s.projectId, scope: 'full' }],
    });
    const agent = resolveTokenActor(t.db, created.secret, T0);
    const live = task('Live');
    expect(refusal(() => purgeTask(t.db, agent, live.id))).toEqual({
      code: 'forbidden',
      reason: 'session_required',
    });
    setTaskDeleted(t.db, owner, live.id, true, T0 + 1);
    expect(refusal(() => purgeTask(t.db, agent, live.id)).code).toBe('not_found');
    expect(row(live.id).purgedAt).toBeNull();
  });
});

describe('purgeExpiredTrash — the daily job', () => {
  it('scrubs a task 30 days in Trash, as the system, and not one a moment younger', () => {
    const old = task('Old');
    const young = task('Young');
    setTaskDeleted(t.db, owner, old.id, true, T0);
    setTaskDeleted(t.db, owner, young.id, true, T0 + 1);

    expect(purgeExpiredTrash(t.db, T0 + TRASH_KEPT_MS)).toEqual({ changed: 1 });
    expect(row(old.id)).toMatchObject({ title: PURGED_TITLE, purgedAt: T0 + TRASH_KEPT_MS });
    expect(row(young.id)).toMatchObject({ title: 'Young', purgedAt: null });
    expect(purgedRows(old.id)).toEqual([{ actorKind: 'system', payload: {} }]);
  });

  it('is idempotent: a second run changes nothing and writes nothing', () => {
    const parent = task('Parent');
    task('Child', { parent_task_id: parent.id });
    setTaskDeleted(t.db, owner, parent.id, true, T0);

    // The parent and the child went in together: both scrubbed, each once.
    expect(purgeExpiredTrash(t.db, T0 + TRASH_KEPT_MS)).toEqual({ changed: 2 });
    const rows = t.db.select().from(activity).where(eq(activity.type, 'task.purged')).all();
    expect(rows).toHaveLength(2);

    expect(purgeExpiredTrash(t.db, T0 + TRASH_KEPT_MS + 1)).toEqual({ changed: 0 });
    expect(t.db.select().from(activity).where(eq(activity.type, 'task.purged')).all()).toEqual(
      rows,
    );
  });

  it('leaves a task restored inside its 30 days alone', () => {
    const back = task('Back');
    setTaskDeleted(t.db, owner, back.id, true, T0);
    setTaskDeleted(t.db, owner, back.id, false, T0 + 1);

    expect(purgeExpiredTrash(t.db, T0 + 2 * TRASH_KEPT_MS)).toEqual({ changed: 0 });
    expect(row(back.id)).toMatchObject({ title: 'Back', deletedAt: null, purgedAt: null });
  });
});
