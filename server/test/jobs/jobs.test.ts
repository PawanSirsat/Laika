import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPayload } from '../../src/db/activity.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, heartbeats, invites, meetingReviews, tasks } from '../../src/db/schema.ts';
import {
  expireInvites,
  expireMeetingReviews,
  flagStaleTasks,
  HEARTBEAT_RETENTION_MS,
  pruneHeartbeats,
  STALE_AFTER_MS,
  vacuum,
} from '../../src/jobs/jobs.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * §11.6's jobs (LAI-431).
 *
 * **Every rule is proved against an injected `now`.** "31 days old is deleted,
 * 29 is not" cannot be written against `Date.now()` without sleeping, and a
 * fixture that fabricates both the row's timestamp and the comparison tests the
 * fixture. Here the clock is the argument, so the boundary is the assertion.
 */

const NOW = 1_800_000_000_000;

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

function activityTypes(): string[] {
  return t.db
    .select()
    .from(activity)
    .all()
    .map((r) => r.type);
}

function addHeartbeat(createdAt: number, matchedTaskId: string | null = null): string {
  const id = newId();
  t.db
    .insert(heartbeats)
    .values({
      id,
      userId: s.userId,
      tokenId: null,
      repo: 'kvell/laika',
      branch: 'main',
      matchedTaskId,
      createdAt,
    })
    .run();
  return id;
}

describe('heartbeat retention (§11.6, 30 days)', () => {
  it('deletes at 31 days and keeps at 29 — the boundary, not a sample', () => {
    addHeartbeat(NOW - 31 * 24 * 60 * 60 * 1000);
    const kept = addHeartbeat(NOW - 29 * 24 * 60 * 60 * 1000);

    expect(pruneHeartbeats(t.db, NOW).changed).toBe(1);

    const left = t.db.select().from(heartbeats).all();
    expect(left.map((r) => r.id)).toEqual([kept]);
  });

  it('keeps one exactly at the cutoff’s far side and deletes one on it', () => {
    // `lte` — a heartbeat precisely 30 days old is older than the window.
    const onCutoff = addHeartbeat(NOW - HEARTBEAT_RETENTION_MS);
    const justInside = addHeartbeat(NOW - HEARTBEAT_RETENTION_MS + 1);

    pruneHeartbeats(t.db, NOW);

    expect(
      t.db
        .select()
        .from(heartbeats)
        .all()
        .map((r) => r.id),
    ).toEqual([justInside]);
    expect(onCutoff).not.toBe(justInside);
  });

  it('writes one row per run, not per heartbeat', () => {
    for (let i = 0; i < 5; i += 1) addHeartbeat(NOW - 40 * 24 * 60 * 60 * 1000);

    expect(pruneHeartbeats(t.db, NOW).changed).toBe(5);

    // Five deletions, one audit row. One each would make the trail mostly
    // deletions of presence data while answering nothing anybody asks.
    const rows = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'heartbeat.pruned');
    expect(rows).toHaveLength(1);
    expect(readPayload(rows[0]!)).toEqual({ deleted: 5, older_than: NOW - HEARTBEAT_RETENTION_MS });
  });

  it('is idempotent — the second run changes nothing and writes nothing', () => {
    addHeartbeat(NOW - 40 * 24 * 60 * 60 * 1000);
    pruneHeartbeats(t.db, NOW);
    const after = activityTypes().length;

    expect(pruneHeartbeats(t.db, NOW).changed).toBe(0);
    expect(activityTypes()).toHaveLength(after);
  });

  it('never touches activity rows — §4.8 has no retention', () => {
    t.db
      .insert(activity)
      .values({
        id: newId(),
        orgId: s.orgId,
        projectId: null,
        taskId: null,
        actorId: null,
        actorKind: 'system',
        type: 'webhook.received',
        payloadJson: '{}',
        createdAt: NOW - 400 * 24 * 60 * 60 * 1000,
      })
      .run();

    pruneHeartbeats(t.db, NOW);

    // `heartbeats` may be deleted from and `activity` may not. They look alike,
    // and getting it backwards is the failure this file could cause that nothing
    // else can — the triggers would refuse it, loudly, which is the point.
    expect(activityTypes()).toContain('webhook.received');
  });
});

