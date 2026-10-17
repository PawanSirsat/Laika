import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  orgs,
  projectMemberships,
  projects,
  tokens,
  tokenUsageDays,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneLocalActivity } from '../../src/jobs/jobs.ts';
import { deleteOwnLocalActivity } from '../../src/services/local-activity.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  getPersonUsage,
  getUsage,
  recordTokenUsage,
  TOKEN_USAGE_DAYS_BACK,
  type TokenUsageReport,
  type TokenUsageRowInput,
} from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Token usage, phase 1 (D-084, LAI-769): a collector's per-day totals, kept
 * as one rollup table, and read back as the Usage page and the profile card.
 *
 * The clock is injected: `NOW` is Saturday 17 October 2026, noon UTC, so the
 * report window — today − 31 to today + 1 in the sender's zone — is the same
 * on any day this runs.
 */

const NOW = Date.UTC(2026, 9, 17, 12);
const TODAY = '2026-10-17';
const YESTERDAY = '2026-10-16';
const COLLECTOR_A = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const COLLECTOR_B = '0b4e7d2a-91c3-4f6e-8a1d-5c2b9e7f3a10';

let t: TestDb;
let orgId: string;
let owner: string;
let projectId: string;
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
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function member(userId: string, project: string, role: 'lead' | 'member' | 'viewer' = 'member') {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId: project, userId, role, createdAt: NOW })
    .run();
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function withToken(userId: string, scope: 'full' | 'read_only' = 'full'): ResolvedActor {
  return { ...actor(userId), token: { id: 'tok_x', scope, projectIds: null } };
}

function refusal(fn: () => unknown): { code: string; details: Record<string, unknown> } | string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return { code: err.code, details: (err.details ?? {}) as Record<string, unknown> };
    }
    throw err;
  }
  return 'no error';
}

function share(user: string, on = true, org = true): void {
  t.db
    .update(orgs)
    .set({ developerInsights: org ? 1 : 0 })
    .where(eq(orgs.id, orgId))
    .run();
  t.db
    .update(users)
    .set({ shareLocalActivity: on ? 1 : 0 })
    .where(eq(users.id, user))
    .run();
}

function row(extra: Partial<TokenUsageRowInput> = {}): TokenUsageRowInput {
  return {
    agent: 'claude-code',
    model: 'claude-opus-5-5',
    task: null,
    input: 100,
    output: 2_000,
    cache_write: 5_000,
    cache_read: 900_000,
    ...extra,
  };
}

function report(
  days: { day: string; rows: TokenUsageRowInput[] }[],
  extra: Partial<TokenUsageReport> = {},
): TokenUsageReport {
  return { v: 1, collector_id: COLLECTOR_A, tz: 'UTC', usage: true, days, ...extra };
}

function stored(user?: string) {
  const all = t.db.select().from(tokenUsageDays).all();
  return user === undefined ? all : all.filter((r) => r.userId === user);
}

function sum(user: string, field: 'input' | 'output' | 'cacheWrite' | 'cacheRead'): number {
  return stored(user).reduce((n, r) => n + r[field], 0);
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  orgId = s.orgId;
  owner = s.userId;
  projectId = s.projectId;
  bea = makeUser('Bea', 'member');
  cal = makeUser('Cal', 'member');
});

afterEach(() => {
  t.close();
});

