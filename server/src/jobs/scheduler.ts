import type Database from 'better-sqlite3';
import { type MicrosoftSso } from '../auth/sso.ts';
import { runDirectorySync, type DirectoryDeps } from '../services/microsoft-directory.ts';
import { type Db } from '../db/client.ts';
import { type Logger } from '../log.ts';
import { type AttachmentsDeps, pruneAttachments } from '../services/attachments.ts';
import { pruneCheckpoints } from '../services/checkpoints.ts';
import { claimSettings, expireClaims } from '../services/claims.ts';
import { expireOffers } from '../services/handoffs.ts';
import { refitEstimates } from '../services/estimates.ts';
import {
  changedBy,
  HR_SYNC_EVERY_MINUTES,
  type HrSyncDeps,
  runHrSync,
} from '../services/hr-sync.ts';
import { notifyEmail, pruneEmailDigests } from '../services/email-notify.ts';
import {
  CALENDAR_SYNC_EVERY_MINUTES,
  type CalendarSyncDeps,
  changedBy as calendarChanged,
  runCalendarSync,
} from '../services/calendar-sync.ts';
import {
  changedBy as emailChangedBy,
  type EmailOutboxDeps,
  pruneEmailOutbox,
  runEmailOutbox,
} from '../services/email-outbox.ts';
import { runTeamsTick, TEAMS_TICK_MS, type TeamsPostingDeps } from '../services/teams-posting.ts';
import { snapshot } from './backup.ts';
import {
  expireInvites,
  pruneIdempotencyKeys,
  expireMeetingReviews,
  flagStaleTasks,
  pruneHeartbeats,
  pruneLocalActivity,
  pruneTime,
  pruneNotices,
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
 * job must not silently end all of them — which is what an unhandled rejection in a
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
  /**
   * `LAIKA_SECRET`, to read the HR system's token (D-149, LAI-1181). Absent
   * or empty, the HR sync does nothing — it never decrypts under no key.
   */
  serverSecret?: string;
  /** The HR sync's `fetch` and waits — injected by the tests, which never call Clan. */
  hr?: HrSyncDeps;
  /** The Outlook calendar sync's `fetch` and waits — injected by the tests, which never call Microsoft. */
  calendar?: CalendarSyncDeps;
  /** Microsoft SSO (LAI-1238); its `directorySync` switches the directory job on. */
  sso?: MicrosoftSso | null;
  /** The directory sync's `fetch` — injected by the tests, which never call Graph. */
  directory?: DirectoryDeps;
  /**
   * The attachments store (D-150, LAI-1300), and the `fetch` the tests inject
   * so none of them calls a store. Absent, or `config: null`, the sweep does
   * nothing.
   */
  attachments?: AttachmentsDeps;
  /**
   * The outbox's transport (D-153, LAI-1312): `smtpTransport()` from
   * `index.ts`, a recorder in the tests. Absent, the sender does nothing — no
   * test can reach a mail server by leaving it out.
   */
  email?: Omit<EmailOutboxDeps, 'now'>;
  /**
   * Teams posting's `fetch` and waits (D-154, LAI-1314) — injected by the
   * tests, which never call Teams.
   */
  teams?: TeamsPostingDeps;
  /**
   * `LAIKA_PUBLIC_URL`, for the links back a Teams post carries and every
   * link in a notification mail (LAI-1313). Empty: the mails go without a
   * link.
   */
  publicUrl?: string;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (handle: unknown) => void;
}

