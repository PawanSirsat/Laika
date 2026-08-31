import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { type ResolvedActor, loadActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { commentMentions, comments, projects, taskWatchers, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { mentionedUserIds } from './mentions.ts';

/**
 * Who is interested in a task (SPEC §4.18, LAI-094).
 *
 * ## Watching is derived, and the table only records the exceptions
 *
 * Being assigned a task, commenting on it, or being mentioned in it implies
 * watching it — otherwise nobody ever watches anything and the Watch button is
 * decorative. Those three facts already live in `tasks`, `comments` and
 * `comment_mentions`, so this computes the set at read time rather than
 * materialising a row on every assign and comment.
 *
 * A stored copy would be a second source of truth that drifts the moment a write
 * path forgets it, and it would be wrong for everything that happened before this
 * feature existed — every past commenter would be a non-watcher. `commentCounts`
 * is derived for the same reason.
 *
 * So `task_watchers` holds only what cannot be derived:
 *
 * | row | meaning |
 * | --- | --- |
 * | none | the implicit rules decide |
 * | `watching = 1` | in, whether or not an implicit rule applies |
 * | `watching = 0` | out, and the implicit rules are suppressed |
 *
 * **The third state is the load-bearing one.** With row-presence alone, somebody
 * who unwatches a noisy task is resubscribed by their own next comment — the
 * behaviour most likely to make a person turn notifications off entirely.
 *
 * ## The set never widens who can see anything
 *
 * Every reader is checked for `project.read` before being returned, so a watcher
 * who loses access stops being one. The stream answers to `project.read` (§11.5)
 * and this table is not a way around it. The check lives here rather than at each
 * call site because a caller that forgets it leaks silently.
 *
 * ## No activity row
 *
 * Watching is not an event anybody else needs in the feed, and a verb for it
 * would put a line in every reader's timeline each time one person clicked a
 * button. Heartbeats are silent for the same reason (LAI-417).
 */

function requireTaskContext(db: Db, taskId: string) {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (project === undefined) throw ApiError.notFound('That task belongs to no project');

  return { task, project };
}

/** Set `watching` for this actor on this task, inserting or updating the one row. */
function setWatching(db: Db, actor: ResolvedActor, taskId: string, watching: 0 | 1, now: number) {
  const { project } = requireTaskContext(db, taskId);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const existing = db
    .select({ id: taskWatchers.id })
    .from(taskWatchers)
    .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actor.userId)))
    .get();

  if (existing === undefined) {
    db.insert(taskWatchers)
      .values({
        id: newId(),
        taskId,
        userId: actor.userId,
        watching,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return;
  }

  db.update(taskWatchers)
    .set({ watching, updatedAt: now })
    .where(eq(taskWatchers.id, existing.id))
    .run();
}

/**
 * Watch a task.
 *
 * `project.read` rather than a new §3 action: you may watch what you may read,
 * and watching grants nothing a reader does not already have.
 */
export function watchTask(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): void {
  setWatching(db, actor, taskId, 1, now);
}

/**
 * Stop watching a task.
 *
 * This writes `watching = 0` rather than deleting the row, which is what makes
 * the decision stick against the implicit rules. See the module comment.
 */
export function unwatchTask(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): void {
  setWatching(db, actor, taskId, 0, now);
}

/** Whether the actor is watching, and whether they said so explicitly. */
export interface WatchState {
  watching: boolean;
  /** `true` when a row exists — the person chose, rather than inheriting a rule. */
  explicit: boolean;
}

export function watchState(db: Db, actor: ResolvedActor, taskId: string): WatchState {
  const { project } = requireTaskContext(db, taskId);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const row = db
    .select({ watching: taskWatchers.watching })
    .from(taskWatchers)
    .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actor.userId)))
    .get();

  if (row !== undefined) return { watching: row.watching === 1, explicit: true };

  return { watching: impliedWatcherIds(db, taskId).has(actor.userId), explicit: false };
}