describe('a usage report (PUT /me/local-activity, "usage": true)', () => {
  it('stores per day × agent × model × task the four counts, and writes no activity row', () => {
    share(bea);
    const before = t.db
      .select({ n: sql<number>`count(*)` })
      .from(activity)
      .get()?.n;
    expect(
      recordTokenUsage(
        t.db,
        actor(bea),
        report([
          { day: YESTERDAY, rows: [row(), row({ agent: 'codex', model: 'gpt-5.2-codex' })] },
        ]),
        NOW,
      ),
    ).toEqual({ accepted_days: 1 });

    const rows = stored(bea);
    expect(rows).toHaveLength(2);
    const claude = rows.find((r) => r.agent === 'claude-code');
    expect(claude).toMatchObject({
      day: YESTERDAY,
      collectorId: COLLECTOR_A,
      model: 'claude-opus-5-5',
      taskId: null,
      projectId: null,
      input: 100,
      output: 2_000,
      cacheWrite: 5_000,
      cacheRead: 900_000,
    });
    expect(
      t.db
        .select({ n: sql<number>`count(*)` })
        .from(activity)
        .get()?.n,
    ).toBe(before);
  });

  it('replaces the day for this machine: the same report twice leaves the totals unchanged', () => {
    share(bea);
    const body = report([{ day: YESTERDAY, rows: [row()] }]);
    recordTokenUsage(t.db, actor(bea), body, NOW);
    recordTokenUsage(t.db, actor(bea), body, NOW);
    expect(sum(bea, 'output')).toBe(2_000);

    // A later total for the same day replaces it — it is never added.
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row({ output: 3_500 })] }]),
      NOW,
    );
    expect(sum(bea, 'output')).toBe(3_500);

    // A model that is no longer in the day's report is gone from it.
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row({ model: 'claude-sonnet-5', output: 10 })] }]),
      NOW,
    );
    expect(stored(bea).map((r) => r.model)).toEqual(['claude-sonnet-5']);
  });

  it('leaves the days a report does not carry, and another machine’s rows, alone', () => {
    share(bea);
    recordTokenUsage(t.db, actor(bea), report([{ day: '2026-10-15', rows: [row()] }]), NOW);
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row()] }], { collector_id: COLLECTOR_B }),
      NOW,
    );
    recordTokenUsage(t.db, actor(bea), report([{ day: YESTERDAY, rows: [row()] }]), NOW);
    expect(stored(bea)).toHaveLength(3);
    expect(sum(bea, 'output')).toBe(6_000);
  });

  it('clears a day sent with no rows', () => {
    share(bea);
    recordTokenUsage(t.db, actor(bea), report([{ day: YESTERDAY, rows: [row()] }]), NOW);
    recordTokenUsage(t.db, actor(bea), report([{ day: YESTERDAY, rows: [] }]), NOW);
    expect(stored(bea)).toHaveLength(0);
  });

  it('folds rows that name the same agent, model and task into one', () => {
    share(bea);
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row(), row({ agent: 'claude' })] }]),
      NOW,
    );
    const rows = stored(bea);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent: 'claude-code', output: 4_000 });
  });

  it('takes days back to today − 31 and refuses older ones, day_out_of_range', () => {
    share(bea);
    expect(TOKEN_USAGE_DAYS_BACK).toBe(31);
    recordTokenUsage(t.db, actor(bea), report([{ day: '2026-09-16', rows: [row()] }]), NOW);
    const refused = refusal(() =>
      recordTokenUsage(t.db, actor(bea), report([{ day: '2026-09-15', rows: [row()] }]), NOW),
    );
    expect(refused).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'day_out_of_range', earliest: '2026-09-16' },
    });
  });

  it('is refused local_activity_off, storing nothing, when either switch is off', () => {
    for (const [org, user] of [
      [false, true],
      [true, false],
    ] as const) {
      share(bea, user, org);
      const refused = refusal(() =>
        recordTokenUsage(t.db, actor(bea), report([{ day: YESTERDAY, rows: [row()] }]), NOW),
      );
      expect(refused).toMatchObject({
        code: 'forbidden',
        details: { reason: 'local_activity_off' },
      });
    }
    expect(stored()).toHaveLength(0);
  });

  it('keeps a task key only for a task the sender can see; any other is unattributed', () => {
    const projectTask = createTask(t.sqlite, t.db, actor(owner), 'laika', {
      title: 'Token usage',
      now: NOW,
    });
    // A project Bea is not in, with a task of its own.
    const hidden = newId();
    t.db
      .insert(projects)
      .values({
        id: hidden,
        orgId,
        name: 'Hidden',
        slug: 'hidden',
        prefix: 'HID',
        visibility: 'private',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    share(bea);
    member(bea, projectId);

    recordTokenUsage(
      t.db,
      actor(bea),
      report([
        {
          day: YESTERDAY,
          rows: [
            row({ task: projectTask.key, output: 1 }),
            row({ task: 'HID-1', output: 10 }),
            row({ task: 'NOPE-9', output: 100 }),
          ],
        },
      ]),
      NOW,
    );
    const rows = stored(bea);
    const attributed = rows.filter((r) => r.taskId !== null);
    expect(attributed).toHaveLength(1);
    expect(attributed[0]).toMatchObject({ taskId: projectTask.id, projectId, output: 1 });
    // The two keys that do not resolve for Bea fold into one unattributed row.
    expect(rows.filter((r) => r.taskId === null)).toEqual([
      expect.objectContaining({ output: 110, projectId: null }),
    ]);
  });
});

