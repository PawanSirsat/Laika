import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { tags, taskTags } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { requireProjectBySlug } from './projects.ts';

/**
 * Tags (SPEC §4.16, D-027) — flat, project-scoped labels on tasks.
 *
 * ## Which §3.2 cells govern it, and why no new action
 *
 * §3.2 already has both, so D-027's "reuse existing cells" needed no exception:
 *
 *  - **applying and removing** a tag is editing a task — *"Create / edit / move
 *    any task"*, implemented as `task.write`. Nothing about a label makes it a
 *    different kind of edit from a title or a priority, and a Member who may
 *    retitle a task but not label it would be a strange line to draw.
 *  - **renaming and deleting project-wide** is `project.settings.edit`, which is
 *    lead-only. That is the difference that matters: one edits your own row, the
 *    other edits everyone's vocabulary.
 *
 * A Viewer can *see* tags they cannot apply, via `project.read` — the same
 * asymmetry every other §3.2 row already has.
 *
 * ## A tag is created by being applied
 *
 * There is no create endpoint (§4.16). `setTaskTags` inserts what it does not
 * find, which is what makes a free-text picker work without a two-step dance.
 * The cost is that a typo becomes a tag; rename and delete are the remedy, and
 * both are lead-only so the vocabulary has an owner.
 */

/** §4.16, and the same shape `tags_name_check` enforces in the database. */
export const TAG_NAME = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const TAG_NAME_MAX = 24;

/** How many tags one task may carry. A card shows a handful; this is a guard. */
export const MAX_TAGS_PER_TASK = 20;

export interface TagView {
  name: string;
  /** How many tasks in this project carry it — the picker sorts on this. */
  task_count: number;
}

/**
 * Normalise, then validate.
 *
 * Trimming and lowercasing on the way in is what makes `UI` pasted from a
 * document behave as `ui` rather than erroring — the friendly half of the same
 * decision that makes case-variant duplicates impossible. What is **not** done
 * is rewriting the middle: a space is refused, not turned into a hyphen, because
 * guessing at `two words` → `two-words` invents a name the caller did not type.
 */
export function normaliseTagName(raw: string): string {
  const name = raw.trim().toLowerCase();

  if (!TAG_NAME.test(name)) {
    throw new ApiError(
      'unprocessable',
      `"${raw}" is not a valid tag: lowercase letters, digits and hyphens, starting with a letter or digit, up to ${String(TAG_NAME_MAX)} characters`,
      { tag: raw },
    );
  }

  return name;
}

/**
 * Normalise a whole list, refusing duplicates **after** normalising.
 *
 * `['UI', 'ui']` is rejected rather than collapsed. Collapsing would mean the
 * caller's list and the stored list differ in length with no error, which
 * surfaces later as "the tag I added vanished".
 */
export function normaliseTagNames(raw: readonly string[]): string[] {
  if (raw.length > MAX_TAGS_PER_TASK) {
    throw new ApiError(
      'unprocessable',
      `A task carries at most ${String(MAX_TAGS_PER_TASK)} tags`,
      {
        count: raw.length,
      },
    );
  }

  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of raw) {
    const name = normaliseTagName(value);
    if (seen.has(name)) {
      throw new ApiError('unprocessable', `"${name}" is listed twice`, { tag: name });
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

// ------------------------------------------------------------------ reading

/**
 * Every task's tags in **one** query.
 *
 * This takes a list for the same reason `dependencyEdges` does: a board is the
 * most-read screen in Laika, and a per-row lookup would add one query per card
 * to a page that already renders fifty.
 *
 * Returns an entry for **every** id asked about, empty array included, so a
 * caller never has to distinguish "no tags" from "not loaded".
 */
export function tagsForTasks(db: Db, taskIds: readonly string[]): Map<string, string[]> {
  const byTask = new Map<string, string[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return byTask;

  const rows = db
    .select({ taskId: taskTags.taskId, name: tags.name })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(inArray(taskTags.taskId, [...taskIds]))
    .orderBy(asc(taskTags.taskId), asc(tags.name))
    .all();

  for (const row of rows) byTask.get(row.taskId)?.push(row.name);

  return byTask;
}

/**
 * The project's tags with usage counts (§6.4 `GET /projects/:slug/tags`).
 *
 * A `LEFT JOIN`, not an inner one: a tag whose last task was deleted still
 * exists and still occupies its name, so a picker that hid it would offer a name
 * the unique index then refuses.
 */
export function listProjectTags(db: Db, actor: ResolvedActor, slug: string): TagView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  return db
    .select({ name: tags.name, taskCount: sql<number>`COUNT(${taskTags.taskId})` })
    .from(tags)
    .leftJoin(taskTags, eq(taskTags.tagId, tags.id))
    .where(eq(tags.projectId, project.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name))
    .all()
    .map((row) => ({ name: row.name, task_count: row.taskCount }));
}

/** The task ids carrying a tag, for the `?tag=` filter. */
export function taskIdsWithTag(db: Db, projectId: string, name: string): string[] {
  const tag = db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.projectId, projectId), eq(tags.name, normaliseTagName(name))))
    .get();

  // An unknown tag is an empty result, not a 404: filtering a board by a tag
  // nobody has used yet is a reasonable thing to do, and "no such tag" would
  // make the UI handle a case that means the same as "no matches".
  if (tag === undefined) return [];

  return db
    .select({ taskId: taskTags.taskId })
    .from(taskTags)
    .where(eq(taskTags.tagId, tag.id))
    .all()
    .map((row) => row.taskId);
}