/** Assignee, commenters and mentioned people — the three implicit rules. */
function impliedWatcherIds(db: Db, taskId: string): Set<string> {
  const implied = new Set<string>();

  const task = db
    .select({ assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task?.assigneeId != null) implied.add(task.assigneeId);

  // Live comments only. A deleted comment is not a reason to keep hearing about
  // the task, and its author may have deleted it precisely to stop.
  for (const row of db
    .select({ authorId: comments.authorId })
    .from(comments)
    .where(and(eq(comments.taskId, taskId), isNull(comments.deletedAt)))
    .all())
    implied.add(row.authorId);

  for (const userId of mentionedUserIds(db, [taskId]).get(taskId) ?? []) implied.add(userId);

  return implied;
}

/**
 * Everybody watching this task, implicit and explicit, who can still read it.
 *
 * The actor must be able to read the project themselves — this reports who is
 * interested, which is ordinary project-visible information, but it is not
 * public.
 */
export function watchersOfTask(db: Db, actor: ResolvedActor, taskId: string): string[] {
  const { project } = requireTaskContext(db, taskId);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const candidates = impliedWatcherIds(db, taskId);

  const explicit = db
    .select({ userId: taskWatchers.userId, watching: taskWatchers.watching })
    .from(taskWatchers)
    .where(eq(taskWatchers.taskId, taskId))
    .all();

  for (const row of explicit) {
    if (row.watching === 1) candidates.add(row.userId);
    else candidates.delete(row.userId);
  }

  return [...candidates].filter((userId) => canRead(db, userId, project.id)).sort();
}

/** Can this person — on their own authority, not the caller's — read the project? */
function canRead(db: Db, userId: string, projectId: string): boolean {
  const person = loadActor(db, userId);
  if (person === null) return false;

  const membership = person.memberships.find((m) => m.projectId === projectId);

  return can({ ...person, projectRole: membership?.role ?? null }, 'project.read', { projectId });
}

/**
 * The tasks a person watches.
 *
 * **Own only.** What somebody else is paying attention to is not something §3
 * grants anybody the right to read, and inventing that capability here would be
 * a policy decision made in a service. A "what is X watching" view needs its own
 * §3 row first.
 */
export function tasksWatchedBy(
  db: Db,
  actor: ResolvedActor,
  userId: string = actor.userId,
): string[] {
  if (userId !== actor.userId) {
    throw new ApiError('forbidden', 'You can only list your own watched tasks', {
      action: 'project.read',
    });
  }

  const candidates = new Set<string>();

  for (const row of db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.assigneeId, userId))
    .all())
    candidates.add(row.id);

  for (const row of db
    .select({ taskId: comments.taskId })
    .from(comments)
    .where(and(eq(comments.authorId, userId), isNull(comments.deletedAt)))
    .all())
    candidates.add(row.taskId);

  for (const row of db
    .select({ taskId: taskWatchers.taskId })
    .from(taskWatchers)
    .where(and(eq(taskWatchers.userId, userId), eq(taskWatchers.watching, 1)))
    .all())
    candidates.add(row.taskId);

  for (const taskId of taskIdsMentioning(db, userId)) candidates.add(taskId);

  const suppressed = new Set(
    db
      .select({ taskId: taskWatchers.taskId })
      .from(taskWatchers)
      .where(and(eq(taskWatchers.userId, userId), ne(taskWatchers.watching, 1)))
      .all()
      .map((r) => r.taskId),
  );

  const remaining = [...candidates].filter((id) => !suppressed.has(id));
  if (remaining.length === 0) return [];

  // One `can()` per distinct project rather than per task: §3 grades reads by
  // project, so every task in a project has the same answer.
  const rows = db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(inArray(tasks.id, remaining))
    .all();

  const readable = new Map<string, boolean>();

  return rows
    .filter((row) => {
      const cached = readable.get(row.projectId);
      if (cached !== undefined) return cached;

      const allowed = can(withProject(actor, row.projectId), 'project.read', {
        projectId: row.projectId,
      });
      readable.set(row.projectId, allowed);

      return allowed;
    })
    .map((row) => row.id)
    .sort();
}

/** Tasks carrying a live comment that mentions this person. */
function taskIdsMentioning(db: Db, userId: string): string[] {
  const rows = db
    .select({ taskId: comments.taskId })
    .from(commentMentions)
    .innerJoin(comments, eq(comments.id, commentMentions.commentId))
    .where(and(eq(commentMentions.userId, userId), isNull(comments.deletedAt)))
    .all();

  return [...new Set(rows.map((r) => r.taskId))];
}
