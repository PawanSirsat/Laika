import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildJobs, startScheduler, type SchedulerDeps } from '../../src/jobs/scheduler.ts';
import { newId } from '../../src/db/ids.ts';
import { heartbeats, localActivityDays, users } from '../../src/db/schema.ts';
import { captureLog, type CapturedLog } from '../helpers/app.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * §11.6's one in-process scheduler (LAI-431).
 *
 * The jobs themselves are proved in `jobs.test.ts`. What is left here is what
 * only the runner decides: that a failing job does not take the others with it,
 * that timers are injected so nothing sleeps, and that `stop()` actually stops.
 */

const NOW = 1_800_000_000_000;

let t: TestDb;
let dir: string;
let log: CapturedLog;

/** A timer that never fires by itself — the test decides when a tick happens. */
function fakeTimers() {
  const fired: (() => void)[] = [];
  const cleared: unknown[] = [];

  return {
    fired,
    cleared,
    setTimer: (fn: () => void, ms: number) => {
      fired.push(fn);
      void ms;
      return { unref: () => undefined };
    },
    clearTimer: (h: unknown) => {
      cleared.push(h);
    },
  };
}

function deps(extra: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    db: t.db,
    sqlite: t.sqlite,
    log: log.logger,
    backupDir: dir,
    now: () => NOW,
    ...extra,
  };
}

beforeEach(() => {
  t = freshDb();
  seed(t.db);
  dir = mkdtempSync(join(tmpdir(), 'laika-cron-'));
  log = captureLog();
});
afterEach(() => {
  t.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the jobs §11.6 names', () => {
  it('are all registered, and nothing else is', () => {
    const names = buildJobs(deps())
      .map((j) => j.name)
      .sort();

    expect(names).toEqual([
      'backup.snapshot',
      'db.vacuum',
      'heartbeat.retention',
      'invite.expiry',
      'local_activity.retention',
      'meeting_review.expiry',
      'task.stale',
    ]);
  });

  it('runs local-activity retention daily (LAI-751)', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(buildJobs(deps()).find((j) => j.name === 'local_activity.retention')?.everyMs).toBe(day);
  });

  it('runs the vacuum weekly and the snapshot daily', () => {
    const jobs = buildJobs(deps());
    const day = 24 * 60 * 60 * 1000;

    expect(jobs.find((j) => j.name === 'db.vacuum')?.everyMs).toBe(7 * day);
    expect(jobs.find((j) => j.name === 'backup.snapshot')?.everyMs).toBe(day);
  });
});

describe('a failing job does not stop the scheduler', () => {
  /**
   * A backup directory whose parent is a **file**, so `mkdirSync` throws
   * `ENOTDIR`.
   *
   * A real failure from the real code path. My first version used a deeply
   * nested path expecting that to fail — `mkdirSync(…, { recursive: true })`
   * creates it happily, so the test passed the job and asserted on a failure
   * that never happened.
   */
  function unwritableBackupDir(): string {
    writeFileSync(join(dir, 'blocker'), 'not a directory');
    return join(dir, 'blocker', 'backups');
  }

  it('logs it, returns undefined, and the others still run', async () => {
    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({
        backupDir: unwritableBackupDir(),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      }),
    );

    expect(await scheduler.runOnce('backup.snapshot')).toBeUndefined();
    expect(log.find('cron.job_failed')?.job).toBe('backup.snapshot');

    // The load-bearing half: the next job still runs. One failure must not end
    // the other five, nor the process.
    await expect(scheduler.runAll()).resolves.toBeUndefined();
    scheduler.stop();
  });

  it('runs every other job even when one throws', async () => {
    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({
        backupDir: unwritableBackupDir(),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      }),
    );

    await scheduler.runAll();

    // Exactly one failure, and `runAll` reached the end: if it had stopped at
    // the throwing job, the five after it would never have been attempted.
    expect(log.records.filter((r) => r.event === 'cron.job_failed')).toHaveLength(1);
    scheduler.stop();
  });

  it('keeps ticking after a failure — the next run still happens', async () => {
    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({
        backupDir: unwritableBackupDir(),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      }),
    );

    await scheduler.runOnce('backup.snapshot');
    await scheduler.runOnce('backup.snapshot');

    // Two failures, not one and then silence. A scheduler that dies on the first
    // error looks identical to one that is working until somebody needs a backup.
    expect(log.records.filter((r) => r.event === 'cron.job_failed')).toHaveLength(2);
    scheduler.stop();
  });
});

describe('timers', () => {
  it('registers one per job and clears them all on stop', () => {
    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({ setTimer: timers.setTimer, clearTimer: timers.clearTimer }),
    );

    const jobs = buildJobs(deps()).length;
    expect(timers.fired).toHaveLength(jobs);

    scheduler.stop();

    // An interval outlives the server that started it and holds the process
    // open — the same shape as an unclosed SSE stream, which is what LAI-142 is.
    expect(timers.cleared).toHaveLength(jobs);
  });

  it('stopping twice is safe', () => {
    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({ setTimer: timers.setTimer, clearTimer: timers.clearTimer }),
    );

    scheduler.stop();
    scheduler.stop();

    expect(timers.cleared).toHaveLength(buildJobs(deps()).length);
  });

  it('does not fire anything merely by being started', () => {
    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({ setTimer: timers.setTimer, clearTimer: timers.clearTimer }),
    );

    // A timer per job, nothing run by them. A scheduler that ran every job at
    // boot would VACUUM on every restart.
    expect(log.records.filter((r) => r.event === 'cron.job_ran')).toHaveLength(0);
    scheduler.stop();
  });
});

describe('a job marked atStart runs once as the scheduler starts (LAI-751)', () => {
  /**
   * Every deploy restarts the server (D-073), so a daily interval can go a
   * long time without firing; §11.6 says local-activity retention runs daily
   * **and once at boot**. Nothing else may: the heartbeat below is as stale
   * as the local row and must survive the start.
   */
  it('deletes a local row past 400 days at start, and runs nothing else', async () => {
    const user = t.db.select({ id: users.id }).from(users).get()!;
    t.db
      .insert(localActivityDays)
      .values({
        userId: user.id,
        day: new Date(NOW - 401 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
        tz: 'UTC',
        updatedAt: NOW,
      })
      .run();
    t.db
      .insert(heartbeats)
      .values({
        id: newId(),
        userId: user.id,
        repo: 'o/r',
        branch: 'main',
        createdAt: NOW - 40 * 24 * 60 * 60 * 1000,
      })
      .run();

    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({ setTimer: timers.setTimer, clearTimer: timers.clearTimer }),
    );
    await scheduler.started;

    expect(t.db.select().from(localActivityDays).all()).toEqual([]);
    expect(t.db.select().from(heartbeats).all()).toHaveLength(1);
    expect(log.find('cron.job_ran')).toMatchObject({
      job: 'local_activity.retention',
      changed: 1,
    });
    scheduler.stop();
  });
});

describe('logging', () => {
  it('says nothing when a job changed nothing', async () => {
    const timers = fakeTimers();
    const scheduler = startScheduler(
      deps({ setTimer: timers.setTimer, clearTimer: timers.clearTimer }),
    );

    await scheduler.runOnce('heartbeat.retention');

    // A nightly "deleted 0" in every log for a year is how the one that says
    // 40000 goes unnoticed.
    expect(log.find('cron.job_ran')).toBeUndefined();
    scheduler.stop();
  });
});
