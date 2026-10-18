import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  heartbeats,
  orgs,
  projectMemberships,
  pushedCommitKeys,
  taskEstimates,
  taskRounds,
  tasks,
  tokenAlerts,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createSprint } from '../../src/services/sprints.ts';
import { claimTask, createTask } from '../../src/services/tasks.ts';
import {
  dismissAlert,
  getMyAlerts,
  getProjectBudgets,
  p95From,
  RUNAWAY_ADMIN_DELAY_MS,
  RUNAWAY_QUIET_MS,
  setProjectBudget,
  setSprintBudget,
  setTaskBudget,
} from '../../src/services/token-budgets.ts';
import {
  getTaskUsage,
  getUsage,
  recordTokenUsage,
  type TokenUsageReport,
} from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Budgets with soft alerts, and the runaway-agent alert (LAI-773). Soft
 * means nothing is ever refused; the runaway alert goes to the assignee
 * alone, and owners and admins only ever count them, a day later.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 17, 12);
const TODAY = '2026-10-17';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const BEA_COLLECTOR = '0b4e7d2a-91c3-4f6e-8a1d-5c2b9e7f3a10';

let t: TestDb;
let orgId: string;
let projectId: string;
let owner: string;
let bea: string;
let cal: string;

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      shareLocalActivity: 1,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function member(userId: string, role: 'lead' | 'member' | 'viewer' = 'member'): void {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role, createdAt: NOW })
    .run();
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return `${err.code}:${String((err.details as { reason?: string } | null)?.reason ?? '')}`;
    }
    throw err;
  }
  return 'no error';
}

/** A task Bea claimed `startedAgo` before NOW, its forecast frozen at p50/p80. */
function claimedTask(
  forecast: { p50: number; p80: number } | null,
  startedAgo = 2 * HOUR,
): { id: string; key: string } {
  const task = createTask(t.sqlite, t.db, actor(owner), 'laika', { title: 'Build the thing' });
  claimTask(t.sqlite, t.db, actor(bea), task.id, NOW - startedAgo);
  if (forecast !== null) {
    const estimate = newId();
    t.db
      .insert(taskEstimates)
      .values({
        id: estimate,
        taskId: task.id,
        source: 'model',
        level: 'M',
        weight: 1,
        tokensP50: forecast.p50,
        tokensP80: forecast.p80,
        createdAt: NOW - startedAgo - 1,
      })
      .run();
    t.db.update(tasks).set({ estimateAtStartId: estimate }).where(eq(tasks.id, task.id)).run();
  }
  return { id: task.id, key: task.key };
}

/** Bea's collector reporting `tokens` (output) on `key` today. */
function spend(key: string | null, tokens: number, at = NOW, userId = bea): void {
  const report: TokenUsageReport = {
    v: 1,
    collector_id: userId === bea ? BEA_COLLECTOR : COLLECTOR,
    tz: 'UTC',
    usage: true,
    days: [
      {
        day: TODAY,
        rows: [
          {
            agent: 'claude-code',
            model: 'claude-opus-5-5',
            task: key,
            input: 0,
            output: tokens,
            cache_write: 0,
            cache_read: tokens * 10,
          },
        ],
      },
    ],
  };
  recordTokenUsage(t.db, actor(userId), report, at);
}

function alerts() {
  return t.db.select().from(tokenAlerts).all();
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  orgId = s.orgId;
  projectId = s.projectId;
  owner = s.userId;
  t.db.update(orgs).set({ developerInsights: 1 }).where(eq(orgs.id, orgId)).run();
  t.db.update(users).set({ shareLocalActivity: 1 }).where(eq(users.id, owner)).run();
  bea = makeUser('Bea', 'member');
  cal = makeUser('Cal', 'member');
  member(bea);
  member(cal);
});

afterEach(() => {
  t.close();
});

