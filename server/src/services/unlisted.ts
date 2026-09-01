import type Database from 'better-sqlite3';
import { and, desc, eq, gte, isNull, lt, or, type SQL } from 'drizzle-orm';
import { activityActor } from '../auth/resolve-actor.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type TaskPriority } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { requireOrgId } from '../db/orgs.ts';
import { unlistedWork } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { createTask, type TaskView } from './tasks.ts';

/**
 * The humans' side of `log_unlisted_work` (SPEC §4.14, §6.4, §7.2, D-024).
 *
 * An agent that notices work belonging to no project records it here instead of
 * inventing a task. That is the one MCP tool with no REST twin. **Reading the
 * pile and acting on it is the opposite** — REST only, because triage is a
 * person's job, and this module is that side.
 *
 * ## Which permission, and why two of them on promote
 *
 * Reading is org-level: §4.14's rows carry no project, and §3.1 has no cell for
 * "read the unlisted pile". The nearest thing it does describe is **Export audit
 * log** (✓ Owner, ✓ Admin), which is the same cell the org-wide activity feed
 * borrows for the same reason — these rows *are* audit rows. So `audit_log.export`.
 *
 * **Promote needs a second, different check.** It creates a task in a named
 * project, and being allowed to read the pile says nothing about being allowed
 * to write to that project. The second check is not repeated here: `createTask`
 * asserts `task.write` against the project itself, so delegating to it *is* the
 * check, in the layer that owns it. Writing our own would be a second opinion
 * about the same question, and two opinions eventually disagree.
 */

/**
 * Re-exported so the route can validate `priority` without importing `db/`,
 * which CONVENTIONS §2 forbids. Same line, same reason, as `ORG_ROLES` on
 * `services/invites.ts` — a second copy of a closed vocabulary in a route file
 * is a copy nothing checks against the original.
 */
export { TASK_PRIORITIES } from '../db/enums.ts';

export interface UnlistedView {
  id: string;
  user_id: string;
  /** Which token logged it — agent provenance, nullable (§4.14). */
  token_id: string | null;
  repo: string;
  note: string;
  /** The task it became, once triaged. Null while it is still a note. */
  promoted_task_id: string | null;
  dismissed_at: number | null;
  created_at: number;
}

type UnlistedRow = typeof unlistedWork.$inferSelect;

function toView(row: UnlistedRow): UnlistedView {
  return {
    id: row.id,
    user_id: row.userId,
    token_id: row.tokenId,
    repo: row.repo,
    note: row.note,
    promoted_task_id: row.promotedTaskId,
    dismissed_at: row.dismissedAt,
    created_at: row.createdAt,
  };
}

export interface LogUnlistedWorkInput {
  /** A repository name, not a path and not a URL (§4.14). */
  repo: string;
  /** Agent-authored prose. No file contents, no diffs, no prompt text (D-005). */
  note: string;
  now?: number;
}

/**
 * Record work that belongs to no project (SPEC §4.14, §7.1 `log_unlisted_work`).
 *
 * **The one write with no REST twin** (D-024): a human at the board would file a
 * task, so there is no human path to mirror. That is why §13.3's parity tests
 * exempt this tool, and the exemption is named rather than inferred.
 *
 * `unlisted.log_own` is ✓ for every org role — it is your own record about your
 * own work, creating nothing in any project. A `read_only` token is still
 * refused, because the action is not in `READ_ACTIONS` and `tokenAllows` denies
 * every non-read action to such a token. That is the whole of §3.1's new row.
 *
 * The token id is recorded beside the user id so triage can tell *which* agent
 * session noticed it — §4.14 has the column and nothing was filling it.
 */
