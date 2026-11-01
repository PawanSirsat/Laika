import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildJobs, startScheduler, type SchedulerDeps } from '../../src/jobs/scheduler.ts';
import { newId } from '../../src/db/ids.ts';
import { eq } from 'drizzle-orm';
import {
  activity,
  handoffOffers,
  heartbeats,
  localActivityDays,
  projects,
  taskClaims,
  users,
} from '../../src/db/schema.ts';
import { applyCheckpointDelivery, registerCheckpoint } from '../../src/services/checkpoints.ts';
import { offerHandoff } from '../../src/services/handoffs.ts';
import { loadActor, resolveTokenActor } from '../../src/auth/resolve-actor.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { configureClaims, DEFAULT_CLAIM_TIMINGS } from '../../src/services/claims.ts';
import { createTask, startWorking } from '../../src/services/tasks.ts';
import { captureLog, type CapturedLog } from '../helpers/app.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

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
let seeded: Seed;

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
  seeded = seed(t.db);
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
      'checkpoint.retention',
      'claim.expiry',
      'db.vacuum',
      'estimate.refit',
      'heartbeat.retention',
      'idempotency.retention',
      'invite.expiry',
      'local_activity.retention',
      'meeting_review.expiry',
      'offer.expiry',
      'task.stale',
      'time.retention',
    ]);
  });

  it('runs time retention daily and once at boot (D-088 item 11, LAI-787)', () => {
    const day = 24 * 60 * 60 * 1000;
    const retention = buildJobs(deps()).find((j) => j.name === 'time.retention');
    expect(retention?.everyMs).toBe(day);
    expect(retention?.atStart).toBe(true);
  });

  it('refits sizes and forecasts daily and once at boot (D-085, LAI-771)', () => {
    const day = 24 * 60 * 60 * 1000;
    const refit = buildJobs(deps()).find((j) => j.name === 'estimate.refit');
    expect(refit?.everyMs).toBe(day);
    expect(refit?.atStart).toBe(true);
  });

  it('sweeps the idempotency store hourly and once at boot (LAI-534 round 2)', () => {
    const hour = 60 * 60 * 1000;
    const job = buildJobs(deps()).find((j) => j.name === 'idempotency.retention');
    expect(job?.everyMs).toBe(hour);
    // At boot, so a deploy deletes the pre-LAI-534 rows that may hold secrets.
    expect(job?.atStart).toBe(true);
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
   * **and once at boot**. So does the estimate refit (D-085), which deletes
   * nothing. Nothing else may: the heartbeat below is as stale as the local
   * row and must survive the start.
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

describe('claim.expiry across a restart (§9.1, proposal §4.2, LAI-541)', () => {
  afterEach(() => {
    configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
  });

  it('runs every scan interval, configurable per deployment', () => {
    configureClaims({ timings: { ...DEFAULT_CLAIM_TIMINGS, scanMs: 7_000 } });
    expect(buildJobs(deps()).find((j) => j.name === 'claim.expiry')?.everyMs).toBe(7_000);
    configureClaims({ timings: DEFAULT_CLAIM_TIMINGS });
    expect(buildJobs(deps()).find((j) => j.name === 'claim.expiry')?.everyMs).toBe(30_000);
  });

  it('expires nothing during the boot grace, then everything overdue on the first scan after it', async () => {
    const s = seeded;
    const owner = loadActor(t.db, s.userId)!;
    const { secret } = registerAgent(t.sqlite, t.db, owner, {
      displayName: 'Restart',
      harness: 'claude-code',
      grants: [{ projectId: s.projectId, scope: 'full' }],
    });
    const agent = resolveTokenActor(t.db, secret, NOW);
    const taskId = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Held', now: NOW }).id;
    startWorking(t.sqlite, t.db, agent, taskId, { now: NOW });

    // The server stops, and comes back twenty minutes later: every lease is overdue.
    const boot = NOW + 20 * 60_000;
    configureClaims({ bootedAt: boot });
    let clock = boot + 1_000;
    const scheduler = startScheduler(deps({ ...fakeTimers(), now: () => clock }));
    const state = () =>
      t.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).get()?.state;

    expect((await scheduler.runOnce('claim.expiry'))?.changed).toBe(0);
    expect(state()).toBe('active');

    clock = boot + DEFAULT_CLAIM_TIMINGS.heartbeatMs;
    expect((await scheduler.runOnce('claim.expiry'))?.changed).toBe(1);
    expect(state()).toBe('expired');
    scheduler.stop();
  });
});

describe('offer.expiry (§11.6, §4.73, LAI-546)', () => {
  afterEach(() => {
    configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
  });

  it('runs on the claim scan’s cadence', () => {
    configureClaims({ timings: { ...DEFAULT_CLAIM_TIMINGS, scanMs: 7_000 } });
    const jobs = buildJobs(deps());
    expect(jobs.find((j) => j.name === 'offer.expiry')?.everyMs).toBe(7_000);
    expect(jobs.find((j) => j.name === 'offer.expiry')?.everyMs).toBe(
      jobs.find((j) => j.name === 'claim.expiry')?.everyMs,
    );
  });

  it('after a restart closes an overdue offer, expires the lapsed sender and opens the recovery', async () => {
    const s = seeded;
    const owner = loadActor(t.db, s.userId)!;
    t.db.update(projects).set({ repo: 'kvell/laika' }).where(eq(projects.id, s.projectId)).run();
    const register = (name: string) =>
      registerAgent(t.sqlite, t.db, owner, {
        displayName: name,
        harness: 'claude-code',
        // Sender and receiver are two devices: one agent per harness per device (D-120).
        deviceLabel: name,
        grants: [{ projectId: s.projectId, scope: 'full' }],
      });
    const sender = register('Sender');
    const receiver = register('Receiver');
    const agent = resolveTokenActor(t.db, sender.secret, NOW);
    const taskId = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Handed', now: NOW }).id;
    startWorking(t.sqlite, t.db, agent, taskId, { now: NOW });
    const commit = 'c'.repeat(40);
    const saved = registerCheckpoint(t.sqlite, t.db, { ...agent, claimGeneration: 1 }, taskId, {
      id: newId(),
      idempotencyKey: 'restart-save',
      repo: 'kvell/laika',
      branch: 'LAI-1-work',
      commitSha: commit,
      manifest: [],
      now: NOW,
    }).checkpoint;
    applyCheckpointDelivery(
      t.sqlite,
      t.db,
      {
        deliveryId: 'restart',
        repo: 'kvell/laika',
        ref: saved.remote_ref,
        before: '0'.repeat(40),
        after: commit,
      },
      NOW,
    );
    const offered = offerHandoff(t.sqlite, t.db, { ...agent, claimGeneration: 1 }, taskId, {
      idempotencyKey: 'restart-offer',
      toAgentId: receiver.agent.id,
      checkpointId: saved.id,
      reason: 'Leaving',
      now: NOW,
    }).offer;

    // Down for an hour: the offer (30 min) and the paused lease (5 min) are both overdue.
    let clock = NOW + 60 * 60_000;
    const scheduler = startScheduler(deps({ ...fakeTimers(), now: () => clock }));
    expect((await scheduler.runOnce('offer.expiry'))?.changed).toBe(1);

    const offers = t.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, taskId)).all();
    expect(offers.map((o) => [o.id === offered.id ? 'offer' : o.kind, o.state])).toEqual([
      ['offer', 'expired'],
      ['recovery', 'open'],
    ]);
    expect(t.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).get()?.state).toBe(
      'expired',
    );
    expect(
      t.db
        .select()
        .from(activity)
        .where(eq(activity.taskId, taskId))
        .all()
        .map((r) => r.type)
        .filter((type) => type !== 'task.created'),
    ).toEqual(
      expect.arrayContaining(['task.handoff_expired', 'task.claim_expired', 'task.recovered']),
    );
    // Nothing more falls due: the next run changes nothing but the replacement's own time.
    clock += 1;
    expect((await scheduler.runOnce('offer.expiry'))?.changed).toBe(0);
    scheduler.stop();
  });
});
