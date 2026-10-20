import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  orgs,
  projectMemberships,
  tokenArrivals,
  tokenBudgets,
  tokenUsageDays,
  users,
} from '../../src/db/schema.ts';
import { getOwnLocalActivity } from '../../src/services/local-activity.ts';
import { createTask } from '../../src/services/tasks.ts';
import { taskBudgets } from '../../src/services/token-budgets.ts';
import {
  getPersonUsage,
  getTaskUsage,
  getUsage,
  recordTokenUsage,
  type TokenUsageReport,
  type TokenUsageRowInput,
} from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * D-091 (LAI-815): tokens an automated session spent — Omnigent's sub-agents,
 * CI, `LAIKA_ACTIVITY_SKIP` — arrive marked `automated`. They count for the
 * organisation, the space and the task, cost and budgets included, and for
 * **no per-person figure**: not `by_developer`, not the person's card, not the
 * task panel's per-person part, not the plan-limit rate.
 *
 * One world for every test: Bea's machine reports her own tokens and the
 * tokens of the automated sessions it ran, some tied to a task, some not.
 */

const NOW = Date.UTC(2026, 9, 17, 12);
const TODAY = '2026-10-17';
const YESTERDAY = '2026-10-16';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';

/** Headline (input + output + cache write) of each of Bea's rows, so each figure is a sum of named parts. */
const OWN_LOOSE = 10 + 20 + 30;
const OWN_ON_TASK = 1 + 2 + 3;
const AUTO_ON_TASK = 100 + 200 + 300;
const AUTO_LOOSE = 1_000 + 2_000 + 3_000;
const CAL = 7 + 8 + 9;

let t: TestDb;
let orgId: string;
let owner: string;
let projectId: string;
let bea: string;
let cal: string;
let task: { id: string; key: string };

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function share(user: string): void {
  t.db.update(orgs).set({ developerInsights: 1 }).where(eq(orgs.id, orgId)).run();
  t.db.update(users).set({ shareLocalActivity: 1 }).where(eq(users.id, user)).run();
}

function row(extra: Partial<TokenUsageRowInput>): TokenUsageRowInput {
  return {
    agent: 'claude-code',
    model: 'claude-opus-5-5',
    task: null,
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    ...extra,
  };
}

function report(days: TokenUsageReport['days']): TokenUsageReport {
  return { v: 1, collector_id: COLLECTOR, tz: 'UTC', usage: true, days };
}

/** Bea's day: her own tokens, loose and on the task, and her automated sessions', the same. */
function beasDay(): TokenUsageReport['days'][number] {
  return {
    day: YESTERDAY,
    rows: [
      row({ input: 10, output: 20, cache_write: 30, cache_read: 1_000 }),
      row({
        agent: 'codex',
        model: 'gpt-5.2-codex',
        task: task.key,
        input: 1,
        output: 2,
        cache_write: 3,
        cache_read: 4,
      }),
      row({
        task: task.key,
        input: 100,
        output: 200,
        cache_write: 300,
        cache_read: 5_000,
        automated: true,
      }),
      row({ input: 1_000, output: 2_000, cache_write: 3_000, cache_read: 9, automated: true }),
    ],
  };
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  orgId = s.orgId;
  owner = s.userId;
  projectId = s.projectId;
  bea = makeUser('Bea', 'member');
  cal = makeUser('Cal', 'member');
  for (const userId of [bea, cal]) {
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId, userId, role: 'member', createdAt: NOW })
      .run();
    share(userId);
  }
  const made = createTask(t.sqlite, t.db, actor(owner), 'laika', { title: 'Usage', now: NOW });
  task = { id: made.id, key: made.key };
  recordTokenUsage(t.db, actor(bea), report([beasDay()]), NOW);
  recordTokenUsage(
    t.db,
    actor(cal),
    report([{ day: TODAY, rows: [row({ input: 7, output: 8, cache_write: 9 })] }]),
    NOW,
  );
});

afterEach(() => {
  t.close();
});

describe('an automated row is stored as one (D-091)', () => {
  it('keeps the flag per row, and folds a person’s row and an automated one apart', () => {
    const rows = t.db.select().from(tokenUsageDays).where(eq(tokenUsageDays.userId, bea)).all();
    expect(
      rows
        .map((r) => [r.agent, r.taskId === null ? '-' : 'task', r.automated, r.output])
        .sort((a, b) => Number(a[3]) - Number(b[3])),
    ).toEqual([
      ['codex', 'task', false, 2],
      ['claude-code', '-', false, 20],
      ['claude-code', 'task', true, 200],
      ['claude-code', '-', true, 2_000],
    ]);
  });
});