describe('a task’s budget', () => {
  it('is the p80 frozen at its claim until a lead sets one', () => {
    const task = claimedTask({ p50: 1000, p80: 2500 });
    spend(task.key, 1000);
    const view = getTaskUsage(t.db, actor(bea), task.id, {}, NOW);
    expect(view.budget).toMatchObject({
      scope: 'task',
      source: 'forecast',
      tokens: 2500,
      used: 1000,
      state: 'under',
      crossed: [],
    });
  });

  it('alerts once at 80% and once at 100%, and refuses nothing', () => {
    const task = claimedTask({ p50: 1000, p80: 2500 });
    spend(task.key, 2100);
    spend(task.key, 2200);
    expect(alerts().map((a) => [a.kind, a.threshold])).toEqual([['budget', 80]]);
    // Past it: the report is taken like any other, and 100% is raised once.
    spend(task.key, 4000);
    spend(task.key, 5000);
    expect(
      alerts()
        .map((a) => a.threshold)
        .sort(),
    ).toEqual([100, 80]);
    expect(getTaskUsage(t.db, actor(bea), task.id, {}, NOW).budget).toMatchObject({
      used: 5000,
      state: 'over',
      crossed: [
        { threshold: 80, at: NOW },
        { threshold: 100, at: NOW },
      ],
    });
  });

  it('is set by a lead on a session, re-arms its alerts, and goes back to the forecast on null', () => {
    const task = claimedTask({ p50: 1000, p80: 2500 });
    spend(task.key, 2100);
    expect(alerts()).toHaveLength(1);
    expect(reasonOf(() => setTaskBudget(t.db, actor(bea), task.id, 9000, NOW))).toBe('forbidden:');
    const token = {
      ...actor(owner),
      token: { id: 'tok', scope: 'full' as const, projectIds: null },
    };
    expect(reasonOf(() => setTaskBudget(t.db, token, task.id, 9000, NOW))).toBe(
      'forbidden:session_required',
    );

    expect(setTaskBudget(t.db, actor(owner), task.id, 2500 * 4, NOW)).toMatchObject({
      source: 'set',
      tokens: 10_000,
      state: 'under',
      crossed: [],
    });
    // Set below what was spent: crossed at once, under the new figure.
    expect(setTaskBudget(t.db, actor(owner), task.id, 2000, NOW)).toMatchObject({
      state: 'over',
      crossed: [
        { threshold: 80, at: NOW },
        { threshold: 100, at: NOW },
      ],
    });
    expect(setTaskBudget(t.db, actor(owner), task.id, null, NOW)).toMatchObject({
      source: 'forecast',
      tokens: 2500,
    });
    expect(reasonOf(() => setTaskBudget(t.db, actor(owner), task.id, 0, NOW))).toMatch(
      /^unprocessable/,
    );
  });

  it('has none without a frozen forecast or one a lead set', () => {
    const task = claimedTask(null);
    spend(task.key, 2100);
    expect(getTaskUsage(t.db, actor(bea), task.id, {}, NOW).budget).toBeNull();
    expect(alerts()).toHaveLength(0);
  });
});

describe('a sprint’s and a project’s budget', () => {
  it('counts a sprint’s tasks on the sprint’s days, and the project’s month', () => {
    const sprint = createSprint(t.sqlite, t.db, actor(owner), 'laika', {
      name: 'S1',
      starts_on: Date.UTC(2026, 9, 12),
      ends_on: Date.UTC(2026, 9, 23),
    });
    const task = claimedTask(null);
    t.db.update(tasks).set({ sprintId: sprint.id }).where(eq(tasks.id, task.id)).run();
    expect(setSprintBudget(t.db, actor(owner), sprint.id, 1000, NOW)).toMatchObject({
      scope: 'sprint',
      period: { from: '2026-10-12', to: '2026-10-23' },
      used: 0,
    });
    expect(setProjectBudget(t.db, actor(owner), 'laika', 4000, NOW)).toMatchObject({
      scope: 'project',
      period: { from: '2026-10-01', to: '2026-10-31' },
    });
    spend(task.key, 900);
    const budgets = getProjectBudgets(t.db, actor(bea), 'laika', NOW);
    expect(budgets.can_set).toBe(false);
    expect(budgets.sprints[0]).toMatchObject({ used: 900, state: 'warn' });
    expect(budgets.project_budget).toMatchObject({ used: 900, state: 'under' });
    expect(
      alerts()
        .map((a) => [a.scope, a.threshold, a.period])
        .sort(),
    ).toEqual([['sprint', 80, '']]);
    expect(getProjectBudgets(t.db, actor(owner), 'laika', NOW).can_set).toBe(true);
  });
});

