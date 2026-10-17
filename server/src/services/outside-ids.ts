import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { projects, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { canSeeProject } from './projects.ts';

/**
 * Outside ids (LAI-780, the owner's option 1): a card may carry the id it has
 * somewhere else — a repo task file's `LAI-123`, a Jira or GitHub key — in
 * `external_ref` (§4.5), and **everything that takes a task key takes that id
 * too**: a usage report's task keys, and every MCP tool that names a task.
 *
 * `external_ref` also holds what the GitHub webhook records, `owner/repo#N`
 * (§9.2). That value is never an outside id — it has a `/` and a `#` — so the
 * two share the column without either being mistaken for the other, and the
 * webhook never writes over an outside id (`handlePullRequest`).
 *
 * Two rules carry the risk:
 *
 * - **Only in projects the caller may read.** An id on a card the caller
 *   cannot see resolves to nothing, as a key that names no task does, so the
 *   answer does not confirm the card exists.
 * - **Never a guess.** An id two readable cards carry is refused `422
 *   ambiguous` with the keys it matched, rather than settled by whichever row
 *   sorts first; in a usage report, where nobody can be asked, it stays
 *   unattributed.
 *
 * A board key always wins: an outside id is looked up only when the ref names
 * no task by its key (`resolveTaskRef`).
 *
 * **Within a project an outside id is one task's** (LAI-780 review): a write
 * of one another task of the project holds is refused `422` `taken`, naming
 * it. A service check, not a unique index, because the column also holds pull
 * requests' refs, which two tasks may share. Across projects the same id is
 * allowed — the ambiguous rule answers there, and an org-wide check would say
 * that a card the writer cannot see exists.
 */

/**
 * The shape: a prefix of 1–16 letters, digits and `_` that starts with a
 * letter, a dash, and 1–9 digits. Wider than a board key (§4.3's prefix is 2–8
 * letters and digits) because a Jira project key may carry `_` and run longer.
 * It bounds the length too: 26 characters at most.
 */
export const OUTSIDE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$/;

export function isOutsideId(value: string): boolean {
  return OUTSIDE_ID_PATTERN.test(value.trim());
}

/** An outside id as stored: trimmed and upper-cased, or a `422` naming the field. */
export function normaliseOutsideId(raw: string): string {
  const value = raw.trim();
  if (!OUTSIDE_ID_PATTERN.test(value)) {
    throw new ApiError(
      'unprocessable',
      'An outside id is a prefix of up to 16 letters, digits and _, a dash and a number — such as LAI-123 or DATA_ENG-12',
      { field: 'external_ref', external_ref: raw },
    );
  }
  return value.toUpperCase();
}

export interface OutsideMatch {
  taskId: string;
  projectId: string;
  /** The task's own board key, `PREFIX-n`. */
  key: string;
}

/**
 * The tasks the caller may read that carry `ref` as their outside id, by key.
 * Empty for a ref of another shape. One indexed lookup (§4.13's
 * `tasks(external_ref, project_id)`), then `can()` on each project — the only
 * authority, as `listProjects` has it.
 */
export function readableByOutsideId(db: Db, actor: ResolvedActor, ref: string): OutsideMatch[] {
  if (!isOutsideId(ref)) return [];
  return db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      prefix: projects.prefix,
      number: tasks.number,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.externalRef, ref.trim().toUpperCase()))
    .all()
    .filter((row) => canSeeProject(actor, row.projectId))
    .map((row) => ({
      taskId: row.taskId,
      projectId: row.projectId,
      key: `${row.prefix}-${String(row.number)}`,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Refuses `ref` — normalised — when another task of `projectId` holds it:
 * `422` with `reason: 'taken'` and that task's key. Every writer of an outside
 * id stores it upper-case, so comparing the normalised value is comparing
 * case-insensitively, and it is one search of §4.13's index. `taskId` is the
 * task being written, which may of course keep its own id.
 */
export function assertOutsideIdFree(
  db: Db,
  projectId: string,
  ref: string,
  taskId: string | null,
): void {
  const holder = db
    .select({ number: tasks.number, prefix: projects.prefix })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.externalRef, ref),
        eq(tasks.projectId, projectId),
        taskId === null ? undefined : ne(tasks.id, taskId),
      ),
    )
    .get();
  if (holder === undefined) return;
  const key = `${holder.prefix}-${String(holder.number)}`;
  throw new ApiError(
    'unprocessable',
    `${ref} is already the outside id of ${key} in this project`,
    {
      field: 'external_ref',
      reason: 'taken',
      external_ref: ref,
      task: key,
    },
  );
}

/** `422 ambiguous`: the id, and the keys of the readable tasks that carry it. */
export function ambiguousOutsideId(ref: string, matches: readonly OutsideMatch[]): ApiError {
  const id = ref.trim().toUpperCase();
  const keys = matches.map((m) => m.key);
  return new ApiError(
    'unprocessable',
    `${id} is the outside id of ${String(keys.length)} tasks you can read (${keys.join(', ')}) — name one by its key`,
    { reason: 'ambiguous', external_ref: id, tasks: keys },
  );
}

/**
 * The prefixes of the outside ids on tasks in projects the caller may read,
 * sorted, each once (LAI-780): the sharing answer's `task_prefixes` carries
 * them beside the projects' own, so a branch `LAI-780-…` counts. A pull
 * request's `owner/repo#N` is no outside id and gives no prefix.
 *
 * Read from the partial index alone — every row with an `external_ref`, which
 * is the cards that carry one — and filtered in code, as `listProjects` is.
 */
export function outsideIdPrefixes(db: Db, actor: ResolvedActor): string[] {
  const seen = new Map<string, boolean>();
  const prefixes = new Set<string>();
  const rows = db
    .selectDistinct({ ref: tasks.externalRef, projectId: tasks.projectId })
    .from(tasks)
    .where(isNotNull(tasks.externalRef))
    .all();
  for (const { ref, projectId } of rows) {
    if (ref === null || !OUTSIDE_ID_PATTERN.test(ref)) continue;
    let readable = seen.get(projectId);
    if (readable === undefined) {
      readable = canSeeProject(actor, projectId);
      seen.set(projectId, readable);
    }
    if (readable) prefixes.add(ref.slice(0, ref.lastIndexOf('-')).toUpperCase());
  }
  return [...prefixes].sort();
}