describe('every job asks before it writes (§3.3 rule 1, LAI-448)', () => {
  /**
   * **Read from the source, because the behaviour cannot show it.**
   *
   * `assertCan(SYSTEM, …)` always passes here — the principal holds the action —
   * so deleting the call changes nothing any other test in this file can see.
   * Measured: removing it from `expireInvites` left every job and policy test
   * green. That is how the rule came to be broken in eight places without
   * anybody noticing, and a check that only exercises the happy path would let
   * it happen again.
   *
   * Comments are stripped first. Both files *discuss* `assertCan` at length, and
   * a check that reads prose as code reports its own documentation (LAI-159).
   */
  const RAW = readFileSync(new URL('../../src/jobs/jobs.ts', import.meta.url), 'utf8');
  const source = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /** `vacuum` rewrites storage and touches no row — see its docblock. */
  const TOUCHES_NO_DATA = new Set(['vacuum']);

  function bodies(): Map<string, string> {
    const found = new Map<string, string>();
    const starts = [...source.matchAll(/export function ([a-zA-Z]+)\(/g)];

    for (const [i, match] of starts.entries()) {
      const from = match.index ?? 0;
      const to = starts[i + 1]?.index ?? source.length;
      found.set(match[1] ?? '', source.slice(from, to));
    }
    return found;
  }

  it('finds the job functions', () => {
    // Without this the assertions below pass over an empty map — the vacuous
    // pass this whole describe exists to prevent.
    const found = bodies();

    expect(found.size, 'no exported functions found in jobs.ts').toBeGreaterThanOrEqual(5);
    expect([...found.keys()]).toContain('pruneHeartbeats');
  });

  it('calls assertCan in every job that touches a row', () => {
    const silent = [...bodies()]
      .filter(([name]) => !TOUCHES_NO_DATA.has(name))
      .filter(([, body]) => !body.includes('assertCan('))
      .map(([name]) => `${name} writes without asking — §3.3 rule 1 has no internal path`);

    expect(silent).toEqual([]);
  });

  it('names a system action, not a human one', () => {
    // The other direction. `assertCan(SYSTEM, 'task.write')` would pass and
    // would mean the cron had quietly acquired a person's action.
    const wrong = [...bodies()]
      .filter(([name]) => !TOUCHES_NO_DATA.has(name))
      .filter(([, body]) => body.includes('assertCan('))
      .filter(([, body]) => !body.includes("assertCan(SYSTEM, 'system."))
      .map(([name]) => `${name} asks for something outside §3.4`);

    expect(wrong).toEqual([]);
  });

  it('leaves vacuum alone, and says why at the site', () => {
    const vacuumBody = bodies().get('vacuum') ?? '';

    expect(vacuumBody).not.toBe('');
    expect(vacuumBody).not.toContain('assertCan(');
    expect(RAW).toMatch(/No `assertCan`, and that is the one exception/);
  });
});

describe('stale-task flagging (§11.6, 3 days, both signals)', () => {
  function inProgressTask(updatedAt: number): string {
    const id = newId();
    t.db
      .insert(tasks)
      .values({
        id,
        projectId: s.projectId,
        number: Math.floor(Math.random() * 1_000_000) + 1,
        title: 'Under way',
        status: 'in_progress',
        priority: 'p2',
        createdBy: s.userId,
        createdVia: 'web',
        createdAt: updatedAt,
        updatedAt,
      })
      .run();
    return id;
  }

  it('flags a task with no heartbeat and no commit for 3 days', () => {
    const id = inProgressTask(NOW - 4 * 24 * 60 * 60 * 1000);

    expect(flagStaleTasks(t.db, NOW).changed).toBe(1);
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBe(NOW);
    expect(activityTypes()).toContain('task.stale_flagged');
  });

  it('does not flag a task with a recent heartbeat, even with no commit', () => {
    // §11.6 says "no heartbeat **or** commit" — an agent beating on a task it
    // has not pushed for is still somebody working on it.
    const id = inProgressTask(NOW - 10 * 24 * 60 * 60 * 1000);
    addHeartbeat(NOW - 60 * 1000, id);

    expect(flagStaleTasks(t.db, NOW).changed).toBe(0);
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBeNull();
  });

  it('does not flag a task touched recently, even with no heartbeat', () => {
    inProgressTask(NOW - 60 * 1000);

    expect(flagStaleTasks(t.db, NOW).changed).toBe(0);
  });

  it('does not flag a task that is not in_progress', () => {
    const id = inProgressTask(NOW - 30 * 24 * 60 * 60 * 1000);
    t.db.update(tasks).set({ status: 'todo' }).where(eq(tasks.id, id)).run();

    expect(flagStaleTasks(t.db, NOW).changed).toBe(0);
  });

  describe('and clears it when the task stops being stale (LAI-208)', () => {
    /**
     * Until LAI-208 nothing un-wrote `stale_flagged_at`, which did not matter
     * while the column reached no client. It is on `TaskView` now so §11.4.1 can
     * draw the marker, and a set-only flag is **a permanent mark on a task that
     * was briefly slow**: picked up, finished, shipped, still labelled as one
     * nobody is looking at.
     *
     * The job owns both directions rather than the routes clearing on a status
     * change — a handler clearing on "somebody touched it" would be a second,
     * simpler rule that can disagree with this one, which is §4.5's argument for
     * `ready` applied to a stored field.
     */
    function flaggedTask(updatedAt: number): string {
      const id = inProgressTask(updatedAt);
      expect(flagStaleTasks(t.db, NOW).changed, 'setup did not flag anything').toBe(1);
      expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBe(NOW);
      return id;
    }

    it('clears it once the task moves out of in_progress', () => {
      const id = flaggedTask(NOW - 10 * 24 * 60 * 60 * 1000);
      t.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, id)).run();

      expect(flagStaleTasks(t.db, NOW).changed).toBe(1);
      expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBeNull();
    });

    it('clears it once the task is touched again', () => {
      const id = flaggedTask(NOW - 10 * 24 * 60 * 60 * 1000);
      t.db
        .update(tasks)
        .set({ updatedAt: NOW - 60 * 1000 })
        .where(eq(tasks.id, id))
        .run();

      expect(flagStaleTasks(t.db, NOW).changed).toBe(1);
      expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBeNull();
    });

    it('clears it once an agent beats on it again', () => {
      const id = flaggedTask(NOW - 10 * 24 * 60 * 60 * 1000);
      addHeartbeat(NOW - 60 * 1000, id);

      expect(flagStaleTasks(t.db, NOW).changed).toBe(1);
      expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBeNull();
    });

    it('leaves it alone while the task is still stale', () => {
      // The property that makes the timestamp mean "since when". Re-running the
      // job must not move it, or a task stale for a month reads as stale today —
      // and a clear-then-reflag in one pass would do exactly that while still
      // reporting a non-null value to every assertion above.
      const id = flaggedTask(NOW - 10 * 24 * 60 * 60 * 1000);

      expect(flagStaleTasks(t.db, NOW + 5_000).changed).toBe(0);
      expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBe(NOW);
    });

    it('flags it again with a new timestamp if it goes quiet a second time', () => {
      // "Since when" means since *this* quiet spell. A task rescued in March and
      // abandoned in June went stale in June.
      const id = flaggedTask(NOW - 10 * 24 * 60 * 60 * 1000);
      t.db
        .update(tasks)
        .set({ updatedAt: NOW - 60 * 1000 })
        .where(eq(tasks.id, id))
        .run();
      flagStaleTasks(t.db, NOW);

      const later = NOW + 10 * 24 * 60 * 60 * 1000;
      expect(flagStaleTasks(t.db, later).changed).toBe(1);
      expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBe(later);
    });
  });

  it('flags at 3 days and one millisecond, not at 3 days less one', () => {
    const justStale = inProgressTask(NOW - STALE_AFTER_MS - 1);
    const justFresh = inProgressTask(NOW - STALE_AFTER_MS + 1);

    flagStaleTasks(t.db, NOW);

    expect(t.db.select().from(tasks).where(eq(tasks.id, justStale)).get()?.staleFlaggedAt).toBe(
      NOW,
    );
    expect(
      t.db.select().from(tasks).where(eq(tasks.id, justFresh)).get()?.staleFlaggedAt,
    ).toBeNull();
  });

  it('is idempotent, and does not refresh the date on a task already flagged', () => {
    const id = inProgressTask(NOW - 10 * 24 * 60 * 60 * 1000);
    flagStaleTasks(t.db, NOW);

    // "Since when" is the question. Rewriting it nightly would make a task stale
    // for a month look like it went stale today — and would write an audit row
    // every night saying so.
    expect(flagStaleTasks(t.db, NOW + 5 * 24 * 60 * 60 * 1000).changed).toBe(0);
    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.staleFlaggedAt).toBe(NOW);
    expect(activityTypes().filter((ty) => ty === 'task.stale_flagged')).toHaveLength(1);
  });
});