describe('alerts, as the people they are for see them', () => {
  it('shows a task’s budget alerts to its assignee, a sprint’s to the project’s leads', () => {
    const task = claimedTask({ p50: 1000, p80: 2500 });
    spend(task.key, 2100);
    expect(
      getMyAlerts(t.db, actor(bea), NOW).map((a) => [a.kind, a.threshold, a.task?.key]),
    ).toEqual([['budget', 80, task.key]]);
    expect(getMyAlerts(t.db, actor(cal), NOW)).toEqual([]);
    // Put away, for Bea only.
    const id = getMyAlerts(t.db, actor(bea), NOW)[0]!.id;
    dismissAlert(t.db, actor(bea), id, NOW);
    expect(getMyAlerts(t.db, actor(bea), NOW)).toEqual([]);
    expect(reasonOf(() => dismissAlert(t.db, actor(cal), id, NOW))).toBe('not_found:');
  });

  it('refuses every token: an agent does not read or put away its person’s alerts', () => {
    const token = { ...actor(bea), token: { id: 'tok', scope: 'full' as const, projectIds: null } };
    expect(reasonOf(() => getMyAlerts(t.db, token, NOW))).toBe('forbidden:session_required');
  });
});

describe('the runaway-agent alert', () => {
  // p50 1000, p80 2500 → p95 ≈ 1000 · 2.5^1.954 ≈ 5,986.
  const forecast = { p50: 1000, p80: 2500 };

  it('reads the p95 off the frozen range as the log-normal it is calibrated as', () => {
    expect(p95From(1000, 2500)).toBe(5_994);
    expect(p95From(0, 0)).toBe(0);
  });

  it('tells the assignee, and only them, when a build passes its p95 with nothing landed for an hour', () => {
    const task = claimedTask(forecast, 2 * HOUR);
    spend(task.key, 7000);
    const raised = alerts().filter((a) => a.kind === 'runaway');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      userId: bea,
      threshold: 95,
      limitTokens: 5_994,
      tokens: 7000,
    });

    const mine = getMyAlerts(t.db, actor(bea), NOW).filter((a) => a.kind === 'runaway');
    expect(mine.map((a) => a.task?.key)).toEqual([task.key]);
    expect(getTaskUsage(t.db, actor(bea), task.id, {}, NOW).runaway).toMatchObject({
      tokens: 7000,
      p95: 5_994,
    });
    // Nobody else: not a teammate, not the owner, not on the task panel.
    expect(getMyAlerts(t.db, actor(cal), NOW).filter((a) => a.kind === 'runaway')).toEqual([]);
    expect(getMyAlerts(t.db, actor(owner), NOW).filter((a) => a.kind === 'runaway')).toEqual([]);
    expect(getTaskUsage(t.db, actor(owner), task.id, {}, NOW).runaway).toBeNull();
    expect(getTaskUsage(t.db, actor(cal), task.id, {}, NOW).runaway).toBeNull();
  });

  it('stops speaking to someone who no longer holds the task, and never passes to the next', () => {
    const task = claimedTask(forecast, 2 * HOUR);
    spend(task.key, 7000);
    t.db.update(tasks).set({ assigneeId: cal }).where(eq(tasks.id, task.id)).run();
    expect(getMyAlerts(t.db, actor(bea), NOW).filter((a) => a.kind === 'runaway')).toEqual([]);
    expect(getMyAlerts(t.db, actor(cal), NOW).filter((a) => a.kind === 'runaway')).toEqual([]);
  });

  it('counts for owners and admins only a day later, per project, naming nobody', () => {
    const task = claimedTask(forecast, 2 * HOUR);
    spend(task.key, 7000);
    expect(getUsage(t.db, actor(owner), { days: 7 }, NOW).runaway).toEqual([]);
    const later = NOW + RUNAWAY_ADMIN_DELAY_MS;
    const counts = getUsage(t.db, actor(owner), { days: 7 }, later).runaway;
    expect(counts).toEqual([{ project: { slug: 'laika', name: 'Laika' }, alerts: 1 }]);
    expect(JSON.stringify(counts)).not.toContain(task.key);
    // A member reading the project's figures gets none at all.
    expect(getUsage(t.db, actor(bea), { days: 7, project: 'laika' }, later).runaway).toBeNull();
  });

  it('raises one per stall, however many reports arrive', () => {
    const task = claimedTask(forecast, 2 * HOUR);
    spend(task.key, 7000);
    spend(task.key, 8000, NOW + 10 * 60_000);
    expect(alerts().filter((a) => a.kind === 'runaway')).toHaveLength(1);
  });

  it('stays quiet while the build is under its p95', () => {
    const task = claimedTask(forecast, 2 * HOUR);
    spend(task.key, 5900);
    expect(alerts().filter((a) => a.kind === 'runaway')).toHaveLength(0);
  });

  it('stays quiet within an hour of the claim', () => {
    const task = claimedTask(forecast, RUNAWAY_QUIET_MS - 60_000);
    spend(task.key, 9000);
    expect(alerts().filter((a) => a.kind === 'runaway')).toHaveLength(0);
  });

  it('stays quiet when GitHub reported a push for the task in the hour', () => {
    const task = claimedTask(forecast, 3 * HOUR);
    appendActivity(t.db, {
      orgId,
      projectId,
      taskId: task.id,
      actorKind: 'system',
      type: 'webhook.commit',
      payload: { count: 1 },
      now: NOW - 20 * 60_000,
    });
    spend(task.key, 9000);
    expect(alerts().filter((a) => a.kind === 'runaway')).toHaveLength(0);
  });

  it('stays quiet when the assignee’s machine pushed a commit in the hour', () => {
    const task = claimedTask(forecast, 3 * HOUR);
    t.db
      .insert(pushedCommitKeys)
      .values({ userId: bea, key: '0123456789abcdef', day: TODAY, createdAt: NOW - 10 * 60_000 })
      .run();
    spend(task.key, 9000);
    expect(alerts().filter((a) => a.kind === 'runaway')).toHaveLength(0);
  });

  it('counts a session arriving on the task as progress, and a steady stream of heartbeats as none', () => {
    const steady = claimedTask(forecast, 3 * HOUR);
    // A heartbeat every 90 s for the last 70 minutes: one session, looping.
    for (let at = NOW - 70 * 60_000; at <= NOW; at += 90_000) {
      t.db
        .insert(heartbeats)
        .values({
          id: newId(),
          userId: bea,
          repo: 'o/r',
          branch: 'LAI-1',
          matchedTaskId: steady.id,
          createdAt: at,
        })
        .run();
    }
    spend(steady.key, 9000);
    expect(alerts().filter((a) => a.kind === 'runaway' && a.subjectId === steady.id)).toHaveLength(
      1,
    );

    const arrived = claimedTask(forecast, 3 * HOUR);
    // A session sat down to it 20 minutes ago, after silence.
    t.db
      .insert(heartbeats)
      .values({
        id: newId(),
        userId: bea,
        repo: 'o/r',
        branch: 'LAI-2',
        matchedTaskId: arrived.id,
        createdAt: NOW - 20 * 60_000,
      })
      .run();
    spend(arrived.key, 9000);
    expect(alerts().filter((a) => a.kind === 'runaway' && a.subjectId === arrived.id)).toHaveLength(
      0,
    );
  });

  it('is for the build only: a task handed in once is past its forecast', () => {
    const task = claimedTask(forecast, 3 * HOUR);
    t.db
      .insert(taskRounds)
      .values({
        id: newId(),
        taskId: task.id,
        number: 1,
        finishedBy: bea,
        summaryMd: 'done',
        createdAt: NOW - 2 * HOUR,
      })
      .run();
    spend(task.key, 9000);
    expect(alerts().filter((a) => a.kind === 'runaway')).toHaveLength(0);
  });

  it('goes quiet for its recipient once something lands', () => {
    const task = claimedTask(forecast, 3 * HOUR);
    spend(task.key, 9000);
    expect(getMyAlerts(t.db, actor(bea), NOW).filter((a) => a.kind === 'runaway')).toHaveLength(1);
    t.db
      .insert(pushedCommitKeys)
      .values({ userId: bea, key: 'fedcba9876543210', day: TODAY, createdAt: NOW + 60_000 })
      .run();
    expect(
      getMyAlerts(t.db, actor(bea), NOW + 2 * 60_000).filter((a) => a.kind === 'runaway'),
    ).toEqual([]);
  });
});

describe('best effort', () => {
  it('never costs the report: with the alerts table gone, tokens are still stored', () => {
    const task = claimedTask({ p50: 1000, p80: 2500 }, 3 * HOUR);
    t.sqlite.exec('DROP TABLE token_alert_dismissals; DROP TABLE token_alerts;');
    expect(() => {
      spend(task.key, 9000);
    }).not.toThrow();
    const stored = t.sqlite
      .prepare('SELECT sum(output) AS n FROM token_usage_days WHERE task_id = ?')
      .get(task.id) as { n: number };
    expect(stored.n).toBe(9000);
  });
});
