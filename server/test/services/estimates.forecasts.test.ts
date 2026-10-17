import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { immediateTransaction } from '../../src/db/numbering.ts';
import {
  activity,
  orgs,
  taskClaimEstimates,
  taskRoundGithub,
  taskRounds,
  tasks,
  tokenUsageDays,
  users,
} from '../../src/db/schema.ts';
import {
  getEstimateAccuracy,
  getTaskEstimate,
  refitEstimates,
  setEstimateLogger,
  similarFinishedTasks,
} from '../../src/services/estimates.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { acceptTask, listReviewQueue, sendBackTask } from '../../src/services/review.ts';
import {
  changeStatus,
  claimTask,
  createTask,
  finishTask,
  updateTask,
} from '../../src/services/tasks.ts';
import { TOKEN_FORECAST_AFTER } from '../../src/services/token-model.ts';
import { captureLog } from '../helpers/app.ts';
import { expectSqliteError, freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Size and forecasts, phase 2 (D-085, LAI-772), in the database: token
 * forecasts beside the actuals, the agent's own estimate at claim, the
 * scope-grew note and the split suggestion, the similar past tasks an agent
 * reads, and the Review page's cue. Never a figure about a person (D-078).
 */

vi.setConfig({ testTimeout: 60_000 });

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 1);

let t: TestDb;
let adminId: string;

function makeUser(orgRole: OrgRole, name: string): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name,
      orgRole,
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

const admin = () => actor(adminId);

function words(n: number, word = 'work'): string {
  return Array.from({ length: n }, () => word).join(' ');
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Tokens one person's agent spent one day, tied to `taskId` or to nothing. */
function spend(taskId: string | null, day: string, output: number, userId = adminId): void {
  const projectId =
    taskId === null
      ? null
      : t.db.select({ p: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).get()!.p;
  t.db
    .insert(tokenUsageDays)
    .values({
      userId,
      collectorId: 'c0ffee00-0000-4000-8000-000000000001',
      day,
      agent: 'claude-code',
      model: 'claude-opus-5-5',
      taskId,
      projectId,
      input: 0,
      output,
      cacheWrite: 0,
      cacheRead: output * 10,
      updatedAt: T0,
    })
    .run();
}

const TOPICS = ['migration schema sqlite', 'board card lane', 'token scope auth', 'webhook push'];

interface Seeded {
  id: string;
  startedAt: number;
  finishedAt: number;
  size: number;
}

/**
 * `count` finished tasks, built in time proportional to their acceptance text,
 * each started after the last finished. `tokens` says what each spent, on its
 * finish day, tied to it; `unattributed` adds work tied to nothing that day.
 */
function finished(
  count: number,
  options: {
    from?: number;
    tokens?: (i: number, size: number) => number | null;
    unattributed?: (i: number) => number;
    estimate?: (i: number) => Parameters<typeof claimTask>[6];
    build?: (i: number, size: number) => number;
    text?: (i: number, size: number) => string;
  } = {},
): Seeded[] {
  return immediateTransaction(t.sqlite, () => {
    const out: Seeded[] = [];
    let clock = options.from ?? T0;
    for (let i = 0; i < count; i += 1) {
      const size = 20 + ((i * 37) % 300);
      const topic = TOPICS[i % TOPICS.length]!;
      const task = createTask(t.sqlite, t.db, admin(), 'laika', {
        title: `${topic} ${String(i)}`,
        acceptance_md: options.text?.(i, size) ?? `${topic} ${words(size)}`,
        now: clock,
      });
      const build = options.build?.(i, size) ?? Math.round(size * 0.4 * MIN);
      const startedAt = clock + MIN;
      claimTask(t.sqlite, t.db, admin(), task.id, startedAt, undefined, options.estimate?.(i));
      const finishedAt = startedAt + build;
      finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: finishedAt });
      changeStatus(t.db, admin(), task.id, 'done', finishedAt + 5 * MIN);
      const spent = options.tokens?.(i, size) ?? null;
      if (spent !== null) spend(task.id, dayOf(finishedAt), spent);
      const extra = options.unattributed?.(i) ?? 0;
      if (extra > 0) spend(null, dayOf(finishedAt), extra);
      out.push({ id: task.id, startedAt, finishedAt, size });
      clock = finishedAt + 2 * HOUR;
    }
    return out;
  });
}