describe('automated rows count for the organisation, the space and the task', () => {
  it('the organisation: totals, trend, top tasks — every token', () => {
    const view = getUsage(t.db, actor(owner), { days: 7 }, NOW);
    expect(view.totals.tokens).toBe(OWN_LOOSE + OWN_ON_TASK + AUTO_ON_TASK + AUTO_LOOSE + CAL);
    expect(view.totals.attributed_tokens).toBe(OWN_ON_TASK + AUTO_ON_TASK);
    expect(view.totals.cost.usd).toBeGreaterThan(0);
    expect(view.trend.find((d) => d.day === YESTERDAY)?.tokens).toBe(
      OWN_LOOSE + OWN_ON_TASK + AUTO_ON_TASK + AUTO_LOOSE,
    );
    expect(view.top_tasks).toMatchObject([{ key: task.key, tokens: OWN_ON_TASK + AUTO_ON_TASK }]);
  });

  it('the space: what is tied to its tasks, automated included; and the organisation beside it', () => {
    const view = getUsage(t.db, actor(owner), { days: 7, project: 'laika' }, NOW);
    expect(view.totals.tokens).toBe(OWN_ON_TASK + AUTO_ON_TASK);
    expect(view.org_totals?.tokens).toBe(OWN_LOOSE + OWN_ON_TASK + AUTO_ON_TASK + AUTO_LOOSE + CAL);
    expect(view.cache_by_project).toMatchObject([{ cache_read: 4 + 5_000 }]);
    // A member reads the same space totals, and no people.
    const member = getUsage(t.db, actor(cal), { days: 7, project: 'laika' }, NOW);
    expect(member.totals.tokens).toBe(OWN_ON_TASK + AUTO_ON_TASK);
    expect(member.by_developer).toBeNull();
  });

  it('the task: its totals and its rounds; its budget spends them', () => {
    const view = getTaskUsage(t.db, actor(owner), task.id, {}, NOW);
    expect(view.totals.tokens).toBe(OWN_ON_TASK + AUTO_ON_TASK);
    expect(view.by_round.reduce((n, r) => n + r.tokens, 0)).toBe(OWN_ON_TASK + AUTO_ON_TASK);

    t.db
      .insert(tokenBudgets)
      .values({
        id: newId(),
        projectId,
        scope: 'task',
        taskId: task.id,
        tokens: 500,
        setBy: owner,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    expect(taskBudgets(t.db, [task.id])[0]).toMatchObject({
      used: OWN_ON_TASK + AUTO_ON_TASK,
      state: 'over',
    });
  });
});

describe('automated rows count for no person', () => {
  it('by_developer has each person’s own tokens only', () => {
    for (const project of [undefined, 'laika']) {
      const view = getUsage(t.db, actor(owner), { days: 7, project }, NOW);
      const people = Object.fromEntries(
        (view.by_developer ?? []).map((p) => [p.name, [p.tokens, p.attributed_tokens]]),
      );
      expect(people, project ?? 'organisation').toEqual(
        project === undefined
          ? { Bea: [OWN_LOOSE + OWN_ON_TASK, OWN_ON_TASK], Cal: [CAL, 0] }
          : { Bea: [OWN_ON_TASK, OWN_ON_TASK] },
      );
    }
  });

  it('the person’s card (GET /users/:id/usage) holds their own tokens only', () => {
    const card = getPersonUsage(t.db, actor(bea), bea, NOW);
    expect(card.totals.tokens).toBe(OWN_LOOSE + OWN_ON_TASK);
    expect(card.totals.attributed_tokens).toBe(OWN_ON_TASK);
    expect(card.weeks.reduce((n, w) => n + w.tokens, 0)).toBe(OWN_LOOSE + OWN_ON_TASK);
    expect(Object.fromEntries(card.by_agent.map((a) => [a.agent, a.tokens]))).toEqual({
      'claude-code': OWN_LOOSE,
      codex: OWN_ON_TASK,
    });
    // An owner reading Bea's card sees the same.
    expect(getPersonUsage(t.db, actor(owner), bea, NOW).totals.tokens).toBe(
      OWN_LOOSE + OWN_ON_TASK,
    );
  });

  it('the task panel’s per-person part and attributed share are the people’s own work', () => {
    for (const reader of [owner, bea]) {
      const view = getTaskUsage(t.db, actor(reader), task.id, {}, NOW);
      expect(view.by_person?.map((p) => [p.name, p.tokens])).toEqual([['Bea', OWN_ON_TASK]]);
      expect(view.attributed).toEqual({ tokens: OWN_ON_TASK, of: OWN_LOOSE + OWN_ON_TASK });
    }
  });

  it('the plan-limit rate: a report adds only the person’s own tokens to their arrivals', () => {
    const arrived = (user: string) =>
      t.db
        .select()
        .from(tokenArrivals)
        .where(eq(tokenArrivals.userId, user))
        .all()
        .reduce((n, r) => n + r.tokens, 0);
    expect(arrived(bea)).toBe(OWN_LOOSE + OWN_ON_TASK);
    // The same report again changes nothing, and adds nothing.
    recordTokenUsage(t.db, actor(bea), report([beasDay()]), NOW + 60_000);
    expect(arrived(bea)).toBe(OWN_LOOSE + OWN_ON_TASK);
  });

  it('their own history still names every token held from their machine (D-084 item 4)', () => {
    const held = getOwnLocalActivity(t.db, actor(bea), 14, NOW);
    expect(held.days.find((d) => d.day === YESTERDAY)?.tokens).toBe(
      OWN_LOOSE + OWN_ON_TASK + AUTO_ON_TASK + AUTO_LOOSE,
    );
  });
});

describe('a report from a collector that predates D-091', () => {
  it('has no flag, and every row in it is the person’s', () => {
    const before = beasDay();
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ ...before, rows: before.rows.map(({ automated: _drop, ...r }) => r) }]),
      NOW,
    );
    const rows = t.db.select().from(tokenUsageDays).where(eq(tokenUsageDays.userId, bea)).all();
    expect(rows.every((r) => !r.automated)).toBe(true);
    expect(getPersonUsage(t.db, actor(bea), bea, NOW).totals.tokens).toBe(
      OWN_LOOSE + OWN_ON_TASK + AUTO_ON_TASK + AUTO_LOOSE,
    );
  });
});