export function logUnlistedWork(
  db: Db,
  actor: ResolvedActor,
  input: LogUnlistedWorkInput,
): UnlistedView {
  assertCan(actor, 'unlisted.log_own');

  const now = input.now ?? Date.now();
  const repo = input.repo.trim();
  const note = input.note.trim();

  if (repo === '' || note === '') {
    throw new ApiError('unprocessable', 'Unlisted work needs a repo and a note', {
      repo: input.repo,
      note_length: input.note.length,
    });
  }

  const row: typeof unlistedWork.$inferInsert = {
    id: newId(),
    userId: actor.userId,
    // Null on a cookie-authenticated call, which is possible today and will be
    // the normal case if a human ever gets a way to log one.
    tokenId: actor.token?.id ?? null,
    repo,
    note,
    promotedTaskId: null,
    dismissedAt: null,
    createdAt: now,
  };

  db.insert(unlistedWork).values(row).run();

  appendActivity(db, {
    orgId: requireOrgId(db),
    // `project_id IS NULL` — §3.1 names `unlisted.logged` as one of the
    // org-scoped audit rows, which is what routes reading it to the audit cell.
    projectId: null,
    ...activityActor(actor),
    type: 'unlisted.logged',
    payload: { entity: 'unlisted', action: 'logged', unlisted_id: row.id, repo },
    now,
  });

  return toView(readBack(db, row.id));
}

export interface ListUnlistedOptions {
  /** `?user=` — one person's pile. */
  userId?: string | undefined;
  /** `?since=` — unix-ms, inclusive, matching §6.3's `updated_since` semantic. */
  since?: number | undefined;
  /**
   * Dismissed rows are **out by default**.
   *
   * The pile is a to-do list for a person triaging; a dismissed row has been
   * triaged. It stays readable behind an explicit flag rather than being
   * deleted, because "we looked at this and decided no" is worth keeping.
   */
  includeDismissed?: boolean | undefined;
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
}

/**
 * The pile, newest first.
 *
 * Newest-first because it is a feed of things noticed, read from the top — the
 * same order as the activity feed and the opposite of `listComments`, for the
 * reason given there.
 */
export function listUnlisted(
  db: Db,
  actor: ResolvedActor,
  options: ListUnlistedOptions,
): UnlistedView[] {
  assertCan(actor, 'audit_log.export');

  const conditions: SQL[] = [];

  if (options.userId !== undefined) conditions.push(eq(unlistedWork.userId, options.userId));
  if (options.since !== undefined) conditions.push(gte(unlistedWork.createdAt, options.since));
  if (options.includeDismissed !== true) conditions.push(isNull(unlistedWork.dismissedAt));

  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(unlistedWork.createdAt, key),
        and(eq(unlistedWork.createdAt, key), lt(unlistedWork.id, options.cursor.id)),
      )!,
    );
  }

  return db
    .select()
    .from(unlistedWork)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(unlistedWork.createdAt), desc(unlistedWork.id))
    .limit(options.limit + 1)
    .all()
    .map(toView);
}

export interface PromoteUnlistedInput {
  projectSlug: string;
  title: string;
  priority?: TaskPriority | undefined;
  now?: number;
}

export interface PromotedUnlisted {
  unlisted: UnlistedView;
  task: TaskView;
}

/**
 * Turn a note into a real task.
 *
 * The task is created by **`createTask`**, not by an insert here. That is what
 * makes §13.3's MCP/REST parity a property of the structure rather than a hope:
 * a task promoted from the pile goes through the same numbering, the same
 * validation, the same `can()` and the same `task.created` activity row as one
 * created any other way. A second insert path would drift from all four.
 *
 * **`created_via: 'mcp'` is preserved**, because §4.14 says so: the work was
 * noticed by an agent, and the resulting task should say where it came from
 * rather than claiming a person typed it into the web UI.
 */