/** Tokens in proportion to the work: the shape the forecast should learn. */
const proportional = (_: number, size: number) => size * 2_000;

function newTask(extra: Record<string, unknown> = {}, now = T0 + 400 * DAY) {
  return createTask(t.sqlite, t.db, admin(), 'laika', { title: 'Work', ...extra, now });
}

beforeEach(() => {
  t = freshDb();
  adminId = makeUser('admin', 'Ada');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: T0, updatedAt: T0 })
    .run();
  createProject(t.sqlite, t.db, admin(), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

// --------------------------------------------------------------- tokens

describe('token forecast: p50–p80, calibrated on attributed actuals only', () => {
  it('forecasts no tokens until ten finished tasks carry attributed token data', () => {
    const later = T0 + 300 * DAY;
    finished(12, { tokens: (i, size) => (i < TOKEN_FORECAST_AFTER - 1 ? size * 2_000 : null) });
    refitEstimates(t.db, later);
    const before = getTaskEstimate(t.db, admin(), newTask({ acceptance_md: words(100) }).id);
    expect(before.tokens.p50).toBeNull();
    expect(before.tokens.learned_from).toBe(TOKEN_FORECAST_AFTER - 1);
    expect(before.tokens.forecasts_after).toBe(TOKEN_FORECAST_AFTER);
    // Hours are there already: tokens wait for their own history.
    expect(before.size?.build_p50_ms).not.toBeNull();

    finished(1, { from: T0 + 200 * DAY, tokens: proportional });
    refitEstimates(t.db, later + DAY);
    const after = getTaskEstimate(
      t.db,
      admin(),
      newTask({ acceptance_md: words(100) }, later + 2 * DAY).id,
    );
    expect(after.tokens.learned_from).toBe(TOKEN_FORECAST_AFTER);
    expect(after.tokens.p50).toBeGreaterThan(0);
    expect(after.tokens.p80!).toBeGreaterThan(after.tokens.p50!);
  });

  it('never learns from a task whose people’s work those days was mostly unattributed', () => {
    finished(14, { tokens: proportional, unattributed: () => 3_000_000 });
    refitEstimates(t.db, T0 + 300 * DAY);
    const view = getTaskEstimate(t.db, admin(), newTask({ acceptance_md: words(100) }).id);
    expect(view.tokens.learned_from).toBe(0);
    expect(view.tokens.p50).toBeNull();
  });

  it('forecasts more tokens for a bigger task', () => {
    finished(30, { tokens: proportional });
    refitEstimates(t.db, T0 + 300 * DAY);
    const small = getTaskEstimate(t.db, admin(), newTask({ acceptance_md: words(30) }).id);
    const large = getTaskEstimate(t.db, admin(), newTask({ acceptance_md: words(600) }).id);
    expect(large.tokens.p50!).toBeGreaterThan(small.tokens.p50!);
  });

  it('is frozen at claim, as the hours are: later history moves the forecast, not the frozen copy', () => {
    finished(14, { tokens: proportional });
    refitEstimates(t.db, T0 + 300 * DAY);
    const task = newTask({ acceptance_md: words(120) });
    const forecastAtClaim = getTaskEstimate(t.db, admin(), task.id).tokens;
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 401 * DAY);
    const atStart = getTaskEstimate(t.db, admin(), task.id).at_start!;
    expect(atStart.tokens_p50).toBe(forecastAtClaim.p50);
    expect(atStart.tokens_p80).toBe(forecastAtClaim.p80);

    // Twenty more tasks that cost ten times as much.
    finished(20, { from: T0 + 100 * DAY, tokens: (_, size) => size * 20_000 });
    refitEstimates(t.db, T0 + 402 * DAY);
    updateTask(t.db, admin(), task.id, { acceptance_md: words(121), now: T0 + 403 * DAY });
    const later = getTaskEstimate(t.db, admin(), task.id, T0 + 403 * DAY);
    expect(later.tokens.p50!).toBeGreaterThan(forecastAtClaim.p50!);
    expect(later.at_start!.tokens_p50).toBe(forecastAtClaim.p50);
  });

  it('shows the build tokens beside the forecast, and the rework after a send-back apart', () => {
    finished(14, { tokens: proportional });
    refitEstimates(t.db, T0 + 300 * DAY);
    const task = newTask({ acceptance_md: words(120) });
    const start = T0 + 401 * DAY;
    claimTask(t.sqlite, t.db, admin(), task.id, start);
    spend(task.id, dayOf(start), 100_000);
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: start + HOUR });
    sendBackTask(t.sqlite, t.db, admin(), task.id, 'The empty state is missing', start + 2 * HOUR);
    spend(task.id, dayOf(start + DAY), 40_000);

    const view = getTaskEstimate(t.db, admin(), task.id, start + DAY + HOUR);
    expect(view.actual_tokens).toEqual({ build: 100_000, total: 140_000, rework: 40_000 });
  });

  it('measures the frozen token forecast against what was spent, per project', () => {
    // The history's tokens arrive after it was built, so none of it was
    // claimed under a token forecast: the one measured is the task below.
    for (const task of finished(40)) spend(task.id, dayOf(task.finishedAt), task.size * 2_000);
    refitEstimates(t.db, T0 + 300 * DAY);
    const task = newTask({ acceptance_md: words(120) });
    const start = T0 + 401 * DAY;
    claimTask(t.sqlite, t.db, admin(), task.id, start);
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: start + HOUR });
    spend(task.id, dayOf(start), 120 * 2_000);

    const accuracy = getEstimateAccuracy(t.db, admin(), 'laika');
    expect(accuracy.tokens.learned_from).toBe(40);
    expect(accuracy.tokens.forecasts_after).toBe(TOKEN_FORECAST_AFTER);
    expect(accuracy.tokens.backtest?.n).toBeGreaterThan(0);
    expect(accuracy.tokens.live.n).toBe(1);
    expect(accuracy.tokens.live.typical_error).not.toBeNull();
  });
});

