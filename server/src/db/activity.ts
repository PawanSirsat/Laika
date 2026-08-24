import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { type Db } from './client.ts';
import { type ActivityType, type ActorKind } from './enums.ts';
import { newId } from './ids.ts';
import { activity, type Activity } from './schema.ts';

/**
 * The only way into `activity` (SPEC §4.8).
 *
 * This module exports `append` and readers. It exports no update and no delete,
 * and it never will — that is the point. The database enforces the same rule with
 * triggers (see `migrations/0000_initial_schema.sql`), so the guarantee survives
 * code that bypasses this module.
 *
 * One table feeds audit, presence, the dashboard and the SSE stream (§11.5).
 */

export interface AppendActivity {
  orgId: string;
  /** Null for org-scoped events such as `token.created`. */
  projectId?: string | null;
  taskId?: string | null;
  /** Null for system actors — webhooks (§6.1) and cron (§11.6). */
  actorId?: string | null;
  actorKind: ActorKind;
  actorTokenId?: string | null;
  type: ActivityType;
  payload?: unknown;
  /** Injectable so tests are not at the mercy of clock resolution. */
  now?: number;
}

/**
 * Append exactly one row.
 *
 * Callers pass their own `db`, which may be a transaction handle — every mutation
 * is supposed to write its activity row in the same transaction as the change it
 * describes, so a rolled-back write cannot leave an event claiming it happened.
 */
export function appendActivity(db: Db, entry: AppendActivity): Activity {
  const row = {
    id: newId(),
    orgId: entry.orgId,
    projectId: entry.projectId ?? null,
    taskId: entry.taskId ?? null,
    actorId: entry.actorId ?? null,
    actorKind: entry.actorKind,
    actorTokenId: entry.actorTokenId ?? null,
    type: entry.type,
    payloadJson: JSON.stringify(entry.payload ?? {}),
    createdAt: entry.now ?? Date.now(),
  };

  db.insert(activity).values(row).run();

  return row;
}

// ------------------------------------------------------------ the SSE cursor

/**
 * One row, plus the sequence number the SSE stream uses as its event id (§11.5).
 */
export interface ActivityEvent extends Activity {
  /** SQLite's `rowid`. See below for why this and not `id`. */
  seq: number;
}

/**
 * ## Why `rowid` is the stream cursor and `id` is not
 *
 * §11.5 wants a **monotonic** event id so `Last-Event-ID` can mean "everything
 * after this". A ULID is monotonic across milliseconds but not within one: the
 * `ulid` package draws fresh randomness per call, so two rows written in the same
 * millisecond sort in an order nobody chose. Once a second event sorts *below* an
 * event the client already acknowledged, a resume silently skips it — and it only
 * happens under the load where losing an event matters most.
 *
 * `rowid` is an integer SQLite assigns in insert order. It is strictly increasing
 * here and cannot be reused, because reuse requires deleting the highest row and
 * `activity` refuses every DELETE (§4.8, enforced by trigger). It survives
 * restarts, since it lives in the file.
 *
 * The cost is that the cursor is not portable: `rowid` is SQLite's, and a Postgres
 * port (D-002) would need a real sequence column. That is a migration when it
 * happens, not a reason to ship an id that is wrong today.
 */
const SEQ = sql<number>`rowid`;

