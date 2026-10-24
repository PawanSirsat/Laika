import { and, eq, gt, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { appendActivity } from '../db/activity.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import { type Db } from '../db/client.ts';
import { AGENT_BUCKET_MS } from '../services/agent-time.ts';
import {
  agentTimeBuckets,
  agentTimeDays,
  analyticsViews,
  heartbeats,
  invites,
  localActivityDays,
  meetingReviews,
  orgs,
  pushedCommitKeys,
  tokenArrivals,
  tokenSessionDays,
  tokenSessionSkips,
  tokenSessionTasks,
  tokenTelemetrySeries,
  tokenUsageDays,
  tasks,
  solidtimeEntries,
  timeBreaks,
  timeDrafts,
  timeDayNotes,
  timeEntries,
  timeUndo,
} from '../db/schema.ts';
import { ARRIVALS_KEPT_MS } from '../services/plan-limit.ts';
import { UNDO_WINDOW_MS } from '../services/time-undo-log.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Per-session totals, matched against telemetry (§4.38), are settled after the 31-day window. */
const SESSION_DAYS_KEPT = 40;
/** A telemetry series' state (§4.39) outlives its session by three days. */
const SERIES_KEPT_MS = 3 * DAY_MS;
/** Excluded session keys (§4.40), as long as the collector keeps its list. */
const SKIPS_KEPT_MS = 45 * DAY_MS;

/**
 * The jobs §11.6 specifies, as plain functions (LAI-431).
 *
 * Separated from the scheduler that runs them so each is callable from a test
 * with an injected `now`, which is the only way the rules can be *proved*: "a
 * heartbeat 31 days old is deleted and one 29 days old is not" cannot be written
 * against `Date.now()` without sleeping or fabricating timestamps, and a fixture
 * that fabricates them tests the fixture.
 *
 * ## Every job returns what it changed, and writes activity only if it did
 *
 * §11.6: *"Jobs are idempotent and write to `activity` only when they change
 * something."* Returning the count is what makes the second half checkable — a
 * test runs the job twice and asserts the second run returns zero and appends no
 * row, rather than reasoning about whether it would.
 *
 * ## Four write activity, and the others deliberately do not
 *
 * §4.8's D-022 note names exactly which cron jobs write: **heartbeat pruning,
 * stale-task flagging, invite and meeting-review expiry**. The nightly snapshot
 * and the weekly vacuum are not among them, and that is right — a backup is not
 * a change to the product's history and `VACUUM` changes no row. Writing them
 * would put two entries a week in every reader's feed saying nothing happened.
 * Said here because a reader finding no `appendActivity` in those two would
 * otherwise assume it was forgotten (the LAI-417 shape). Local-activity
 * retention (LAI-751) writes none either; its own comment says why.
 *
 * ## `heartbeats` may be deleted from; `activity` may not
 *
 * They look alike and exactly one of them is append-only. §4.8 has **no
 * retention** and its triggers make a delete impossible — the failure this file
 * could cause that nothing else can is getting that backwards.
 */

/** 30 days, §11.6. */
/**
 * §3.4's principal, with no project: these jobs are org-wide maintenance.
 *
 * **Every write below asks before it writes** (§3.3 rule 1, LAI-448). It did not
 * until now — eight writes, zero `assertCan`, and nothing noticed because
 * `can()` had no principal a cron could be. The grant is in `policy/can.ts` and
 * the four `system.*` actions are held by nobody else, so this cannot quietly
 * become a way to do something a person could not.
 */
const SYSTEM = systemPrincipal();

export const HEARTBEAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** 3 days with no heartbeat and no commit, §11.6. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** What a job did. `changed: 0` means it found nothing to do, not that it failed. */
export interface JobResult {
  changed: number;
}

/** The one org, or null on an instance that has not run setup yet. */
function orgId(db: Db): string | null {
  return db.select({ id: orgs.id }).from(orgs).limit(1).get()?.id ?? null;
}

/**
 * Delete heartbeats older than 30 days (§11.6).
 *
 * One activity row per **run**, not per heartbeat. Thirty days of an active org
 * is thousands of rows, and one entry each would make the audit trail mostly
 * deletions of presence data — while answering a question nobody asks. "Was
 * retention running, and how much did it take" is the question, and a count and
 * a cutoff answer it.
 */
export function pruneHeartbeats(db: Db, now: number): JobResult {
  assertCan(SYSTEM, 'system.heartbeat.prune');

  const cutoff = now - HEARTBEAT_RETENTION_MS;

  const changed = db.delete(heartbeats).where(lte(heartbeats.createdAt, cutoff)).run().changes;
  if (changed === 0) return { changed: 0 };

  const org = orgId(db);
  if (org !== null) {
    appendActivity(db, {
      orgId: org,
      projectId: null,
      actorId: null,
      actorKind: 'system',
      type: 'heartbeat.pruned',
      payload: { deleted: changed, older_than: cutoff },
      now,
    });
  }

  return { changed };
}

/**
 * D-079 and D-084: a developer's local counts, commit keys and token usage are
 * kept 400 days (§11.6).
 */
export const LOCAL_ACTIVITY_RETENTION_DAYS = 400;

/**
 * Delete local-activity rows, pushed-commit keys and token usage older than
 * 400 days (§11.6, D-079, LAI-751, D-084), and the log of who looked at them
 * (§4.59, LAI-957). Daily, and once at boot
 * (`scheduler.ts`), so a server that was down on the day still keeps the
 * promise when it comes up.
 *
 * **By day, not by instant.** All three tables hold calendar dates — a machine's
 * own local ones — so the cutoff is a date: everything before the UTC date 400
 * days ago. A day's difference between zones is the whole tolerance.
 *
 * **No `activity` row, deliberately** — the backup's and the vacuum's
 * reasoning, and one more: §4.8 has no verb for it, and adding one is an
 * `activity` rebuild for a row that would only say retention ran. The count
 * is in the log line the scheduler writes when it changed something.
 */
export function pruneLocalActivity(db: Db, now: number): JobResult {
  assertCan(SYSTEM, 'system.local_activity.prune');

  const cutoff = new Date(now - LOCAL_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const changed = db.transaction((tx) => {
    const days = tx.delete(localActivityDays).where(lt(localActivityDays.day, cutoff)).run();
    const keys = tx.delete(pushedCommitKeys).where(lt(pushedCommitKeys.day, cutoff)).run();
    // Token usage (D-084 item 12) is kept as long, by the same rule — and so
    // are agent minutes and the split that ties them to cards (LAI-787).
    const tokens = tx.delete(tokenUsageDays).where(lt(tokenUsageDays.day, cutoff)).run();
    const agentTime = tx.delete(agentTimeDays).where(lt(agentTimeDays.day, cutoff)).run();
    const splits = tx.delete(tokenSessionTasks).where(lt(tokenSessionTasks.day, cutoff)).run();
    // What only matches telemetry to the files (LAI-773) is settled once the
    // collector's 31-day window has passed it: kept 40 days. The series
    // state matters while a session runs, the excluded keys as long as the
    // collector keeps its list, and the arrival rate for a week's window.
    const sessionCutoff = new Date(now - SESSION_DAYS_KEPT * DAY_MS).toISOString().slice(0, 10);
    const sessions = tx
      .delete(tokenSessionDays)
      .where(lt(tokenSessionDays.day, sessionCutoff))
      .run();
    // When the agent worked (LAI-833) is detail for My day's lane, kept as
    // long: the totals above keep the minutes for 400 days.
    const buckets = tx
      .delete(agentTimeBuckets)
      .where(
        lt(
          agentTimeBuckets.bucket,
          Math.floor((now - SESSION_DAYS_KEPT * DAY_MS) / AGENT_BUCKET_MS),
        ),
      )
      .run();
    const series = tx
      .delete(tokenTelemetrySeries)
      .where(lt(tokenTelemetrySeries.updatedAt, now - SERIES_KEPT_MS))
      .run();
    const skips = tx
      .delete(tokenSessionSkips)
      .where(lt(tokenSessionSkips.createdAt, now - SKIPS_KEPT_MS))
      .run();
    const arrivals = tx
      .delete(tokenArrivals)
      .where(lt(tokenArrivals.bucketMs, now - ARRIVALS_KEPT_MS))
      .run();
    // Who looked at a person's analytics (§4.59, LAI-957) is kept as long as
    // what they looked at, by instant: a view is a moment, not a local day.
    const views = tx
      .delete(analyticsViews)
      .where(lt(analyticsViews.viewedAt, now - LOCAL_ACTIVITY_RETENTION_DAYS * DAY_MS))
      .run();
    return (
      days.changes +
      keys.changes +
      tokens.changes +
      agentTime.changes +
      splits.changes +
      sessions.changes +
      buckets.changes +
      series.changes +
      skips.changes +
      arrivals.changes +
      views.changes
    );
  });

  return { changed };
}

/** D-088 item 11: drafts are kept 30 days. */
export const TIME_DRAFTS_RETENTION_DAYS = 30;
/** D-088 item 11 and BCEA s31: confirmed entries are kept three years. */
export const TIME_ENTRIES_RETENTION_YEARS = 3;

/**
 * Time retention (§11.6, D-088 item 11, LAI-787): drafts dated before 30 days
 * ago — pending, dismissed and confirmed alike — and entries dated before
 * three years ago, with their revisions. Daily, and once at boot. Solidtime's
 * rows (§4.54) follow: a person's go with their entry, by its foreign key,
 * and *people not on Laika* are kept three years by the same cutoff (LAI-788).
 *
 * **By day, not by instant**, as local activity's: both hold the person's
 * local dates. The entries' cutoff is three years before `now`; the trigger
 * that keeps them compares with SQLite's own `date('now', '-3 years')`
 * (`db/migrate.ts`). Run on the real clock, as the scheduler runs it, the two
 * agree; a caller whose `now` is ahead of the database's clock meets the
 * trigger, and nothing younger than three years is deleted whatever it asks.
 *
 * No `activity` row: §4.8 has no verb for it, as for local activity.
 */
export function pruneTime(db: Db, now: number): JobResult {
  assertCan(SYSTEM, 'system.time.prune');
  const draftCutoff = new Date(now - TIME_DRAFTS_RETENTION_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const at = new Date(now);
  at.setUTCFullYear(at.getUTCFullYear() - TIME_ENTRIES_RETENTION_YEARS);
  const entryCutoff = at.toISOString().slice(0, 10);
  const changed = db.transaction((tx) => {
    const drafts = tx.delete(timeDrafts).where(lt(timeDrafts.day, draftCutoff)).run();
    // Breaks go with the drafts; what Undo could put back, after minutes (LAI-831).
    const breaks = tx.delete(timeBreaks).where(lt(timeBreaks.day, draftCutoff)).run();
    const undo = tx
      .delete(timeUndo)
      .where(lt(timeUndo.createdAt, now - UNDO_WINDOW_MS))
      .run();
    const entries = tx.delete(timeEntries).where(lt(timeEntries.day, entryCutoff)).run();
    // A day's note goes with its entries (LAI-501).
    const notes = tx.delete(timeDayNotes).where(lt(timeDayNotes.day, entryCutoff)).run();
    const elsewhere = tx
      .delete(solidtimeEntries)
      .where(and(isNull(solidtimeEntries.entryId), lt(solidtimeEntries.day, entryCutoff)))
      .run();
    return (
      drafts.changes +
      breaks.changes +
      undo.changes +
      entries.changes +
      notes.changes +
      elsewhere.changes
    );
  });
  return { changed };
}

/**
 * Flag `in_progress` tasks with no heartbeat **and** no commit for 3 days.
 *
 * Both signals, per §11.6 — a task with a recent heartbeat and no commit is not
 * stale, and neither is the reverse. `tasks.branch` is where a commit last
 * touched it (§9.2); `heartbeats.matched_task_id` is where an agent last was.
 *
 * `stale_flagged_at` is set once and not refreshed while it stays stale: the
 * question is "since when", and rewriting it every night would make a task that
 * has been stale for a month look like it went stale today. That also makes the
 * job idempotent for free.
 *
 * ## And cleared when the task stops being stale (LAI-208)
 *
 * Nothing un-wrote it until now, which did not matter while the column was
 * invisible. LAI-208 puts it on `TaskView` so §11.4.1 can draw the marker, and a
 * flag that is only ever set becomes **a permanent mark on a task that was
 * briefly slow** — somebody picks it up, finishes it, ships it, and the board
 * still says nobody is looking at it.
 *
 * **The job owns the field in both directions**, rather than the routes clearing
 * it on a status change. The rule for "stale" is three conditions — status,
 * heartbeat and commit — and a handler clearing on "somebody touched it" would
 * be a *second, simpler* rule that can disagree with this one. That is §4.5's
 * argument for computing `ready` in one place, applied to a stored field.
 *
 * The cost is honest and worth naming: a task rescued at noon keeps its marker
 * until the next nightly run. A staleness signal built on a three-day window is
 * already coarse, and a marker that is a day stale is a much smaller wrong than
 * two definitions of staleness that disagree.
 *
 * A cleared task can be flagged again later, with a **new** timestamp. That is
 * the point: "since when" means since *this* quiet spell, not since the first
 * one ever.
 */
export function flagStaleTasks(db: Db, now: number): JobResult {
  assertCan(SYSTEM, 'system.task.flag_stale');

  const cutoff = now - STALE_AFTER_MS;

  const candidates = db
    .select({ id: tasks.id, projectId: tasks.projectId, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(and(eq(tasks.status, 'in_progress'), isNull(tasks.staleFlaggedAt)))
    .all();

  const org = orgId(db);
  let changed = 0;

  for (const task of candidates) {
    const beat = db
      .select({ id: heartbeats.id })
      .from(heartbeats)
      .where(and(eq(heartbeats.matchedTaskId, task.id), gt(heartbeats.createdAt, cutoff)))
      .get();
    if (beat !== undefined) continue;

    // A commit shows up as the task being touched — §10.1's `push` handler moves
    // `updated_at` when it links a commit. Until webhooks land that is also true
    // of any human edit, which is the safe direction: a task somebody touched
    // yesterday is not one nobody is looking at.
    if (task.updatedAt > cutoff) continue;

    db.update(tasks).set({ staleFlaggedAt: now }).where(eq(tasks.id, task.id)).run();
    changed += 1;

    if (org !== null) {
      appendActivity(db, {
        orgId: org,
        projectId: task.projectId,
        taskId: task.id,
        actorId: null,
        actorKind: 'system',
        type: 'task.stale_flagged',
        payload: { no_activity_since: task.updatedAt },
        now,
      });
    }
  }

  // The other direction. A task carrying the flag that now fails *any* of the
  // three staleness conditions is no longer stale, so the mark comes off.
  const flagged = db
    .select({ id: tasks.id, status: tasks.status, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(isNotNull(tasks.staleFlaggedAt))
    .all();

  for (const task of flagged) {
    const quiet =
      task.status === 'in_progress' &&
      task.updatedAt <= cutoff &&
      db
        .select({ id: heartbeats.id })
        .from(heartbeats)
        .where(and(eq(heartbeats.matchedTaskId, task.id), gt(heartbeats.createdAt, cutoff)))
        .get() === undefined;
    if (quiet) continue;

    db.update(tasks).set({ staleFlaggedAt: null }).where(eq(tasks.id, task.id)).run();
    changed += 1;
  }

  return { changed };
}

/**
 * Remove invites past `expires_at` that nobody accepted (§4.11).
 *
 * **Accepted invites are kept.** They are the record of how somebody joined, and
 * §4.11 gives the table no status column — so an accepted invite is one with
 * `accepted_at` set, and deleting it would erase that.
 */
export function expireInvites(db: Db, now: number): JobResult {
  assertCan(SYSTEM, 'system.invite.expire');

  const doomed = db
    .select({ id: invites.id, orgId: invites.orgId })
    .from(invites)
    .where(and(lte(invites.expiresAt, now), isNull(invites.acceptedAt)))
    .all();

  if (doomed.length === 0) return { changed: 0 };

  db.delete(invites)
    .where(and(lte(invites.expiresAt, now), isNull(invites.acceptedAt)))
    .run();

  appendActivity(db, {
    orgId: doomed[0]!.orgId,
    projectId: null,
    actorId: null,
    actorKind: 'system',
    type: 'invite.expired',
    payload: { deleted: doomed.length },
    now,
  });

  return { changed: doomed.length };
}

/** `pending` → `expired` past `expires_at` (§4.12: proposals expire after 7 days). */
export function expireMeetingReviews(db: Db, now: number): JobResult {
  assertCan(SYSTEM, 'system.meeting_review.expire');

  const doomed = db
    .select({ id: meetingReviews.id, projectId: meetingReviews.projectId })
    .from(meetingReviews)
    .where(and(eq(meetingReviews.status, 'pending'), lte(meetingReviews.expiresAt, now)))
    .all();

  if (doomed.length === 0) return { changed: 0 };

  const org = orgId(db);

  for (const review of doomed) {
    db.update(meetingReviews)
      .set({ status: 'expired' })
      .where(eq(meetingReviews.id, review.id))
      .run();

    if (org !== null) {
      appendActivity(db, {
        orgId: org,
        projectId: review.projectId,
        actorId: null,
        actorKind: 'system',
        type: 'meeting_review.expired',
        payload: { meeting_review_id: review.id },
        now,
      });
    }
  }

  return { changed: doomed.length };
}

/**
 * `VACUUM` (§11.6, weekly).
 *
 * No activity row: it changes no row a reader cares about, and §4.8's D-022 note
 * does not list it among the cron's writers. `changed` is 0 for the same reason
 * — nothing in the product changed.
 */
/**
 * **No `assertCan`, and that is the one exception in this file worth arguing.**
 *
 * §3.3 rule 1 governs reading and writing *data*. `VACUUM` rewrites the storage
 * file and touches no row — no org's data is read, changed or revealed by it,
 * and there is no resource to name in a `can()` call. Inventing
 * `system.database.vacuum` to satisfy the shape of the rule would add a
 * permission that grants nothing and has to be maintained for ever.
 *
 * The other four jobs in this file do touch rows, and every one of them asks.
 */
export function vacuum(db: Db): JobResult {
  db.run(sql`VACUUM`);
  return { changed: 0 };
}