// ------------------------------------------------------ the agent at claim

describe('the agent’s own estimate at claim (D-085 item 4)', () => {
  it('keeps what was said, as append-only history', () => {
    const task = newTask({ acceptance_md: words(80) });
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 401 * DAY, undefined, {
      size: 'S',
      confidence: 'green',
    });
    const view = getTaskEstimate(t.db, admin(), task.id);
    expect(view.claim_estimate).toMatchObject({ level: 'S', confidence: 'green' });
    const where = eq(taskClaimEstimates.taskId, task.id);
    expectSqliteError(
      () => t.db.update(taskClaimEstimates).set({ level: 'XL' }).where(where).run(),
      /append-only/,
    );
    expectSqliteError(() => t.db.delete(taskClaimEstimates).where(where).run(), /append-only/);
    const id = t.db.select().from(taskClaimEstimates).where(where).get()!.id;
    expectSqliteError(
      () =>
        t.sqlite
          .prepare(
            `INSERT OR REPLACE INTO task_claim_estimates (id, task_id, level, created_at) VALUES (?, ?, 'XL', 0)`,
          )
          .run(id, task.id),
      /append-only/,
    );
  });

  it('weighs nothing until it beats the project median: the frozen forecast is Laika’s own', () => {
    finished(14, { tokens: proportional });
    refitEstimates(t.db, T0 + 300 * DAY);
    const task = newTask({ acceptance_md: words(120) });
    const computed = getTaskEstimate(t.db, admin(), task.id).size!;
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 401 * DAY, undefined, { size: 'XL' });
    const view = getTaskEstimate(t.db, admin(), task.id);
    expect(view.at_start!.level).toBe(computed.computed);
    expect(view.why!.factors.some((f) => f.key === 'agent')).toBe(false);
    expect(getEstimateAccuracy(t.db, admin(), 'laika').agent.size.weight).toBe(0);
  });

  it('earns weight once the agents’ sizes beat the median, and then moves the forecast at claim', () => {
    // Same text, very different work: the text cannot tell them apart, the
    // agent can. Three kinds, so the plain median is right for only a third.
    const kinds = [
      { build: 15 * MIN, size: 'XS' },
      { build: HOUR, size: 'M' },
      { build: 4 * HOUR, size: 'XL' },
    ] as const;
    finished(30, {
      text: () => `board card lane ${words(120)}`,
      build: (i) => kinds[i % 3]!.build,
      estimate: (i) => ({ size: kinds[i % 3]!.size }),
    });
    refitEstimates(t.db, T0 + 300 * DAY);
    const score = getEstimateAccuracy(t.db, admin(), 'laika').agent.size;
    expect(score.n).toBeGreaterThanOrEqual(10);
    expect(score.agent_error!).toBeLessThan(score.median_error!);
    expect(score.weight).toBeGreaterThan(0);

    const task = newTask({
      title: 'board card lane',
      acceptance_md: `board card lane ${words(120)}`,
    });
    const computed = getTaskEstimate(t.db, admin(), task.id).size!;
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 401 * DAY, undefined, { size: 'XL' });
    const view = getTaskEstimate(t.db, admin(), task.id);
    expect(view.why!.factors.find((f) => f.key === 'agent')?.levels).toBeGreaterThan(0);
    expect(view.size!.weight).toBeGreaterThan(computed.weight);
    expect(view.at_start!.build_p50_ms!).toBeGreaterThan(computed.build_p50_ms!);
  });

  it('scores confidence against send-backs, per project, never per person', () => {
    const bea = makeUser('member', 'Bea');
    addMember(t.db, admin(), 'laika', bea, 'member');
    const said = (confidence: 'green' | 'red', sentBack: boolean, by: string, at: number) => {
      const task = newTask({ acceptance_md: words(50) }, at);
      claimTask(t.sqlite, t.db, actor(by), task.id, at + MIN, undefined, { confidence });
      finishTask(t.sqlite, t.db, actor(by), task.id, { summary: 'Done', now: at + HOUR });
      if (sentBack) sendBackTask(t.sqlite, t.db, admin(), task.id, 'Not yet', at + 2 * HOUR);
      else acceptTask(t.sqlite, t.db, admin(), task.id, at + 2 * HOUR);
    };
    said('green', false, adminId, T0);
    said('green', true, bea, T0 + DAY);
    said('red', true, bea, T0 + 2 * DAY);
    const { confidence } = getEstimateAccuracy(t.db, admin(), 'laika').agent;
    expect(confidence).toEqual([
      { confidence: 'green', n: 2, sent_back: 1 },
      { confidence: 'yellow', n: 0, sent_back: 0 },
      { confidence: 'red', n: 1, sent_back: 1 },
    ]);
    expect(JSON.stringify(getEstimateAccuracy(t.db, admin(), 'laika').agent)).not.toContain(bea);
  });

  it('ignores an estimate on a resume, which is not a claim', () => {
    const task = newTask({ acceptance_md: words(80) });
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 401 * DAY);
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 402 * DAY, undefined, { size: 'XL' });
    expect(getTaskEstimate(t.db, admin(), task.id).claim_estimate).toBeNull();
  });

  it('never costs the claim: an estimate that cannot be stored is logged, and the claim stands', () => {
    const log = captureLog();
    setEstimateLogger(log.logger);
    try {
      t.sqlite.exec(
        `CREATE TEMP TRIGGER refuse_claim_estimates BEFORE INSERT ON task_claim_estimates BEGIN SELECT RAISE(ABORT, 'forced'); END`,
      );
      const task = newTask({ acceptance_md: words(80) });
      const claimed = claimTask(t.sqlite, t.db, admin(), task.id, T0 + 401 * DAY, undefined, {
        size: 'M',
      });
      expect(claimed.status).toBe('in_progress');
      const moved = t.db
        .select()
        .from(activity)
        .where(eq(activity.taskId, task.id))
        .all()
        .filter((r) => r.type === 'task.status_changed');
      expect(moved).toHaveLength(1);
      expect(getTaskEstimate(t.db, admin(), task.id).claim_estimate).toBeNull();
      expect(log.find('estimate.failed')).toMatchObject({ what: 'claim' });
    } finally {
      t.sqlite.exec('DROP TRIGGER IF EXISTS temp.refuse_claim_estimates');
    }
  });
});

