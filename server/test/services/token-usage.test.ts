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
  taskReviews,
  taskRounds,
  tasks,
  tokens,
  tokenUsageDays,
  tokenUsageZones,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneLocalActivity } from '../../src/jobs/jobs.ts';
import { deleteOwnLocalActivity, getActivitySharing } from '../../src/services/local-activity.ts';
import { createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  getPersonUsage,
  getTaskUsage,
  getUsage,
  recordTokenUsage,
  TOKEN_USAGE_DAYS_BACK,
  type TokenUsageReport,
  type TokenUsageRowInput,
} from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';
import { work } from '../helpers/work.ts';

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
  days: TokenUsageReport['days'],
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

  it('never retries a board key the sender cannot read as an outside id: it stays unattributed (LAI-780 review)', () => {
    createProject(t.sqlite, t.db, actor(owner), {
      name: 'Hidden',
      slug: 'hidden',
      prefix: 'HID',
      visibility: 'private',
      now: NOW,
    });
    // HID-1 is a real board task Bea cannot read…
    const hidden = createTask(t.sqlite, t.db, actor(owner), 'hidden', {
      title: 'Hidden',
      now: NOW,
    });
    expect(hidden.key).toBe('HID-1');
    // …and a card she can read carries `HID-1` as its outside id.
    const visible = createTask(t.sqlite, t.db, actor(owner), 'laika', {
      title: 'Mirror',
      now: NOW,
    });
    t.db.update(tasks).set({ externalRef: 'HID-1' }).where(eq(tasks.id, visible.id)).run();
    share(bea);
    member(bea, projectId);

    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row({ task: 'HID-1', output: 7 })] }]),
      NOW,
    );
    // The board key names a task, so it is never tried as an outside id —
    // not even when its task is one the sender cannot see.
    expect(stored(bea)).toEqual([expect.objectContaining({ taskId: null, output: 7 })]);
  });

  it('ties a key that is a card’s outside id to that card — only where the sender may read it, never one two cards carry (LAI-780)', () => {
    const carried = (slug: string, title: string, ref: string) => {
      const task = createTask(t.sqlite, t.db, actor(owner), slug, { title, now: NOW });
      t.db.update(tasks).set({ externalRef: ref }).where(eq(tasks.id, task.id)).run();
      return task;
    };
    createProject(t.sqlite, t.db, actor(owner), {
      name: 'Hidden',
      slug: 'hidden',
      prefix: 'HID',
      visibility: 'private',
      now: NOW,
    });
    const repoTask = carried('laika', 'LAI-780 · Outside ids', 'LAI-780');
    carried('hidden', 'Not Bea’s', 'JIRA-9');
    carried('laika', 'Twice, one', 'ONR-12');
    carried('laika', 'Twice, two', 'ONR-12');
    // A Jira-style key the board's own key pattern does not have: an underscore.
    const jira = carried('laika', 'A Jira key', 'DATA_ENG-3');
    share(bea);
    member(bea, projectId);

    recordTokenUsage(
      t.db,
      actor(bea),
      report([
        {
          day: YESTERDAY,
          rows: [
            row({ task: 'LAI-780', output: 1 }),
            row({ task: 'JIRA-9', output: 10 }),
            row({ task: 'ONR-12', output: 100 }),
            row({ task: 'DATA_ENG-3', output: 1_000 }),
          ],
        },
      ]),
      NOW,
    );
    const rows = stored(bea);
    expect(
      rows
        .filter((r) => r.taskId !== null)
        .map((r) => ({ taskId: r.taskId, output: r.output }))
        .sort((a, b) => a.output - b.output),
    ).toEqual([
      { taskId: repoTask.id, output: 1 },
      { taskId: jira.id, output: 1_000 },
    ]);
    // A card Bea cannot read, and an id two cards carry: unattributed, never guessed.
    expect(rows.filter((r) => r.taskId === null)).toEqual([
      expect.objectContaining({ output: 110, projectId: null }),
    ]);
  });
});

