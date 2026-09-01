import { asc, eq } from 'drizzle-orm';
import { readPayload } from './activity.ts';
import { type Db } from './client.ts';
import { activity, tasks } from './schema.ts';

/**
 * Recover `started_at` and `completed_at` from the audit trail (LAI-435).
 *
 * LAI-126 began stamping both. Every task that moved before it shipped has
 * neither — on the seeded demo, eleven `done` tasks with no dates at all — and
 * D-049's timeline draws them as sprint-derived outlines: correct, and empty of
 * history the board already holds.
 *
 * `activity` is append-only and carries `task.status_changed` with `{from, to}`
 * and a `created_at`. **The first `→ in_progress` and the last `→ done` are
 * recoverable facts, not guesses.**
 *
 * ## This is the opposite of the backfill LAI-113 forbade
 *
 * That rule is **do not rewrite `activity` rows** to hide that the vocabulary
 * was once wrong. Here `activity` is **read and never written**: it is the
 * source, and a derived column on `tasks` is what changes. An audit trail whose
 * history can be *used* is the point of keeping one; an audit trail that gets
 * edited is the thing that stops being one.
 *
 * Both will look alike to somebody skimming for the word "backfill", which is
 * why this paragraph is here rather than in the task file.
 *
 * ## Why it runs at boot rather than as a `.sql` migration
 *
 * It has to read `payload_json`, and `db/activity.ts` is the module that owns
 * that format (LAI-045). A `.sql` migration parsing it by hand would be a second
 * reader of a shape with one owner — and the first divergence would be silent.
 *
 * Running every boot is safe because it is idempotent **by construction**: it
 * only ever fills a column that is null, and a stamped value is the real one.
 * The cost is one indexed query on a table nobody has more than thousands of
 * rows in.
 *
 * ## What it will not do
 *
 * **Nothing is invented.** A task whose history does not say when it started
 * gets no date — not `created_at`, not the sprint's start, not the activity
 * row's own timestamp. D-049's outline is the correct rendering of "we do not
 * know", and a plausible date is worse than an absent one because it cannot be
 * told from a real one.
 *
 * **`completed_at` is only set on a task that is `done` now.** A task completed
 * and reopened has a completion in its history and is not complete today.
 * Whether a reopen should *clear* an existing `completed_at` is LAI-146's open
 * question, and this must not answer it by accident — so it fills nothing on a
 * task that is not currently `done`, which is silent on the question either way.
 *
 * **Only `task.status_changed` is read.** `task.updated` rows are not, and that
 * is a decision rather than an oversight: nothing in this repo writes a status
 * into a `task.updated` payload — `updateTask` writes `{ changed: [...] }` and
 * has no status field at all — so a row shaped `{ field: 'status' }` can only
 * come from data seeded outside the server. Such a row does not say *what* the
 * status became, and inferring a transition from a row that does not name one is
 * exactly the invention the paragraph above rules out. If a deployment has those
 * rows and they carry a `to`, reading them is a task with a fixture in front of
 * it, not a guess made here.
 */

interface Recovered {
  startedAt: number | null;
  completedAt: number | null;
}

/** The transitions a task's history records, oldest first. */
function transitionsByTask(db: Db): Map<string, Recovered> {
  // The whole row, because `readPayload` takes an `Activity` — reading the
  // payload through the module that owns its format is the point (LAI-045), and
  // hand-listing columns to satisfy the type would be the second reader this
  // avoids.
  const rows = db
    .select()
    .from(activity)
    .where(eq(activity.type, 'task.status_changed'))
    .orderBy(asc(activity.createdAt), asc(activity.id))
    .all();

  const found = new Map<string, Recovered>();

  for (const row of rows) {
    if (row.taskId === null) continue;

    const payload = readPayload(row);
    if (typeof payload !== 'object' || payload === null) continue;

    const to = (payload as { to?: unknown }).to;
    if (typeof to !== 'string') continue;

    const current = found.get(row.taskId) ?? { startedAt: null, completedAt: null };

    // **First** entry to `in_progress` — rework does not restart the clock, the
    // same rule `changeStatus` follows for a live task (LAI-126).
    if (to === 'in_progress' && current.startedAt === null) current.startedAt = row.createdAt;

    // **Last** arrival at `done`: rows are ordered oldest-first, so the later
    // one wins. A task done, reopened and done again finished the second time.
    if (to === 'done') current.completedAt = row.createdAt;

    found.set(row.taskId, current);
  }

  return found;
}

export interface BackfillResult {
  startedAt: number;
  completedAt: number;
}

export function backfillTaskTimestamps(db: Db): BackfillResult {
  const history = transitionsByTask(db);
  if (history.size === 0) return { startedAt: 0, completedAt: 0 };

  const needing = db
    .select({
      id: tasks.id,
      status: tasks.status,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .all()
    .filter((task) => task.startedAt === null || task.completedAt === null);

  let startedAt = 0;
  let completedAt = 0;

  for (const task of needing) {
    const found = history.get(task.id);
    if (found === undefined) continue;

    const set: { startedAt?: number; completedAt?: number } = {};

    // **Only where null.** A stamped value is the real one, and `started_at` is
    // first-entry — a backfill that moved it would silently shorten a cycle time.
    if (task.startedAt === null && found.startedAt !== null) set.startedAt = found.startedAt;
    if (task.completedAt === null && found.completedAt !== null && task.status === 'done') {
      set.completedAt = found.completedAt;
    }

    if (set.startedAt === undefined && set.completedAt === undefined) continue;

    // `updated_at` is deliberately **not** touched: this recovers what already
    // happened and is not a change anybody made. Moving it would put every
    // backfilled task at the top of an `updated_since` catch-up.
    db.update(tasks).set(set).where(eq(tasks.id, task.id)).run();

    if (set.startedAt !== undefined) startedAt += 1;
    if (set.completedAt !== undefined) completedAt += 1;
  }

  return { startedAt, completedAt };
}