// ----------------------------------------------- scope grew, split for XL

describe('“scope grew after start”: the size rose a level after claim', () => {
  it('says so when the computed size rises a level after the claim, and not before', () => {
    finished(14);
    refitEstimates(t.db, T0 + 300 * DAY);
    const task = newTask({ acceptance_md: words(60) });
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 401 * DAY);
    expect(getTaskEstimate(t.db, admin(), task.id).scope_grew).toBeNull();

    // A word more: the same level, no note.
    updateTask(t.db, admin(), task.id, { acceptance_md: words(61), now: T0 + 402 * DAY });
    expect(getTaskEstimate(t.db, admin(), task.id).scope_grew).toBeNull();

    updateTask(t.db, admin(), task.id, { acceptance_md: words(900), now: T0 + 403 * DAY });
    const view = getTaskEstimate(t.db, admin(), task.id);
    const levels = ['XS', 'S', 'M', 'L', 'XL'];
    expect(view.scope_grew).not.toBeNull();
    expect(view.scope_grew!.from).toBe(view.at_start!.level);
    expect(levels.indexOf(view.scope_grew!.to)).toBeGreaterThan(
      levels.indexOf(view.scope_grew!.from),
    );
  });
});

describe('split suggestion for XL', () => {
  it('suggests splitting an XL task, with how many rounds XL tasks here took', () => {
    finished(14);
    // Three XL tasks, each sent back once.
    for (let i = 0; i < 3; i += 1) {
      const at = T0 + (200 + i) * DAY;
      const task = newTask({ acceptance_md: words(4000, 'scope') }, at);
      claimTask(t.sqlite, t.db, admin(), task.id, at + MIN);
      finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: at + 10 * HOUR });
      sendBackTask(t.sqlite, t.db, admin(), task.id, 'Too much at once', at + 11 * HOUR);
      finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: at + 14 * HOUR });
      acceptTask(t.sqlite, t.db, admin(), task.id, at + 15 * HOUR);
    }
    refitEstimates(t.db, T0 + 300 * DAY);
    const xl = getTaskEstimate(t.db, admin(), newTask({ acceptance_md: words(5000, 'scope') }).id);
    expect(xl.size!.level).toBe('XL');
    expect(xl.split).toEqual({ xl_finished: 3, rounds_avg: 2 });

    const small = getTaskEstimate(t.db, admin(), newTask({ acceptance_md: words(40) }).id);
    expect(small.split).toBeNull();
  });
});