export function promoteUnlisted(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  id: string,
  input: PromoteUnlistedInput,
): PromotedUnlisted {
  assertCan(actor, 'audit_log.export');

  const row = requireUnlisted(db, id);
  const now = input.now ?? Date.now();

  // Refused before the task is created, not after: a second promote that made a
  // second task and then failed would leave the duplicate behind.
  if (row.promotedTaskId !== null) {
    throw new ApiError('conflict', 'That note has already been promoted', {
      unlisted_id: row.id,
      task_id: row.promotedTaskId,
    });
  }

  if (row.dismissedAt !== null) {
    throw new ApiError('conflict', 'That note was dismissed', { unlisted_id: row.id });
  }

  return immediateTransaction(sqlite, () => {
    // `createTask` asserts `task.write` in the named project — the second of the
    // two checks, in the layer that owns it.
    const task = createTask(sqlite, db, actor, input.projectSlug, {
      title: input.title,
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      // §4.14: provenance preserved. An agent noticed this.
      created_via: 'mcp',
      description_md: promotionNote(row),
      now,
    });

    db.update(unlistedWork)
      .set({ promotedTaskId: task.id })
      .where(eq(unlistedWork.id, row.id))
      .run();

    appendActivity(db, {
      orgId: requireOrgId(db),
      // Org-scoped, like the `unlisted.logged` row it follows: the pile belongs
      // to no project even when what it becomes does.
      projectId: null,
      ...activityActor(actor),
      type: 'unlisted.promoted',
      // **The `entity` / `action` payload stays, and that is not redundancy.**
      // `activity` is append-only in both directions, so every row written before
      // LAI-113 carries the old verb and is distinguishable *only* by those two
      // fields. Migrating them is not an option and not a shortcut declined — it
      // is the property the table exists to have. New rows carry both, which costs
      // a few bytes and means one payload shape across the whole table.
      payload: {
        entity: 'unlisted',
        action: 'promoted',
        unlisted_id: row.id,
        task_id: task.id,
        project_slug: input.projectSlug,
      },
      now,
    });

    return { unlisted: toView(readBack(db, row.id)), task };
  });
}

/**
 * Triaged and rejected.
 *
 * Idempotent, and the second call writes **no** activity row: nothing changed,
 * and this codebase already refuses a no-op status transition on exactly that
 * ground. Same rule as revoking a token twice (LAI-402).
 */
export function dismissUnlisted(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
): UnlistedView {
  assertCan(actor, 'audit_log.export');

  const row = requireUnlisted(db, id);
  if (row.dismissedAt !== null) return toView(row);

  if (row.promotedTaskId !== null) {
    throw new ApiError('conflict', 'That note became a task and cannot be dismissed', {
      unlisted_id: row.id,
      task_id: row.promotedTaskId,
    });
  }

  db.update(unlistedWork).set({ dismissedAt: now }).where(eq(unlistedWork.id, row.id)).run();

  appendActivity(db, {
    orgId: requireOrgId(db),
    projectId: null,
    ...activityActor(actor),
    type: 'unlisted.dismissed',
    // **The `entity` / `action` payload stays, and that is not redundancy.**
    // `activity` is append-only in both directions, so every row written before
    // LAI-113 carries the old verb and is distinguishable *only* by those two
    // fields. Migrating them is not an option and not a shortcut declined — it
    // is the property the table exists to have. New rows carry both, which costs
    // a few bytes and means one payload shape across the whole table.
    payload: { entity: 'unlisted', action: 'dismissed', unlisted_id: row.id },
    now,
  });

  return toView(readBack(db, row.id));
}

// ------------------------------------------------------------------ helpers

function requireUnlisted(db: Db, id: string): UnlistedRow {
  const row = db.select().from(unlistedWork).where(eq(unlistedWork.id, id)).get();
  if (row === undefined) throw ApiError.notFound(`No unlisted work with id "${id}"`);
  return row;
}

function readBack(db: Db, id: string): UnlistedRow {
  return db.select().from(unlistedWork).where(eq(unlistedWork.id, id)).get()!;
}

/**
 * The note becomes the task's description, with where it came from.
 *
 * Rather than discarding it: the agent's sentence is the only record of *why*
 * this was worth noticing, and a task titled by a triaging human with no body
 * loses exactly the thing the pile existed to keep.
 */
function promotionNote(row: UnlistedRow): string {
  return `${row.note}\n\n_Promoted from unlisted work in \`${row.repo}\`._`;
}
