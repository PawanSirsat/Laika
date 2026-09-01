import type Database from 'better-sqlite3';
import { type Db } from '../db/client.ts';
import { type Logger } from '../log.ts';
import { snapshot } from './backup.ts';
import {
  expireInvites,
  expireMeetingReviews,
  flagStaleTasks,
  pruneHeartbeats,
  vacuum,
  type JobResult,
} from './jobs.ts';

/**
 * §11.6's one interval-driven scheduler, in the same process (LAI-431, D-002).
 *
 * ## A job that throws does not stop the scheduler
 *
 * Each run is wrapped and logged on its own. A `VACUUM` that fails because the
 * disk is full must not stop retention from running tomorrow, and a bug in one
 * job must not silently end all six — which is what an unhandled rejection in a
 * shared timer would do. The next tick still happens.
 *
 * ## It must be stopped by the shutdown path
 *
 * An interval outlives the server that started it and holds the process open, so
 * `stop()` is wired into `shutdown.ts`'s teardown. LAI-142 is the standing
 * evidence that shutdown here is easy to get wrong: a stream nobody closed cost
 * a ten-second stall that looked like a network fault.
 *
 * `unref()` as well as `clearInterval` — belt and braces, because a timer that
 * is only unref'd still fires if anything else keeps the loop alive, and one
 * that is only cleared leaks if `stop()` is never reached.
 *
 * ## Time is injected
 *
 * Every job takes `now` from the scheduler's clock, not from `Date.now()`
 * directly, so a test can prove "31 days old is deleted, 29 is not" without
 * sleeping and without fabricating rows whose timestamps the test also controls.
 */

export interface SchedulerDeps {
  db: Db;
  sqlite: Database.Database;
  log: Logger;
  /** `$DATA_DIR/backups/` (§11.6). */
  backupDir: string;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (handle: unknown) => void;
}

export interface Job {
  readonly name: string;
  readonly everyMs: number;
  readonly run: (now: number) => JobResult | Promise<JobResult>;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The six jobs and their intervals (§11.6). */
export function buildJobs(deps: SchedulerDeps): Job[] {
  const { db, sqlite, backupDir } = deps;

  return [
    {
      name: 'backup.snapshot',
      everyMs: DAY,
      run: (now) => snapshot({ sqlite, dir: backupDir }, now),
    },
    { name: 'heartbeat.retention', everyMs: DAY, run: (now) => pruneHeartbeats(db, now) },
    { name: 'task.stale', everyMs: DAY, run: (now) => flagStaleTasks(db, now) },
    { name: 'invite.expiry', everyMs: HOUR, run: (now) => expireInvites(db, now) },
    { name: 'meeting_review.expiry', everyMs: HOUR, run: (now) => expireMeetingReviews(db, now) },
    { name: 'db.vacuum', everyMs: 7 * DAY, run: () => vacuum(db) },
  ];
}

export interface Scheduler {
  /** Run one job by name, now. Exists so a test drives a job through the real path. */
  runOnce: (name: string) => Promise<JobResult | undefined>;
  /** Every job, in order, isolated from each other. */
  runAll: () => Promise<void>;
  stop: () => void;
}

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer =
    deps.clearTimer ??
    ((h) => {
      clearInterval(h as NodeJS.Timeout);
    });

  const jobs = buildJobs(deps);
  const handles: unknown[] = [];

  async function runIsolated(job: Job): Promise<JobResult | undefined> {
    try {
      const result = await job.run(now());
      // Only when it did something: a nightly line saying "deleted 0" in every
      // log for a year is how the one that says 40000 goes unnoticed.
      if (result.changed > 0)
        deps.log.info('cron.job_ran', { job: job.name, changed: result.changed });

      return result;
    } catch (err) {
      // Swallowed **on purpose**, and logged rather than rethrown: one failing
      // job must not take the other five with it, nor the process.
      deps.log.error('cron.job_failed', {
        job: job.name,
        error: err instanceof Error ? err.message : String(err),
      });

      return undefined;
    }
  }

  for (const job of jobs) {
    const handle = setTimer(() => {
      void runIsolated(job);
    }, job.everyMs);
    handle.unref?.();
    handles.push(handle);
  }

  return {
    runOnce: async (name) => {
      const job = jobs.find((j) => j.name === name);
      return job === undefined ? undefined : runIsolated(job);
    },
    runAll: async () => {
      // In sequence, not in parallel: one process, one database, one writer
      // (D-002). Overlapping a VACUUM with a delete is not something to discover.
      for (const job of jobs) await runIsolated(job);
    },
    stop: () => {
      for (const handle of handles) clearTimer(handle);
      handles.length = 0;
    },
  };
}