// ------------------------------------------------ similar, for the agents

describe('similar finished tasks and why they were sent back', () => {
  it('lists up to five, closest first, with the send-back reasons and nobody’s name', () => {
    const bea = makeUser('member', 'Bea Lindqvist');
    addMember(t.db, admin(), 'laika', bea, 'member');
    finished(12);
    // A migration task that was sent back once before it was accepted.
    const at = T0 + 250 * DAY;
    const migration = newTask(
      { title: 'migration schema sqlite triggers', acceptance_md: 'migration schema sqlite' },
      at,
    ).id;
    claimTask(t.sqlite, t.db, actor(bea), migration, at + MIN);
    finishTask(t.sqlite, t.db, actor(bea), migration, { summary: 'Done', now: at + HOUR });
    sendBackTask(
      t.sqlite,
      t.db,
      admin(),
      migration,
      'The rebuild drops the triggers',
      at + 2 * HOUR,
    );
    finishTask(t.sqlite, t.db, actor(bea), migration, { summary: 'Done', now: at + 3 * HOUR });
    acceptTask(t.sqlite, t.db, admin(), migration, at + 4 * HOUR);
    refitEstimates(t.db, T0 + 301 * DAY);

    const task = newTask({
      title: 'migration schema sqlite rebuild',
      acceptance_md: 'migration schema sqlite',
    });
    const similar = similarFinishedTasks(t.db, admin(), task.id);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar.length).toBeLessThanOrEqual(5);
    expect(similar[0]!.key.startsWith('LAI-')).toBe(true);
    const sent = similar.find((s) => s.task_id === migration);
    expect(sent?.send_backs).toEqual([{ round: 1, reason: 'The rebuild drops the triggers' }]);
    expect(sent?.rounds).toBe(2);
    for (const s of similar) {
      expect(Object.keys(s).sort()).toEqual(
        ['key', 'rounds', 'send_backs', 'similarity', 'status', 'task_id', 'title'].sort(),
      );
    }
    expect(JSON.stringify(similar)).not.toContain(bea);
    expect(JSON.stringify(similar)).not.toContain(adminId);
  });
});