describe('invite and meeting-review expiry', () => {
  function addInvite(expiresAt: number, acceptedAt: number | null = null): string {
    const id = newId();
    t.db
      .insert(invites)
      .values({
        id,
        orgId: s.orgId,
        email: `${id}@example.test`,
        orgRole: 'member',
        projectId: null,
        projectRole: null,
        tokenHash: `${id}-hash`,
        createdBy: s.userId,
        expiresAt,
        acceptedBy: acceptedAt === null ? null : s.userId,
        acceptedAt,
        createdAt: NOW - 1000,
      })
      .run();
    return id;
  }

  function addReview(expiresAt: number, status: 'pending' | 'applied' = 'pending'): string {
    const id = newId();
    t.db
      .insert(meetingReviews)
      .values({
        id,
        projectId: s.projectId,
        source: 'upload',
        transcriptHash: `${id}-hash`,
        proposalsJson: '[]',
        status,
        reviewedBy: null,
        reviewedAt: null,
        expiresAt,
        createdAt: NOW - 1000,
      })
      .run();
    return id;
  }

  it('deletes an expired invite nobody accepted', () => {
    addInvite(NOW - 1);
    const live = addInvite(NOW + 1);

    expect(expireInvites(t.db, NOW).changed).toBe(1);
    expect(
      t.db
        .select()
        .from(invites)
        .all()
        .map((r) => r.id),
    ).toEqual([live]);
    expect(activityTypes()).toContain('invite.expired');
  });

  it('keeps an expired invite that was accepted', () => {
    // §4.11 gives invites no status, so `accepted_at` is the only record that
    // somebody joined this way. Deleting it would erase that.
    const accepted = addInvite(NOW - 1, NOW - 500);

    expect(expireInvites(t.db, NOW).changed).toBe(0);
    expect(
      t.db
        .select()
        .from(invites)
        .all()
        .map((r) => r.id),
    ).toEqual([accepted]);
  });

  it('moves a pending review to expired and leaves an applied one alone', () => {
    const pending = addReview(NOW - 1);
    const applied = addReview(NOW - 1, 'applied');

    expect(expireMeetingReviews(t.db, NOW).changed).toBe(1);
    expect(
      t.db.select().from(meetingReviews).where(eq(meetingReviews.id, pending)).get()?.status,
    ).toBe('expired');
    expect(
      t.db.select().from(meetingReviews).where(eq(meetingReviews.id, applied)).get()?.status,
    ).toBe('applied');
  });

  it('both are idempotent', () => {
    addInvite(NOW - 1);
    addReview(NOW - 1);
    expireInvites(t.db, NOW);
    expireMeetingReviews(t.db, NOW);
    const after = activityTypes().length;

    expect(expireInvites(t.db, NOW).changed).toBe(0);
    expect(expireMeetingReviews(t.db, NOW).changed).toBe(0);
    expect(activityTypes()).toHaveLength(after);
  });
});

describe('vacuum', () => {
  it('runs, changes nothing, and writes no activity row', () => {
    const before = activityTypes().length;

    expect(vacuum(t.db).changed).toBe(0);

    // Deliberately silent: §4.8's D-022 note lists the cron's writers and does
    // not include it. A weekly line saying nothing happened is noise.
    expect(activityTypes()).toHaveLength(before);
  });
});