export interface Job {
  readonly name: string;
  readonly everyMs: number;
  readonly run: (now: number) => JobResult | Promise<JobResult>;
  /**
   * Also run once as the scheduler starts, not only after the first interval
   * (LAI-751) — for a promise that must hold on a server restarted daily,
   * where a daily interval might never come round.
   */
  readonly atStart?: boolean;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How often the outbox is drained: often enough that a mailed link is prompt. */
export const EMAIL_SEND_EVERY_MS = 30 * 1000;

/** §11.6's jobs and their intervals. */
export function buildJobs(deps: SchedulerDeps): Job[] {
  const { db, sqlite, backupDir } = deps;

  return [
    {
      name: 'backup.snapshot',
      everyMs: DAY,
      run: (now) => snapshot({ sqlite, dir: backupDir }, now),
    },
    { name: 'heartbeat.retention', everyMs: DAY, run: (now) => pruneHeartbeats(db, now) },
    {
      name: 'local_activity.retention',
      everyMs: DAY,
      run: (now) => pruneLocalActivity(db, now),
      atStart: true,
    },
    // Drafts after 30 days, entries after three years (D-088), and once at
    // boot for the reason local activity's runs then.
    { name: 'time.retention', everyMs: DAY, run: (now) => pruneTime(db, now), atStart: true },
    // Member notices after 90 days, read or not (§11.6, D-134, LAI-1136).
    { name: 'notices.retention', everyMs: DAY, run: (now) => pruneNotices(db, now) },
    // Checkpoints of tasks done or cancelled 90 days, with their refs and
    // transitions (§11.6, D-115 item 9, LAI-545). Laika never deletes a tag.
    {
      name: 'checkpoint.retention',
      everyMs: DAY,
      run: (now) => {
        const { checkpoints, orphans } = pruneCheckpoints(db, now);
        return { changed: checkpoints + orphans };
      },
    },
    { name: 'task.stale', everyMs: DAY, run: (now) => flagStaleTasks(db, now) },
    { name: 'invite.expiry', everyMs: HOUR, run: (now) => expireInvites(db, now) },
    // Expired keys, and the pre-LAI-534 rows that may hold secrets — once at
    // boot so a deploy deletes those at once.
    {
      name: 'idempotency.retention',
      everyMs: HOUR,
      run: (now) => pruneIdempotencyKeys(db, now),
      atStart: true,
    },
    { name: 'meeting_review.expiry', everyMs: HOUR, run: (now) => expireMeetingReviews(db, now) },
    // Uploads nobody finished and files nothing linked, after 24 hours, and
    // the stored objects of removed files (§11.6, D-150 item 6, LAI-1300).
    // Not `atStart`: an hour's wait costs nothing, and a boot should not wait
    // on the store. It writes no activity — nobody did it.
    {
      name: 'attachment.prune',
      everyMs: HOUR,
      run: (now) => pruneAttachments(db, deps.attachments, now),
    },
    { name: 'db.vacuum', everyMs: 7 * DAY, run: () => vacuum(db) },
    // The outbox (§4.93, D-153, LAI-1312): what is queued is sent every 30
    // seconds, under §3.4's `system.email.send`. Not `atStart`: nothing queued
    // is urgent enough to hold a boot. A run still going when the next tick
    // comes is joined, never doubled (`runEmailOutbox`). Nothing at all without
    // a transport; nothing sent while the organisation's switch is off — queued
    // rows are then recorded `suppressed` / `email_off`.
    {
      name: 'email.send',
      everyMs: EMAIL_SEND_EVERY_MS,
      run: async (now) => {
        if (deps.email === undefined) return { changed: 0 };
        const result = await runEmailOutbox(db, deps.serverSecret ?? '', {
          ...deps.email,
          now: () => now,
        });
        return { changed: emailChangedBy(result) };
      },
    },
    // Outbox rows 90 days after they were written, under `system.email.prune`,
    // daily and once at boot: deploys restart more often than daily, so a daily
    // interval alone might never come round (CHIEF's LAI-1312 review). No
    // `activity` row: nobody did it.
    {
      name: 'email.retention',
      everyMs: DAY,
      run: (now) => ({ changed: pruneEmailOutbox(db, now) + pruneEmailDigests(db, now) }),
      atStart: true,
    },
    // Assignment and mention mail, and the daily digests (§4.97 – §4.100,
    // D-153, LAI-1313), read from `activity` and `member_notices` every 30
    // seconds under `system.email.notify`. Only writes to the outbox — the
    // `email.send` job sends — so it needs no transport, and a board with
    // email off still records each instant mail as `email_off`. Not
    // `atStart`: its first run only sets the watermark.
    {
      name: 'email.notify',
      everyMs: EMAIL_SEND_EVERY_MS,
      run: (now) => {
        const result = notifyEmail(db, deps.serverSecret ?? '', deps.publicUrl ?? '', now);
        return { changed: result.instant + result.collected + result.digests };
      },
    },
    // Claims whose lease lapsed become `expired` (§9.1, proposal §4.2,
    // LAI-541), every `LAIKA_CLAIM_SCAN_SECONDS`. Not `atStart`: the boot
    // grace means the first scan after a restart could expire nothing anyway,
    // and the interval comes round within one heartbeat.
    {
      name: 'claim.expiry',
      everyMs: claimSettings().timings.scanMs,
      run: (now) => expireClaims(db, now),
    },
    // Live hand-off and recovery offers past `expires_at` become `expired`, a
    // paused sender resumes or — its lease gone — expires, and a recovery
    // opens where one is due (§11.6, §4.73, LAI-546). On the claim scan's
    // cadence. Restart-safe: `expires_at` is a stored timestamp, so the first
    // run after a restart closes everything that fell due while it was down.
    {
      name: 'offer.expiry',
      everyMs: claimSettings().timings.scanMs,
      run: (now) => expireOffers(db, now),
    },
    // Sizes and forecasts refitted from each project's history (D-085), and
    // once at boot, so a deploy starts with every task estimated.
    {
      name: 'estimate.refit',
      everyMs: DAY,
      run: (now) => refitEstimates(db, now),
      atStart: true,
    },
    // Each space's Teams stand-ups, digest and notices (D-154, LAI-1314),
    // every minute: a notice is instant to within one tick, and a scheduled
    // run goes the first tick after its time. Posting is off until an owner
    // turns it on, and then this still sends nothing for a space with no
    // channel. Not `atStart`: it waits on the network, and the next minute
    // comes round. A tick still going when the next comes is joined, never
    // doubled (`runTeamsTick`).
    {
      name: 'teams.post',
      everyMs: TEAMS_TICK_MS,
      run: async () => {
        const ticked = await runTeamsTick(db, deps.serverSecret ?? '', {
          ...deps.teams,
          publicUrl: deps.teams?.publicUrl ?? deps.publicUrl ?? null,
          log: deps.teams?.log ?? deps.log,
          // The clock itself, not the tick's instant: a post's `created_at` and
          // `finished_at` are when it was claimed and when Teams answered.
          now: deps.now ?? Date.now,
        });
        return {
          changed: ticked.sent + ticked.failed + ticked.suppressed + ticked.pruned,
        };
      },
    },
    // Members' Outlook meetings logged as their time (D-157, LAI-1316),
    // every 15 minutes; nothing unless the connection is saved **and its
    // switch is on**. Not `atStart`: a boot should not wait on Microsoft, and
    // the first tick comes within 15 minutes — so it need not be last, as the
    // HR sync below is. A run still going is joined,
    // never doubled (`runCalendarSync`); a failed read is recorded on the
    // connection and thrown here by its code alone.
    {
      name: 'calendar.sync',
      everyMs: CALENDAR_SYNC_EVERY_MINUTES * 60 * 1000,
      run: async (now) => {
        const outcome = await runCalendarSync(db, deps.serverSecret ?? '', {
          ...deps.calendar,
          now: () => now,
        });
        if (outcome.kind === 'failed') throw new Error(`calendar sync failed: ${outcome.code}`);
        return { changed: calendarChanged(outcome) };
      },
    },
    // Every enabled Member of the Microsoft directory as a Laika member
    // (LAI-1239), every 15 minutes and at boot; nothing unless
    // `LAIKA_MICROSOFT_DIRECTORY_SYNC` is on. Near the end, like the HR sync, because it
    // waits on the network — before the HR sync, which stays last. A failure throws its code alone (`DirectoryError`),
    // never a token or Graph's body.
    {
      name: 'directory.sync',
      everyMs: 15 * 60 * 1000,
      atStart: true,
      run: async (now) => {
        const result = await runDirectorySync(db, deps.sso ?? null, {
          ...deps.directory,
          now: () => now,
        });
        return { changed: result.added };
      },
    },
    // Holidays and leave from the organisation's HR system (D-149 item 7,
    // LAI-1181), every 30 minutes and at boot; nothing without a connected
    // source. **Last**, because it waits on the network and the boot runs
    // `atStart` jobs one after another. A run still going when the next tick
    // comes is joined, never doubled (`runHrSync`). A failed read is recorded
    // on the connection and thrown here by its code alone, so the log says
    // `cron.job_failed` with no token or Clan text in it.
    {
      name: 'hr.sync',
      everyMs: HR_SYNC_EVERY_MINUTES * 60 * 1000,
      atStart: true,
      run: async (now) => {
        const outcome = await runHrSync(db, deps.serverSecret ?? '', {
          ...deps.hr,
          now: () => now,
        });
        if (outcome.kind === 'failed') throw new Error(`hr sync failed: ${outcome.code}`);
        return { changed: changedBy(outcome) };
      },
    },
  ];
}

export interface Scheduler {
  /** Settles when the jobs marked `atStart` have run once. */
  started: Promise<void>;
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
      // job must not take the others with it, nor the process.
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

  // Every deploy restarts the server (D-073), so a daily interval can go a
  // long time without firing. A job that keeps a retention promise runs once
  // now as well — after this returns, so starting never waits on it.
  const atStart = Promise.resolve().then(async () => {
    for (const job of jobs) if (job.atStart === true) await runIsolated(job);
  });

  return {
    started: atStart,
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