// ----------------------------------------------------- the review page cue

describe('Review page cue: finished far faster than forecast, with nothing confirmed', () => {
  function inReview(build: number, now = T0 + 401 * DAY) {
    const task = newTask({ acceptance_md: words(150) }, now - DAY);
    claimTask(t.sqlite, t.db, admin(), task.id, now);
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: now + build });
    return task.id;
  }
  const cueOf = (taskId: string) =>
    listReviewQueue(t.db, admin()).tasks.find((i) => i.task.id === taskId)!.cue;

  it('flags a round-1 finish below 0.25× the frozen p50 with no CI confirmation', () => {
    finished(14);
    refitEstimates(t.db, T0 + 300 * DAY);
    const fast = inReview(MIN);
    const cue = cueOf(fast);
    expect(cue).not.toBeNull();
    expect(cue!.kind).toBe('fast');
    expect(cue!.build_ms).toBe(MIN);
    expect(cue!.build_ms).toBeLessThan(0.25 * cue!.forecast_p50_ms);
  });

  it('says nothing at a normal pace, or before the project has hours', () => {
    const early = inReview(MIN);
    expect(cueOf(early)).toBeNull();
    finished(14);
    refitEstimates(t.db, T0 + 300 * DAY);
    const p50 = (() => {
      const probe = newTask({ acceptance_md: words(150) });
      return getTaskEstimate(t.db, admin(), probe.id).size!.build_p50_ms!;
    })();
    expect(cueOf(inReview(p50))).toBeNull();
  });

  it('says nothing once CI confirmed the round', () => {
    finished(14);
    refitEstimates(t.db, T0 + 300 * DAY);
    const fast = inReview(MIN);
    const round = t.db.select().from(taskRounds).where(eq(taskRounds.taskId, fast)).get()!;
    t.db
      .insert(taskRoundGithub)
      .values({
        roundId: round.id,
        prMerged: null,
        ciHeadSha: 'abcdef1',
        ciTotal: 2,
        ciPassed: 2,
        ciFailed: 0,
        ciPending: 0,
        ciFailedNames: '[]',
        updatedAt: T0,
      })
      .run();
    expect(cueOf(fast)).toBeNull();
  });

  it('says nothing on a later round: the forecast is for the first build', () => {
    finished(14);
    refitEstimates(t.db, T0 + 300 * DAY);
    const at = T0 + 401 * DAY;
    const fast = inReview(30 * MIN, at);
    sendBackTask(t.sqlite, t.db, admin(), fast, 'Missing a test', at + HOUR);
    finishTask(t.sqlite, t.db, admin(), fast, { summary: 'Done', now: at + HOUR + MIN });
    expect(cueOf(fast)).toBeNull();
  });
});