describe('the developer’s own history', () => {
  it('*delete my history* deletes token rows too', () => {
    share(bea);
    recordTokenUsage(t.db, actor(bea), report([{ day: YESTERDAY, rows: [row()] }]), NOW);
    share(cal);
    recordTokenUsage(t.db, actor(cal), report([{ day: YESTERDAY, rows: [row()] }]), NOW);

    deleteOwnLocalActivity(t.db, actor(bea));
    expect(stored(bea)).toHaveLength(0);
    expect(stored(cal)).toHaveLength(1);
  });

  it('is kept 400 days, by the local-activity retention job', () => {
    share(bea);
    recordTokenUsage(t.db, actor(bea), report([{ day: YESTERDAY, rows: [row()] }]), NOW);
    // Backdated rows, as a year of reports would have left them.
    t.db
      .insert(tokenUsageDays)
      .values([
        {
          userId: bea,
          collectorId: COLLECTOR_A,
          day: '2025-09-01',
          agent: 'codex',
          model: 'gpt-5.1-codex',
          input: 1,
          output: 1,
          cacheWrite: 0,
          cacheRead: 0,
          updatedAt: NOW,
        },
      ])
      .run();
    pruneLocalActivity(t.db, NOW);
    expect(stored(bea).map((r) => r.day)).toEqual([YESTERDAY]);
  });
});

/** Two developers' reports, one with a task in the seeded project. */
function seedUsage(): { taskKey: string } {
  const projectTask = createTask(t.sqlite, t.db, actor(owner), 'laika', {
    title: 'Usage page',
    now: NOW,
  });
  member(bea, projectId);
  member(cal, projectId);
  share(bea);
  share(cal);
  recordTokenUsage(
    t.db,
    actor(bea),
    report([
      {
        day: YESTERDAY,
        rows: [
          row({ input: 10, output: 20, cache_write: 30, cache_read: 1_000 }),
          row({
            agent: 'codex',
            model: 'gpt-5.2-codex',
            task: projectTask.key,
            input: 1,
            output: 2,
            cache_write: 3,
            cache_read: 4,
          }),
        ],
      },
    ]),
    NOW,
  );
  recordTokenUsage(
    t.db,
    actor(cal),
    report([
      {
        day: TODAY,
        rows: [row({ input: 100, output: 200, cache_write: 300, cache_read: 50_000 })],
      },
    ]),
    NOW,
  );
  return { taskKey: projectTask.key };
}