export interface ListActivityFilter {
  orgId: string;
  projectId?: string;
  /**
   * Restrict to these projects — the visible set the caller worked out by asking
   * `can()` about each one (§3.3). Passing an empty array means "no projects",
   * not "all of them"; that distinction is the whole point of the option, so it
   * is handled explicitly below rather than left to `inArray`.
   */
  projectIds?: readonly string[];
  /** Also return rows with no project — the org-level half of §4.8. */
  includeOrgScoped?: boolean;
  taskId?: string;
  /** Unix-ms, inclusive lower bound — the §6.3 `updated_since` semantic. */
  since?: number;
  before?: number;
  /** Keyset position for the newest-first order below (§6.3). */
  cursor?: { createdAt: number; seq: number } | null;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Read the feed, **newest first**.
 *
 * The order is the opposite of `listComments` (LAI-047) and that is deliberate: a
 * conversation is read from the beginning, a feed is scanned from the top. Do not
 * "fix" one to match the other.
 *
 * ## The tiebreaker is `seq`, not `id`
 *
 * `(created_at, id)` is the cursor shape everywhere else in §6.3, and for `tasks`
 * or `projects` it is a total order. Here it is not: `activity` rows are written
 * inside the transaction they describe, so several land in the same millisecond
 * routinely — first-run setup writes `org.created` and `project.created` together
 * — and within one millisecond a ULID is *random*, so which of the two came
 * "first" was decided by chance on each read. It surfaced as a test that passed
 * alone and failed in a full run.
 *
 * `created_at DESC, seq DESC` keeps chronology as the primary key (a row may be
 * appended with a backdated timestamp — cron, a replayed webhook — and should
 * still sort by when it happened) and resolves ties by true insert order. It is
 * the same ordering the SSE stream delivers in, which is what makes the two
 * agree on a tie rather than merely on a set.
 *
 * Returns `ActivityEvent`, so a row read here carries the same `seq` the stream
 * puts in its `id:` field — a client can tell that a row it fetched over REST is
 * the one it already watched arrive live (§11.5).
 */
export function listActivity(db: Db, filter: ListActivityFilter): ActivityEvent[] {
  const conditions: SQL[] = [eq(activity.orgId, filter.orgId)];

  if (filter.projectId !== undefined) conditions.push(eq(activity.projectId, filter.projectId));
  if (filter.taskId !== undefined) conditions.push(eq(activity.taskId, filter.taskId));
  if (filter.since !== undefined) conditions.push(gte(activity.createdAt, filter.since));
  if (filter.before !== undefined) conditions.push(lt(activity.createdAt, filter.before));

  if (filter.projectIds !== undefined) {
    const inProjects =
      filter.projectIds.length === 0
        ? undefined
        : inArray(activity.projectId, [...filter.projectIds]);
    const orgScoped = filter.includeOrgScoped === true ? isNull(activity.projectId) : undefined;

    if (inProjects === undefined && orgScoped === undefined) {
      // Visible to nothing at all, so there is nothing to ask the database.
      // `inArray(col, [])` renders as `WHERE false` and would give the same
      // answer — this skips the round-trip, and says out loud that an empty
      // visible set means "no projects" and never "all of them".
      return [];
    }

    const scope = inProjects === undefined ? orgScoped : or(inProjects, orgScoped);
    if (scope !== undefined) conditions.push(scope);
  }

  if (filter.cursor !== null && filter.cursor !== undefined) {
    const { createdAt, seq } = filter.cursor;
    // Strictly *before* the cursor, because the order is descending.
    conditions.push(
      or(
        lt(activity.createdAt, createdAt),
        and(eq(activity.createdAt, createdAt), sql`rowid < ${seq}`),
      )!,
    );
  }

  const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  return db
    .select({ ...getTableColumns(activity), seq: SEQ })
    .from(activity)
    .where(and(...conditions))
    .orderBy(desc(activity.createdAt), sql`rowid desc`)
    .limit(limit)
    .all();
}

/** Parse a stored payload. Returns `null` rather than throwing on bad JSON. */
export function readPayload(row: Activity): unknown {
  try {
    return JSON.parse(row.payloadJson);
  } catch {
    return null;
  }
}

/** The highest sequence written so far, or 0 for an empty table. */
export function latestActivitySeq(db: Db): number {
  const row = db
    .select({ seq: sql<number | null>`max(rowid)` })
    .from(activity)
    .get();

  return row?.seq ?? 0;
}

/** How many rows a client at `afterSeq` has missed. Drives the gap decision. */
export function countActivityAfter(db: Db, afterSeq: number): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(activity)
    .where(sql`rowid > ${afterSeq}`)
    .get();

  return row?.count ?? 0;
}

/** Rows after `afterSeq` in insert order — the replay and the live tail alike. */
export function readActivityAfter(db: Db, afterSeq: number, limit: number): ActivityEvent[] {
  return db
    .select({ ...getTableColumns(activity), seq: SEQ })
    .from(activity)
    .where(sql`rowid > ${afterSeq}`)
    .orderBy(sql`rowid`)
    .limit(limit)
    .all();
}

/**
 * The row at a sequence, or `undefined`.
 *
 * Used to turn a `Last-Event-ID` the server cannot replay into the `created_at`
 * the client should pass to `?updated_since=` instead (§6.3) — without it the
 * fallback tells the client to catch up but not from when.
 */
export function activityAtSeq(db: Db, seq: number): ActivityEvent | undefined {
  return db
    .select({ ...getTableColumns(activity), seq: SEQ })
    .from(activity)
    .where(sql`rowid = ${seq}`)
    .get();
}