/** All of a person's token rows, summed: what every read adds up. */
function grand(user: string): { output: number; rows: number } {
  const rows = stored(user);
  return { output: rows.reduce((n, r) => n + r.output, 0), rows: rows.length };
}

describe('a machine counted once across collectors (review 1, the blocker)', () => {
  /*
   * `laika activity off` deletes ~/.laika/activity, collector id included;
   * `on` makes a new one, and a yes to the 30 days sends the window again.
   * The board keeps the old collector's rows, and every read sums collectors —
   * so without this rule the same machine's days would count twice.
   */
  it('on, yes, off, on, yes: a backfilled day replaces every collector’s rows for it — totals unchanged', () => {
    share(bea);
    const days = [
      { day: '2026-10-01', rows: [row({ output: 700 })] },
      {
        day: '2026-10-10',
        rows: [row({ output: 900 }), row({ agent: 'codex', model: 'gpt-5.2-codex', output: 40 })],
      },
    ];
    // The first collector: on, yes — the window, marked backfilled.
    recordTokenUsage(t.db, actor(bea), report(days.map((d) => ({ ...d, backfill: true }))), NOW);
    const before = grand(bea);
    expect(before.output).toBe(1_640);

    // off, on, yes: a new collector sends the same window, backfilled again.
    recordTokenUsage(
      t.db,
      actor(bea),
      report(
        days.map((d) => ({ ...d, backfill: true })),
        { collector_id: COLLECTOR_B },
      ),
      NOW,
    );
    expect(grand(bea)).toEqual(before);
    expect(new Set(stored(bea).map((r) => r.collectorId))).toEqual(new Set([COLLECTOR_B]));
  });

  it('a backfilled day takes only the agents it names from other collectors', () => {
    share(bea);
    recordTokenUsage(
      t.db,
      actor(bea),
      report([
        {
          day: '2026-10-10',
          rows: [row({ output: 900 }), row({ agent: 'codex', model: 'gpt-5.2-codex', output: 40 })],
        },
      ]),
      NOW,
    );
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: '2026-10-10', backfill: true, rows: [row({ output: 950 })] }], {
        collector_id: COLLECTOR_B,
      }),
      NOW,
    );
    // Claude Code's 900 replaced by 950; the other collector's Codex is its own.
    expect(grand(bea).output).toBe(990);
  });

  it('two machines sending live days add up', () => {
    share(bea);
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row({ output: 300 })] }]),
      NOW,
    );
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row({ output: 200 })] }], { collector_id: COLLECTOR_B }),
      NOW,
    );
    // And a live resend of either replaces only its own.
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: YESTERDAY, rows: [row({ output: 350 })] }]),
      NOW,
    );
    expect(grand(bea)).toEqual({ output: 550, rows: 2 });
  });

  it('tells a sender which days other collectors already hold tokens for — dates only', () => {
    share(bea);
    recordTokenUsage(
      t.db,
      actor(bea),
      report([
        { day: '2026-10-01', rows: [row()] },
        { day: YESTERDAY, rows: [row()] },
      ]),
      NOW,
    );
    recordTokenUsage(
      t.db,
      actor(bea),
      report([{ day: TODAY, rows: [row()] }], { collector_id: COLLECTOR_B }),
      NOW,
    );
    const asB = getActivitySharing(t.db, withToken(bea), COLLECTOR_B, NOW);
    expect(asB.usage_days_elsewhere).toEqual(['2026-10-01', YESTERDAY]);
    // Not to a read-only token, which may not send; not without a collector.
    expect(
      getActivitySharing(t.db, withToken(bea, 'read_only'), COLLECTOR_B, NOW),
    ).not.toHaveProperty('usage_days_elsewhere');
    expect(getActivitySharing(t.db, withToken(bea), undefined, NOW)).not.toHaveProperty(
      'usage_days_elsewhere',
    );
    // Nor once sharing is off.
    share(bea, false);
    expect(getActivitySharing(t.db, withToken(bea), COLLECTOR_B, NOW)).not.toHaveProperty(
      'usage_days_elsewhere',
    );
  });
});

