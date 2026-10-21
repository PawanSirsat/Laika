import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { readPayload } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { activity, type Activity } from '../db/schema.ts';

/**
 * Bulk moves: imports and sweeps, recognised by one rule (D-093, LAI-823).
 *
 * **A row is a bulk move when its actor moved, or created, more than
 * {@link BULK_MOVE_TASKS} distinct tasks within one {@link BULK_MOVE_WINDOW_MS}
 * window that contains it** — status changes and creations counted apart. Such
 * a row is still recorded and still shown in the feed, marked `bulk`; it is
 * left out of throughput, cycle time, the sprint forecast and the heatmap,
 * because a sweep is bookkeeping and not work.
 *
 * ## Why 10 in a minute
 *
 * Measured on production's whole activity log on 2026-10-21 (7,233 rows),
 * per actor, the most distinct tasks in any 60 s:
 *
 * - **the known sweeps** — 09-20 and 09-21 (the import), 10-07 (bulk done),
 *   10-15 (the Laika mirror) — peak at **19 to 73**;
 * - **ordinary work** — an agent claiming and finishing, a person triaging a
 *   column — peaks at **10 or fewer**; two runs reached 11, both mirror passes.
 *
 * So more than 10 sits in the gap with the sweeps above it and the work below.
 *
 * ## Distinct tasks, not rows
 *
 * An agent's claim and finish of one task are two status changes seconds
 * apart. Counting rows would weigh that as two; it is one task's work.
 *
 * ## A whole window, not a trailing one
 *
 * A row is bulk when **any** minute containing it is a sweep, so the first ten
 * moves of a sweep are bulk too. `activity` is append-only (§4.8), so this
 * cannot be written on the row when it is appended — the later rows that make
 * it a sweep do not exist yet. It is computed on read, from the rows a minute
 * either side, by {@link bulkIds} alone, so every figure applies the same rule.
 *
 * ## A creation into done
 *
 * A task created already done has no move into done; its creation is its
 * completion (D-093 item 1). A completion is bulk when the row that made it —
 * the move into done, or the creation — is a bulk row, which is how Laika's
 * mirror on 10-15 is left out though none of its tasks ever moved.
 */

/** More than this many distinct tasks by one actor in the window is a sweep. */
export const BULK_MOVE_TASKS = 10;
/** The window, in milliseconds. */
export const BULK_MOVE_WINDOW_MS = 60_000;

/** The rows the rule reads: moves and creations. */
const BULK_TYPES = ['task.status_changed', 'task.created'] as const;

export interface BulkCandidate {
  readonly id: string;
  readonly actorId: string | null;
  readonly taskId: string | null;
  readonly type: string;
  readonly createdAt: number;
}

/** The ids of the bulk rows among these, by the rule above. Pure. */
export function bulkIds(rows: readonly BulkCandidate[]): Set<string> {
  const groups = new Map<string, BulkCandidate[]>();
  for (const row of rows) {
    // A system row has no actor (§4.8), and no person swept anything.
    if (row.actorId === null || row.taskId === null) continue;
    if (!(BULK_TYPES as readonly string[]).includes(row.type)) continue;
    const key = `${row.actorId}\u0000${row.type}`;
    let group = groups.get(key);
    if (group === undefined) groups.set(key, (group = []));
    group.push(row);
  }

  const bulk = new Set<string>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.createdAt - b.createdAt);
    // Every window worth asking about starts at a row: for each start, the
    // rows inside the minute, with how many times each task appears.
    const inWindow = new Map<string, number>();
    let end = 0;
    let marked = 0;
    for (let start = 0; start < group.length; start += 1) {
      while (
        end < group.length &&
        group[end]!.createdAt - group[start]!.createdAt < BULK_MOVE_WINDOW_MS
      ) {
        const task = group[end]!.taskId!;
        inWindow.set(task, (inWindow.get(task) ?? 0) + 1);
        end += 1;
      }
      if (inWindow.size > BULK_MOVE_TASKS) {
        for (let i = Math.max(start, marked); i < end; i += 1) bulk.add(group[i]!.id);
        marked = end;
      }
      const task = group[start]!.taskId!;
      const left = inWindow.get(task)! - 1;
      if (left === 0) inWindow.delete(task);
      else inWindow.set(task, left);
    }
  }
  return bulk;
}

/** The candidate rows from `from` to `to`, and a window either side. */
function candidatesAround(
  db: Db,
  orgId: string,
  from: number,
  to: number,
  actorId?: string,
): Activity[] {
  return db
    .select()
    .from(activity)
    .where(
      and(
        // One person's rows go through the actor's index; `+` keeps the org
        // out of index selection, as `listActivity` does (LAI-722).
        ...(actorId === undefined
          ? [eq(activity.orgId, orgId)]
          : [sql`+${activity.orgId} = ${orgId}`, eq(activity.actorId, actorId)]),
        inArray(activity.type, [...BULK_TYPES]),
        gte(activity.createdAt, from - BULK_MOVE_WINDOW_MS),
        lte(activity.createdAt, to + BULK_MOVE_WINDOW_MS),
      ),
    )
    .all();
}

/** The bulk rows written from `from` to `to`, inclusive — optionally one actor's. */
export function bulkRowsBetween(
  db: Db,
  orgId: string,
  from: number,
  to: number,
  actorId?: string,
): Activity[] {
  const rows = candidatesAround(db, orgId, from, to, actorId);
  const bulk = bulkIds(rows);
  return rows.filter((r) => bulk.has(r.id) && r.createdAt >= from && r.createdAt <= to);
}

/** Which of these feed rows are bulk moves — for marking the feed. */
export function bulkAmong(db: Db, rows: readonly Activity[]): Set<string> {
  const byOrg = new Map<string, number[]>();
  for (const r of rows) {
    if (!(BULK_TYPES as readonly string[]).includes(r.type)) continue;
    const span = byOrg.get(r.orgId);
    if (span === undefined) byOrg.set(r.orgId, [r.createdAt, r.createdAt]);
    else {
      span[0] = Math.min(span[0]!, r.createdAt);
      span[1] = Math.max(span[1]!, r.createdAt);
    }
  }
  const bulk = new Set<string>();
  for (const [orgId, [from, to]] of byOrg) {
    for (const r of bulkRowsBetween(db, orgId, from!, to!)) bulk.add(r.id);
  }
  return bulk;
}

/** Did this row bring its task into done — a move into done, or a creation? */
function completes(row: Activity): boolean {
  if (row.type === 'task.created') return true;
  const payload = readPayload(row) as { from?: unknown; to?: unknown } | null;
  return payload?.to === 'done' && payload.from !== 'done';
}

/**
 * The tasks among these whose completion was a bulk move: a bulk row for the
 * task, at its `completed_at`, that brought it into done. Both writers stamp
 * `completed_at` with the row's own time (`tasks.ts`), and LAI-822's backfill
 * copies the row's or the creation's, so equality is exact.
 */
export function bulkCompletions(
  db: Db,
  orgId: string,
  done: readonly { id: string; completedAt: number | null }[],
): Set<string> {
  const at = done.filter((d) => d.completedAt !== null);
  if (at.length === 0) return new Set();
  const times = at.map((d) => d.completedAt!);
  const from = Math.min(...times);
  const to = Math.max(...times);
  const completedAt = new Map(at.map((d) => [d.id, d.completedAt!]));

  const out = new Set<string>();
  for (const row of bulkRowsBetween(db, orgId, from, to)) {
    if (row.taskId === null || completedAt.get(row.taskId) !== row.createdAt) continue;
    if (completes(row)) out.add(row.taskId);
  }
  return out;
}
