import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { heartbeats, invites, meetingReviews, orgs, tasks } from '../db/schema.ts';

/**
 * The six jobs §11.6 specifies, as plain functions (LAI-431).
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
 * ## Four of the six write activity, and two deliberately do not
 *
 * §4.8's D-022 note names exactly which cron jobs write: **heartbeat pruning,
 * stale-task flagging, invite and meeting-review expiry**. The nightly snapshot
 * and the weekly vacuum are not among them, and that is right — a backup is not
 * a change to the product's history and `VACUUM` changes no row. Writing them
 * would put two entries a week in every reader's feed saying nothing happened.
 * Said here because a reader finding no `appendActivity` in those two would
 * otherwise assume it was forgotten (the LAI-417 shape).
 *
 * ## `heartbeats` may be deleted from; `activity` may not
 *
 * They look alike and exactly one of them is append-only. §4.8 has **no
 * retention** and its triggers make a delete impossible — the failure this file
 * could cause that nothing else can is getting that backwards.
 */

/** 30 days, §11.6. */
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
 */
export function flagStaleTasks(db: Db, now: number): JobResult {
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
export function vacuum(db: Db): JobResult {
  db.run(sql`VACUUM`);
  return { changed: 0 };
}