// ------------------------------------------------------------------ writing

function requireTag(db: Db, projectId: string, name: string): typeof tags.$inferSelect {
  const row = db
    .select()
    .from(tags)
    .where(and(eq(tags.projectId, projectId), eq(tags.name, name)))
    .get();

  if (row === undefined) throw ApiError.notFound(`No tag "${name}" in this project`, { tag: name });

  return row;
}

/**
 * Resolve names to ids, creating the ones that do not exist (§4.16).
 *
 * Must run inside the caller's transaction: creating a tag and attaching it are
 * one change, and a tag row left behind by a failed attach would occupy a name
 * nobody uses.
 */
function resolveOrCreate(
  db: Db,
  projectId: string,
  names: readonly string[],
  now: number,
): { name: string; id: string }[] {
  if (names.length === 0) return [];

  const existing = db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.projectId, projectId), inArray(tags.name, [...names])))
    .all();

  const byName = new Map(existing.map((row) => [row.name, row.id]));

  for (const name of names) {
    if (byName.has(name)) continue;

    const id = newId();
    db.insert(tags).values({ id, projectId, name, createdAt: now }).run();
    byName.set(name, id);
  }

  return names.map((name) => ({ name, id: byName.get(name) ?? '' }));
}

/**
 * Replace a task's tags with exactly this list, reporting what changed.
 *
 * **Replace, not add.** `PATCH { tags: [...] }` reads as "these are the task's
 * tags", the same way `PATCH { title }` reads as "this is the title". An
 * additive verb would leave no way to remove one.
 *
 * Runs inside the caller's transaction and returns `null` when nothing changed,
 * so the caller can skip writing an activity row that says nothing happened.
 */
export function setTaskTags(
  db: Db,
  input: { taskId: string; projectId: string; names: readonly string[]; now: number },
): { from: string[]; to: string[] } | null {
  const before = tagsForTasks(db, [input.taskId]).get(input.taskId) ?? [];
  const after = [...input.names].sort((a, b) => a.localeCompare(b));

  if (before.length === after.length && before.every((name, i) => name === after[i])) return null;

  const resolved = resolveOrCreate(db, input.projectId, input.names, input.now);

  db.delete(taskTags).where(eq(taskTags.taskId, input.taskId)).run();
  for (const tag of resolved) {
    db.insert(taskTags).values({ taskId: input.taskId, tagId: tag.id, createdAt: input.now }).run();
  }

  return { from: before, to: after };
}

/**
 * Rename project-wide (§6.4), `lead+`.
 *
 * **Merges** when the target name already exists rather than refusing: two names
 * for one concept is usually what a rename is fixing, and telling a lead "that
 * name is taken" leaves them to delete and re-apply by hand across every task.
 * The join rows move, the losing tag row goes, and no task changes.
 */
export function renameTag(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  from: string,
  to: string,
  now: number = Date.now(),
): TagView {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  const target = normaliseTagName(to);
  const source = normaliseTagName(from);

  return immediateTransaction(sqlite, () => {
    const tag = requireTag(db, project.id, source);

    if (tag.name === target) return { name: target, task_count: taskCountFor(db, tag.id) };

    const collision = db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.projectId, project.id), eq(tags.name, target)))
      .get();

    if (collision === undefined) {
      db.update(tags).set({ name: target }).where(eq(tags.id, tag.id)).run();
      return { name: target, task_count: taskCountFor(db, tag.id) };
    }

    // `INSERT OR IGNORE`: a task carrying **both** names already has a row for
    // the survivor, and the composite primary key would otherwise turn an
    // ordinary merge into a constraint violation.
    db.run(
      sql`INSERT OR IGNORE INTO ${taskTags} (task_id, tag_id, created_at)
          SELECT task_id, ${collision.id}, ${now} FROM ${taskTags} WHERE tag_id = ${tag.id}`,
    );
    db.delete(tags).where(eq(tags.id, tag.id)).run();

    return { name: target, task_count: taskCountFor(db, collision.id) };
  });
}

/**
 * Delete project-wide (§6.4), `lead+`.
 *
 * **Never deletes a task.** The join rows go with the tag by cascade, exactly as
 * deleting a sprint releases its tasks rather than destroying them (§4.15). The
 * returned count is how many tasks lost the label — what a lead about to confirm
 * the action wants to see.
 */
export function deleteTag(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  name: string,
): { released: number } {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  return immediateTransaction(sqlite, () => {
    const tag = requireTag(db, project.id, normaliseTagName(name));
    const released = taskCountFor(db, tag.id);

    db.delete(tags).where(eq(tags.id, tag.id)).run();

    return { released };
  });
}

function taskCountFor(db: Db, tagId: string): number {
  return (
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(taskTags)
      .where(eq(taskTags.tagId, tagId))
      .get()?.n ?? 0
  );
}