describe('the developer’s own history', () => {
  it('*delete my history* deletes token rows too', () => {
    share(bea);
    recordTokenUsage(t.db, actor(bea), report([{ day: YESTERDAY, rows: [row()] }]), NOW);
    share(cal);
    recordTokenUsage(t.db, actor(cal), report([{ day: YESTERDAY, rows: [row()] }]), NOW);

    const zones = () =>
      t.db
        .select({ userId: tokenUsageZones.userId })
        .from(tokenUsageZones)
        .all()
        .map((z) => z.userId)
        .sort();
    expect(zones()).toEqual([bea, cal].sort());

    deleteOwnLocalActivity(t.db, actor(bea));
    expect(stored(bea)).toHaveLength(0);
    expect(stored(cal)).toHaveLength(1);
    // And the zone its reports stated (review B1), which came with them.
    expect(zones()).toEqual([cal]);
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
      // API-equivalent (LAI-773): Opus 5.5's 110 / 220 / 330 / 51,000 at
      // $4 / $20 / $5 / $0.20 a million, and the Codex row at gpt-5.2's
      // rates — a price inferred, and said to be.
      cost: view.totals.cost,
    });
    expect(view.totals.cost.usd).toBeCloseTo(
      (440 + 4_400 + 1_650 + 10_200 + 1.75 + 28 + 5.25 + 0.7) / 1e6,
      12,
    );
    expect(view.totals.cost).toMatchObject({
      unpriced_tokens: 0,
      unpriced_models: [],
      unconfirmed_models: ['gpt-5.2-codex'],
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

  it('beside a space, says what no space can hold: the organisation’s unattributed share, to owners and admins', () => {
    seedUsage();
    const asOwner = getUsage(t.db, actor(owner), { days: 7, project: 'laika' }, NOW);
    expect(asOwner.org_totals).toMatchObject({ tokens: 666, attributed_tokens: 6 });
    expect(getUsage(t.db, actor(bea), { days: 7, project: 'laika' }, NOW).org_totals).toBeNull();
    expect(getUsage(t.db, actor(owner), { days: 7 }, NOW).org_totals).toBeNull();
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
    // LAI-773: what the new figures read.
    [
      'org by developer and model (each priced)',
      `SELECT user_id, model, ${SUMS}, sum(input), sum(output), sum(cache_write) FROM token_usage_days WHERE ${RANGE} GROUP BY user_id, model`,
      ['a', 'b'],
    ],
    [
      'org totals by model (beside a space)',
      `SELECT model, ${SUMS}, sum(input), sum(output) FROM token_usage_days WHERE ${RANGE} GROUP BY model`,
      ['a', 'b'],
    ],
    [
      'what telemetry added',
      `SELECT ${SUMS} FROM token_usage_days WHERE collector_id = 'telemetry' AND ${RANGE}`,
      ['a', 'b'],
    ],
    [
      'who used each agent and model (review B2)',
      `SELECT agent, model, user_id FROM token_usage_days WHERE ${RANGE} GROUP BY agent, model, user_id`,
      ['a', 'b'],
    ],
    [
      'who used each agent and model in a space (review B2)',
      `SELECT agent, model, user_id FROM token_usage_days WHERE project_id = ? AND ${RANGE} GROUP BY agent, model, user_id`,
      ['p', 'a', 'b'],
    ],
    [
      'cache by project and model',
      `SELECT project_id, model, sum(input), sum(cache_write), sum(cache_read) FROM token_usage_days WHERE project_id IN (?, ?) AND ${RANGE} GROUP BY project_id, model`,
      ['p', 'q', 'a', 'b'],
    ],
  ];

  // D-091: `by_developer` leaves automated rows out, and still never touches
  // the table — the flag is the day and project indexes' last column.
  for (const [name, statement, params] of [
    [
      'org by developer and model, a person’s own rows (D-091)',
      `SELECT user_id, model, ${SUMS}, sum(input), sum(output), sum(cache_write) FROM token_usage_days WHERE ${RANGE} AND automated = 0 GROUP BY user_id, model`,
      ['a', 'b'],
    ],
    [
      'project by developer and model, a person’s own rows (D-091)',
      `SELECT user_id, model, ${SUMS} FROM token_usage_days WHERE project_id = ? AND ${RANGE} AND automated = 0 GROUP BY user_id, model`,
      ['p', 'a', 'b'],
    ],
  ] as const) {
    it(name, () => {
      expect(
        plan(statement, [...params]).filter((s) =>
          s.startsWith('SEARCH token_usage_days USING COVERING INDEX '),
        ),
      ).toHaveLength(1);
    });
  }

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

describe('an agent or model fewer than three people used is folded for a reader who may not see people (review B2)', () => {
  /** The project's Codex spend, Bea's alone in seedUsage: 1 + 2 + 3 tokens. */
  const BEA_CODEX = 6;

  function listedNames(view: ReturnType<typeof getUsage>) {
    return {
      agents: view.by_agent.filter((a) => a.few_people === undefined).map((a) => a.agent),
      models: view.by_model.filter((m) => m.few_people === undefined).map((m) => m.model),
    };
  }

  it('shows a member no row one person’s spend makes, and folds it into “fewer than three people”', () => {
    seedUsage();
    const view = getUsage(t.db, actor(cal), { days: 7, project: 'laika' }, NOW);
    expect(listedNames(view)).toEqual({ agents: [], models: [] });
    expect(view.by_agent).toEqual([
      { agent: 'other', tokens: BEA_CODEX, cache_read: 4, few_people: 1 },
    ]);
    const folded = view.by_model.find((m) => m.few_people !== undefined);
    expect(folded).toMatchObject({ model: 'other', tokens: BEA_CODEX, few_people: 1 });
    // Its cost is the folded row's, never a model's of its own.
    expect(folded?.cost).toBeGreaterThan(0);
    expect(view.by_model.some((m) => m.model === 'gpt-5.2-codex')).toBe(false);
  });

  it('cannot be read around by subtraction: the listed rows hold only agents and models of three people or more', () => {
    seedUsage();
    // Bea's Claude Code row and a third person's put Claude Code at three people
    // in the organisation's figures; Codex stays Bea's alone.
    const dee = makeUser('Dee', 'member');
    member(dee, projectId);
    share(dee);
    recordTokenUsage(
      t.db,
      actor(dee),
      report([{ day: TODAY, rows: [row({ input: 1, output: 1, cache_write: 1, cache_read: 1 })] }]),
      NOW,
    );
    const token = withToken(owner, 'read_only');
    const view = getUsage(t.db, token, { days: 7 }, NOW);
    expect(view.by_developer).toBeNull();
    expect(listedNames(view)).toEqual({ agents: ['claude-code'], models: ['claude-opus-5-5'] });
    const listed = view.by_agent.filter((a) => a.few_people === undefined);
    // What the total leaves once the listed rows are taken away is the folded
    // row — "fewer than three people" — and no single agent's own figure.
    const rest = view.totals.tokens - listed.reduce((n, a) => n + a.tokens, 0);
    expect(rest).toBe(BEA_CODEX);
    expect(view.by_agent.find((a) => a.few_people !== undefined)).toEqual({
      agent: 'other',
      tokens: rest,
      cache_read: 4,
      few_people: 1,
    });
  });

  it('lists an agent once three people have used it in the scope', () => {
    const { taskKey } = seedUsage();
    for (const name of ['Dee', 'Eve']) {
      const id = makeUser(name, 'member');
      member(id, projectId);
      share(id);
      recordTokenUsage(
        t.db,
        actor(id),
        report([
          { day: TODAY, rows: [row({ agent: 'codex', model: 'gpt-5.2-codex', task: taskKey })] },
        ]),
        NOW,
      );
    }
    const view = getUsage(t.db, actor(cal), { days: 7, project: 'laika' }, NOW);
    expect(listedNames(view)).toEqual({ agents: ['codex'], models: ['gpt-5.2-codex'] });
    expect(view.by_agent.some((a) => a.few_people !== undefined)).toBe(false);
  });

  it('shows owners and admins on a session everything, as before', () => {
    seedUsage();
    const view = getUsage(t.db, actor(owner), { days: 7, project: 'laika' }, NOW);
    expect(listedNames(view)).toEqual({ agents: ['codex'], models: ['gpt-5.2-codex'] });
    expect(view.by_agent.every((a) => a.few_people === undefined)).toBe(true);
  });

  it('folds the accepted-cost card the same way, tokens and cost', () => {
    const { taskKey } = seedUsage();
    const task = t.db
      .select()
      .from(tasks)
      .all()
      .find((x) => `LAI-${String(x.number)}` === taskKey)!;
    const round = newId();
    t.db
      .insert(taskRounds)
      .values({
        id: round,
        taskId: task.id,
        number: 1,
        finishedBy: bea,
        summaryMd: 'done',
        createdAt: NOW - 3_600_000,
      })
      .run();
    t.db
      .insert(taskReviews)
      .values({
        id: newId(),
        taskId: task.id,
        roundId: round,
        decision: 'accepted',
        decidedBy: owner,
        createdAt: NOW - 1_800_000,
      })
      .run();

    const member = getUsage(t.db, actor(cal), { days: 7, project: 'laika' }, NOW).accepted;
    expect(member.by_agent).toHaveLength(1);
    expect(member.by_agent[0]).toMatchObject({
      agent: 'other',
      tasks: 1,
      tokens: BEA_CODEX,
      few_people: 1,
    });
    expect(member.by_agent[0]?.cost.usd).toBeGreaterThan(0);
    expect(member.agents_withheld).toBe(1);

    const admin = getUsage(t.db, actor(owner), { days: 7, project: 'laika' }, NOW).accepted;
    expect(admin.by_agent.map((a) => [a.agent, a.few_people])).toEqual([['codex', undefined]]);
    expect(admin.agents_withheld).toBe(0);
  });
});

describe('the Usage page’s work does not grow with the people in it (LAI-773, LAI-779)', () => {
  let made = 0;
  function people(n: number): void {
    for (let i = made; i < made + n; i += 1) {
      const id = makeUser(`P${String(i).padStart(3, '0')}`, 'member');
      for (const model of ['claude-opus-5-5', 'claude-sonnet-5', 'mystery-model']) {
        t.db
          .insert(tokenUsageDays)
          .values({
            userId: id,
            collectorId: COLLECTOR_A,
            day: YESTERDAY,
            agent: 'claude-code',
            model,
            taskId: null,
            projectId: null,
            input: 1,
            output: 2,
            cacheWrite: 3,
            cacheRead: 40,
            updatedAt: NOW,
          })
          .run();
      }
    }
    made += n;
  }

  it('prices, splits and counts in the same statements for 3 people as for 30', () => {
    people(3);
    const small = work(t.sqlite, () => {
      getUsage(t.db, actor(owner), { days: 30 }, NOW);
    });
    people(27);
    const large = work(t.sqlite, () => {
      getUsage(t.db, actor(owner), { days: 30 }, NOW);
    });
    expect(large.statements).toBe(small.statements);
    expect(large.scans.filter((s) => s.includes('token_usage_days'))).toEqual([]);
    // An unknown model is no price, never zero.
    const view = getUsage(t.db, actor(owner), { days: 30 }, NOW);
    expect(view.by_model.find((m) => m.model === 'mystery-model')?.cost).toBeNull();
    expect(view.totals.cost.unpriced_models).toEqual(['mystery-model']);
    expect(view.totals.cost.unpriced_tokens).toBe(30 * 6);
    expect(view.cache.share).toBeCloseTo(40 / 44, 10);
    // Cost beside each name, for an owner on a session, in name order.
    expect(view.by_developer?.[0]?.cost.unpriced_tokens).toBe(6);
  });
});

// ------------------------------------------------- phase 2: tasks (LAI-770)

describe('the task key prefixes a collector may tie tokens to (LAI-770)', () => {
  function hiddenProject(): void {
    t.db
      .insert(projects)
      .values({
        id: newId(),
        orgId,
        name: 'Hidden',
        slug: 'hidden',
        prefix: 'HID',
        visibility: 'private',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  }

  it('names the prefixes of the projects the sender may read, and nothing else', () => {
    hiddenProject();
    share(bea);
    member(bea, projectId);
    share(owner);
    expect(getActivitySharing(t.db, withToken(bea), COLLECTOR_A, NOW).task_prefixes).toEqual([
      'LAI',
    ]);
    expect(getActivitySharing(t.db, withToken(owner), COLLECTOR_A, NOW).task_prefixes).toEqual([
      'HID',
      'LAI',
    ]);
  });

  it('is given only to a collector that may send, with both switches on', () => {
    member(bea, projectId);
    share(bea);
    expect(getActivitySharing(t.db, withToken(bea), undefined, NOW)).not.toHaveProperty(
      'task_prefixes',
    );
    expect(
      getActivitySharing(t.db, withToken(bea, 'read_only'), COLLECTOR_A, NOW),
    ).not.toHaveProperty('task_prefixes');
    share(bea, false);
    expect(getActivitySharing(t.db, withToken(bea), COLLECTOR_A, NOW)).not.toHaveProperty(
      'task_prefixes',
    );
  });

  it('adds the prefixes of outside ids on cards the sender may read, and only those (LAI-780)', () => {
    createProject(t.sqlite, t.db, actor(owner), {
      name: 'Hidden',
      slug: 'hidden',
      prefix: 'HID',
      visibility: 'private',
      now: NOW,
    });
    const carry = (slug: string, ref: string) => {
      const task = createTask(t.sqlite, t.db, actor(owner), slug, { title: ref, now: NOW });
      t.db.update(tasks).set({ externalRef: ref }).where(eq(tasks.id, task.id)).run();
    };
    carry('laika', 'LAIKA-780');
    carry('laika', 'kvell/laika#221');
    carry('hidden', 'SECRET-1');
    share(bea);
    member(bea, projectId);
    share(owner);

    expect(getActivitySharing(t.db, withToken(bea), COLLECTOR_A, NOW).task_prefixes).toEqual([
      'LAI',
      'LAIKA',
    ]);
    expect(getActivitySharing(t.db, withToken(owner), COLLECTOR_A, NOW).task_prefixes).toEqual([
      'HID',
      'LAI',
      'LAIKA',
      'SECRET',
    ]);
  });
});

describe('GET /tasks/:id/usage — a task’s tokens (LAI-770)', () => {
  const DAY_1 = '2026-10-12';
  const DAY_2 = '2026-10-14';
  const DAY_3 = '2026-10-16';

  /**
   * One task two people worked on, from two machines and two agents, beside
   * tokens of theirs tied to nothing on the same days and on a day the task
   * had none.
   */
  function seedTask(): { id: string; key: string } {
    const task = createTask(t.sqlite, t.db, actor(owner), 'laika', { title: 'Shared', now: NOW });
    member(bea, projectId);
    member(cal, projectId);
    share(bea);
    share(cal);
    const tied = (extra: Partial<TokenUsageRowInput>) => row({ task: task.key, ...extra });
    recordTokenUsage(
      t.db,
      actor(bea),
      report([
        {
          day: DAY_1,
          rows: [
            tied({ input: 10, output: 20, cache_write: 30, cache_read: 1_000 }),
            // Tied to nothing, the same day: in the share's whole, not the task's.
            row({ input: 40, output: 0, cache_write: 0, cache_read: 7 }),
          ],
        },
        { day: DAY_3, rows: [tied({ input: 1, output: 2, cache_write: 3, cache_read: 4 })] },
        // A day the task had nothing: in neither.
        { day: TODAY, rows: [row({ input: 5_000, output: 0, cache_write: 0, cache_read: 0 })] },
      ]),
      NOW,
    );
    recordTokenUsage(
      t.db,
      actor(cal),
      report(
        [
          {
            day: DAY_2,
            rows: [
              tied({
                agent: 'codex',
                model: 'gpt-5.2-codex',
                input: 100,
                output: 200,
                cache_write: 300,
                cache_read: 50,
              }),
            ],
          },
        ],
        { collector_id: COLLECTOR_B },
      ),
      NOW,
    );
    return { id: task.id, key: task.key };
  }

  /** A finish of the task at `at`, as `finish_task` writes one. */
  function round(taskId: string, number: number, at: number): void {
    t.db
      .insert(taskRounds)
      .values({
        id: newId(),
        taskId,
        number,
        finishedBy: bea,
        summaryMd: 'done',
        createdAt: at,
      })
      .run();
  }

  it('adds up every person’s tokens on it: headline without cache reads, cache reads beside it', () => {
    const task = seedTask();
    const view = getTaskUsage(t.db, actor(owner), task.id, {});
    expect(view).toMatchObject({
      task_id: task.id,
      key: task.key,
      first_day: DAY_1,
      last_day: DAY_3,
    });
    expect(view.totals).toMatchObject({
      tokens: 60 + 6 + 600,
      input: 111,
      output: 222,
      cache_write: 333,
      cache_read: 1_054,
    });
    // Priced, never zero for what has no price (LAI-773).
    expect(view.totals.cost.usd + view.totals.cost.unpriced_tokens).toBeGreaterThan(0);
  });

  it('splits it per person and agent for an owner, in name order — never ranked', () => {
    const task = seedTask();
    const view = getTaskUsage(t.db, actor(owner), task.id, {});
    expect(view.people).toBe('everyone');
    expect(
      view.by_person?.map((p) => [p.name, p.tokens, p.by_agent.map((a) => [a.agent, a.tokens])]),
    ).toEqual([
      ['Bea', 66, [['claude-code', 66]]],
      ['Cal', 600, [['codex', 600]]],
    ]);
  });

  it('gives a member their own part and nobody else’s; a member who did none, the total only', () => {
    const task = seedTask();
    const asBea = getTaskUsage(t.db, actor(bea), task.id, {});
    expect(asBea.people).toBe('own');
    expect(asBea.by_person?.map((p) => p.name)).toEqual(['Bea']);
    expect(asBea.totals.tokens).toBe(666);
    expect(JSON.stringify(asBea)).not.toContain(cal);

    const dan = makeUser('Dan', 'member');
    member(dan, projectId);
    const asDan = getTaskUsage(t.db, actor(dan), task.id, {});
    expect(asDan.by_person).toEqual([]);
    expect(asDan.attributed).toBeNull();
    expect(asDan.totals.tokens).toBe(666);
    expect(JSON.stringify(asDan)).not.toContain(bea);
    expect(JSON.stringify(asDan)).not.toContain(cal);
  });

  it('gives a token the total only, even an owner’s full one', () => {
    const task = seedTask();
    const view = getTaskUsage(t.db, withToken(owner), task.id, {});
    expect(view.people).toBe('none');
    expect(view.by_person).toBeNull();
    expect(view.attributed).toBeNull();
    expect(view.totals.tokens).toBe(666);
  });

  it('says how much of what its people spent on those days is tied to a task', () => {
    const task = seedTask();
    // Bea: 60 + 40 on DAY_1 and 6 on DAY_3 — TODAY's 5,000 is not a day of
    // this task's. Cal: 600 on DAY_2, all of it tied.
    expect(getTaskUsage(t.db, actor(owner), task.id, {}).attributed).toEqual({
      tokens: 666,
      of: 706,
    });
    expect(getTaskUsage(t.db, actor(bea), task.id, {}).attributed).toEqual({
      tokens: 66,
      of: 106,
    });
  });

  it('splits it by review round, by day: a round’s finish day counts toward it', () => {
    const task = seedTask();
    // Round 1 handed in on DAY_1, round 2 on DAY_2; DAY_3 is the open round.
    round(task.id, 1, Date.UTC(2026, 9, 12, 15));
    round(task.id, 2, Date.UTC(2026, 9, 14, 9));
    expect(getTaskUsage(t.db, actor(bea), task.id, {}).by_round).toEqual([
      { number: 1, finished_on: DAY_1, tokens: 60, cache_read: 1_000 },
      { number: 2, finished_on: DAY_2, tokens: 600, cache_read: 50 },
      { number: 3, finished_on: null, tokens: 6, cache_read: 4 },
    ]);
  });

  it('reads a finish’s day in the reader’s zone', () => {
    const task = seedTask();
    // 22:30 UTC on the 13th is the 14th in Kolkata, so DAY_2's tokens are
    // round 1's there and the open round's in UTC.
    round(task.id, 1, Date.UTC(2026, 9, 13, 22, 30));
    const utc = getTaskUsage(t.db, actor(bea), task.id, { tz: 'UTC' }).by_round;
    const ist = getTaskUsage(t.db, actor(bea), task.id, { tz: 'Asia/Kolkata' }).by_round;
    expect(utc[0]).toMatchObject({ number: 1, finished_on: '2026-10-13', tokens: 60 });
    expect(ist[0]).toMatchObject({ number: 1, finished_on: '2026-10-14', tokens: 660 });
  });

  it('with no tokens, says so: zeros, no rounds, no days', () => {
    const task = createTask(t.sqlite, t.db, actor(owner), 'laika', { title: 'Quiet', now: NOW });
    const view = getTaskUsage(t.db, actor(owner), task.id, {});
    expect(view.totals.tokens).toBe(0);
    expect(view.by_round).toEqual([]);
    expect(view.by_person).toEqual([]);
    expect(view.first_day).toBeNull();
  });

  it('refuses a reader who may not read the task’s project', () => {
    const task = seedTask();
    t.db.update(projects).set({ visibility: 'private' }).where(eq(projects.id, projectId)).run();
    const outsider = makeUser('Out', 'member');
    expect(refusal(() => getTaskUsage(t.db, actor(outsider), task.id, {}))).toMatchObject({
      code: 'forbidden',
    });
    // A task that does not exist is not_found, whoever asks.
    expect(refusal(() => getTaskUsage(t.db, actor(outsider), 'nope', {}))).toMatchObject({
      code: 'not_found',
    });
  });

  it('reads the task’s rows through its index', () => {
    const steps = (
      t.sqlite
        .prepare(
          'EXPLAIN QUERY PLAN SELECT sum(input + output + cache_write) FROM token_usage_days WHERE task_id = ?',
        )
        .all('x') as { detail: string }[]
    ).map((r) => r.detail);
    expect(steps.filter((s) => /^SCAN token_usage_days\b/.test(s))).toEqual([]);
    expect(steps.some((s) => s.includes('token_usage_days_task_idx'))).toBe(true);
  });
});