describe('GET /usage — the Usage page', () => {
  it('gives an owner the organisation: headline without cache reads, trend, people, agents, models, tasks', () => {
    const { taskKey } = seedUsage();
    const view = getUsage(t.db, actor(owner), { days: 7 }, NOW);

    expect(view.project).toBeNull();
    expect(view.from).toBe('2026-10-11');
    expect(view.to).toBe(TODAY);
    // input + output + cache write; cache reads beside it, never in it.
    expect(view.totals).toEqual({
      tokens: 10 + 20 + 30 + 1 + 2 + 3 + 100 + 200 + 300,
      input: 111,
      output: 222,
      cache_write: 333,
      cache_read: 51_004,
      attributed_tokens: 6,
    });
    expect(view.trend).toHaveLength(7);
    expect(view.trend.find((d) => d.day === YESTERDAY)).toEqual({
      day: YESTERDAY,
      tokens: 66,
      cache_read: 1_004,
    });
    expect(view.trend.find((d) => d.day === '2026-10-12')).toEqual({
      day: '2026-10-12',
      tokens: 0,
      cache_read: 0,
    });

    // By developer, in name order — never ranked by volume (D-084 item 7).
    expect(view.by_developer?.map((p) => [p.name, p.tokens, p.attributed_tokens])).toEqual([
      ['Bea', 66, 6],
      ['Cal', 600, 0],
    ]);
    expect(view.by_agent.map((a) => [a.agent, a.tokens])).toEqual([
      ['claude-code', 660],
      ['codex', 6],
    ]);
    expect(view.by_model.map((m) => m.model)).toEqual(['claude-opus-5-5', 'gpt-5.2-codex']);
    expect(view.top_tasks).toEqual([
      expect.objectContaining({ key: taskKey, title: 'Usage page', tokens: 6, cache_read: 4 }),
    ]);
  });

  it('gives a member a project’s totals and never a per-person split', () => {
    seedUsage();
    const view = getUsage(t.db, actor(bea), { days: 7, project: 'laika' }, NOW);
    expect(view.project).toMatchObject({ slug: 'laika' });
    expect(view.by_developer).toBeNull();
    expect(view.totals.tokens).toBe(6);
    expect(JSON.stringify(view)).not.toContain(cal);
    expect(JSON.stringify(view)).not.toContain('Cal');
  });

  it('refuses a member the organisation-wide page', () => {
    seedUsage();
    expect(refusal(() => getUsage(t.db, actor(bea), { days: 7 }, NOW))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses a project the reader is not in', () => {
    seedUsage();
    const outsider = makeUser('Dee', 'member');
    expect(
      refusal(() => getUsage(t.db, actor(outsider), { days: 7, project: 'laika' }, NOW)),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('gives a token totals only, even an owner’s full one', () => {
    seedUsage();
    const view = getUsage(t.db, withToken(owner), { days: 7 }, NOW);
    expect(view.by_developer).toBeNull();
    expect(view.totals.tokens).toBe(666);
    expect(JSON.stringify(view)).not.toContain(bea);
  });

  it('names agents in use that keep no token data', () => {
    seedUsage();
    t.db
      .insert(tokens)
      .values({
        id: newId(),
        userId: cal,
        name: 'cursor on macOS',
        prefix: 'lai_cur',
        tokenHash: 'h1',
        scope: 'full',
        lastClient: 'cursor',
        createdAt: NOW,
      })
      .run();
    expect(getUsage(t.db, actor(owner), { days: 7 }, NOW).no_token_data).toEqual(['cursor']);
  });
});

describe('GET /users/:id/usage — the profile card', () => {
  it('gives an owner anyone’s weeks, top agents and models, and the attributed share', () => {
    seedUsage();
    const card = getPersonUsage(t.db, actor(owner), bea, NOW);
    expect(card.user_id).toBe(bea);
    expect(card.weeks).toHaveLength(12);
    expect(card.weeks.at(-1)).toEqual({ start: '2026-10-12', tokens: 66, cache_read: 1_004 });
    expect(card.totals).toMatchObject({ tokens: 66, attributed_tokens: 6 });
    expect(card.by_agent.map((a) => a.agent)).toEqual(['claude-code', 'codex']);
    expect(card.by_model.map((m) => m.model)).toEqual(['claude-opus-5-5', 'gpt-5.2-codex']);
  });

  it('gives a developer their own, and nobody else’s', () => {
    seedUsage();
    expect(getPersonUsage(t.db, actor(bea), bea, NOW).totals.tokens).toBe(66);
    expect(refusal(() => getPersonUsage(t.db, actor(bea), cal, NOW))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses every token, session_required — even the person’s own', () => {
    seedUsage();
    expect(refusal(() => getPersonUsage(t.db, withToken(bea), bea, NOW))).toMatchObject({
      code: 'forbidden',
      details: { reason: 'session_required' },
    });
    expect(refusal(() => getPersonUsage(t.db, withToken(owner), bea, NOW))).toMatchObject({
      code: 'forbidden',
      details: { reason: 'session_required' },
    });
  });
});

describe('every Usage query is one indexed query', () => {
  /** SQLite's plan for a statement: every step names an index, none scans the table. */
  function plan(statement: string, params: unknown[]): string[] {
    return (
      t.sqlite.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(...params) as { detail: string }[]
    ).map((r) => r.detail);
  }

  const RANGE = `day >= ? AND day <= ?`;
  const SUMS = `sum(input + output + cache_write), sum(cache_read)`;
  const cases: [string, string, unknown[]][] = [
    ['org total', `SELECT ${SUMS} FROM token_usage_days WHERE ${RANGE}`, ['a', 'b']],
    [
      'org by agent',
      `SELECT agent, ${SUMS} FROM token_usage_days WHERE ${RANGE} GROUP BY agent`,
      ['a', 'b'],
    ],
    [
      'org by model',
      `SELECT model, ${SUMS} FROM token_usage_days WHERE ${RANGE} GROUP BY model`,
      ['a', 'b'],
    ],
    [
      'project total',
      `SELECT ${SUMS} FROM token_usage_days WHERE project_id = ? AND ${RANGE}`,
      ['p', 'a', 'b'],
    ],
    [
      'project by developer',
      `SELECT user_id, ${SUMS} FROM token_usage_days WHERE project_id = ? AND ${RANGE} GROUP BY user_id`,
      ['p', 'a', 'b'],
    ],
    [
      'person',
      `SELECT ${SUMS} FROM token_usage_days WHERE user_id = ? AND ${RANGE}`,
      ['u', 'a', 'b'],
    ],
  ];

  for (const [name, statement, params] of cases) {
    it(name, () => {
      const steps = plan(statement, params);
      // A SEARCH is a range of the index; a SCAN — of the table or of a whole
      // index — reads every row, which is what this exists to rule out.
      expect(
        steps.filter((s) => /^SEARCH token_usage_days USING (COVERING )?INDEX /.test(s)),
      ).toHaveLength(1);
      expect(steps.filter((s) => /^SCAN token_usage_days\b/.test(s))).toEqual([]);
    });
  }
});
