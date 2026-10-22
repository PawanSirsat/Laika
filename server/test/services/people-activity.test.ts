import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { recordLocalActivity, type ReportDay } from '../../src/services/local-activity.ts';
import { getPeopleActivity } from '../../src/services/people-activity.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, preparedDuring, seed, type TestDb } from '../helpers/db.ts';

/**
 * The profile's heatmap read (SPEC §6.4, §11.4.2, D-079, LAI-751).
 *
 * `NOW` is Wednesday 14 October 2026, 20:00 UTC — late enough that the day is
 * already the 15th in Kolkata, which is how the zone rule is proved.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 14, 20);
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const OTHER_COLLECTOR = '0b4e7d2a-91c3-4f6e-8a1d-5c2b9e7f3a10';

let t: TestDb;
let orgId: string;
let projectId: string;
let owner: string;
let admin: string;
let bea: string;

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW - 400 * DAY),
      updatedAt: new Date(NOW - 400 * DAY),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function withToken(userId: string): ResolvedActor {
  return { ...actor(userId), token: { id: 'tok_x', scope: 'full', projectIds: null } };
}

function refusal(fn: () => unknown): { code: string; details: unknown } | string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return { code: err.code, details: err.details };
    throw err;
  }
  return 'no error';
}

/** One board action by `userId` at `at`, through the one write path. */
function act(userId: string, kind: 'user' | 'agent' | 'system', at: number): void {
  appendActivity(t.db, {
    orgId,
    projectId,
    actorId: kind === 'system' ? null : userId,
    actorKind: kind,
    actorTokenId: kind === 'agent' ? 'tok_x' : null,
    type: 'task.updated',
    now: at,
  });
}

function share(on: { org: boolean; user: boolean }): void {
  t.db
    .update(orgs)
    .set({ developerInsights: on.org ? 1 : 0 })
    .where(eq(orgs.id, orgId))
    .run();
  t.db
    .update(users)
    .set({ shareLocalActivity: on.user ? 1 : 0 })
    .where(eq(users.id, bea))
    .run();
}

function send(days: Partial<ReportDay>[], extra: { tz?: string; collector?: string } = {}): void {
  recordLocalActivity(
    t.db,
    actor(bea),
    {
      v: 1,
      collector_id: extra.collector ?? COLLECTOR,
      tz: extra.tz ?? 'UTC',
      days: days.map((d) => ({
        day: d.day ?? '2026-10-14',
        prompts: d.prompts ?? {},
        sessions: d.sessions ?? 0,
        commits_local: d.commits_local ?? 0,
        pushed_keys: d.pushed_keys ?? [],
      })),
    },
    NOW,
  );
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW - 400 * DAY);
  orgId = s.orgId;
  projectId = s.projectId;
  owner = s.userId;
  admin = makeUser('Ari', 'admin');
  bea = makeUser('Bea', 'member');
});

afterEach(() => {
  t.close();
});

describe('who may ask (§3.1, D-079)', () => {
  it('answers an owner and an admin on a session', () => {
    expect(getPeopleActivity(t.db, actor(owner), bea, '12w', NOW).range).toBe('12w');
    expect(getPeopleActivity(t.db, actor(admin), bea, '12w', NOW).range).toBe('12w');
  });

  it('refuses a member — about anyone, themselves included', () => {
    for (const target of [bea, admin]) {
      expect(refusal(() => getPeopleActivity(t.db, actor(bea), target, '12w', NOW))).toEqual({
        code: 'forbidden',
        details: { action: 'profile.activity.read' },
      });
    }
  });

  it('refuses every token, an owner’s included, and says a session is what is missing', () => {
    expect(refusal(() => getPeopleActivity(t.db, withToken(owner), bea, '12w', NOW))).toEqual({
      code: 'forbidden',
      details: { action: 'profile.activity.read', reason: 'session_required' },
    });
  });

  it('asks before it looks: an unknown id is not_found only to someone who may ask', () => {
    expect(
      refusal(() => getPeopleActivity(t.db, actor(admin), 'nobody', '12w', NOW)),
    ).toMatchObject({ code: 'not_found' });
    expect(refusal(() => getPeopleActivity(t.db, actor(bea), 'nobody', '12w', NOW))).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('the days', () => {
  it('gives one integer per day for twelve weeks and for fifty-two, ending today', () => {
    const w12 = getPeopleActivity(t.db, actor(owner), bea, '12w', NOW);
    expect([w12.start, w12.end, w12.tz]).toEqual(['2026-07-23', '2026-10-14', 'UTC']);
    expect(w12.series.board_self).toHaveLength(84);
    expect(w12.series.board_agent).toHaveLength(84);

    const w52 = getPeopleActivity(t.db, actor(owner), bea, '52w', NOW);
    expect([w52.start, w52.end]).toEqual(['2025-10-16', '2026-10-14']);
    expect(w52.series.board_self).toHaveLength(364);
  });
});

describe('board actions — always there, from the rollup of the log', () => {
  it('counts their own actions and their agents’ apart, by UTC day, and nobody else’s', () => {
    act(bea, 'user', Date.UTC(2026, 9, 14, 9));
    act(bea, 'user', Date.UTC(2026, 9, 14, 23, 59)); // still the 14th in UTC
    act(bea, 'agent', Date.UTC(2026, 9, 14, 10));
    act(bea, 'agent', Date.UTC(2026, 9, 13, 0, 0)); // the first instant of the 13th
    act(bea, 'system', Date.UTC(2026, 9, 14, 11)); // nobody's
    act(admin, 'user', Date.UTC(2026, 9, 14, 12)); // somebody else's
    act(bea, 'user', Date.UTC(2026, 6, 22, 23)); // the day before the 12-week window

    const { series } = getPeopleActivity(t.db, actor(owner), bea, '12w', NOW);
    expect(series.board_self.at(-1)).toBe(2);
    expect(series.board_agent.at(-1)).toBe(1);
    expect(series.board_agent.at(-2)).toBe(1);
    expect(series.board_self.reduce((a, b) => a + b, 0)).toBe(2);
    expect(series.board_agent.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('is what the real services write: a task created on a session, and one with a token', () => {
    // `createTask` stamps the real clock, so this reads at the real clock too.
    // Ari is an admin: implicit lead, so no membership row is needed.
    createTask(t.sqlite, t.db, actor(admin), 'laika', { title: 'By hand' });
    createTask(t.sqlite, t.db, withToken(admin), 'laika', { title: 'By an agent' });

    const { series } = getPeopleActivity(t.db, actor(owner), admin, '12w', Date.now());
    expect([series.board_self.at(-1), series.board_agent.at(-1)]).toEqual([1, 1]);
  });
});

describe('local work and pushed commits — only with the organisation\'s switch on', () => {
  beforeEach(() => {
    share({ org: true, user: true });
    send([
      {
        day: '2026-10-14',
        prompts: { 'claude-code': 18, codex: 5 },
        sessions: 3,
        commits_local: 2,
        pushed_keys: ['a1b2c3d4e5f6a7b8', 'b1b2c3d4e5f6a7b8'],
      },
      { day: '2026-10-12', prompts: { codex: 30 }, pushed_keys: ['c1b2c3d4e5f6a7b8'] },
    ]);
    // A second machine the same day: sums, and its copy of a key counts once.
    send(
      [
        {
          day: '2026-10-14',
          prompts: { 'claude-code': 2 },
          sessions: 1,
          pushed_keys: ['a1b2c3d4e5f6a7b8'],
        },
      ],
      { collector: OTHER_COLLECTOR },
    );
  });

  it('sums every machine, counts distinct pushed keys, and breaks prompts down by agent', () => {
    const view = getPeopleActivity(t.db, actor(owner), bea, '12w', NOW);

    expect(view.sharing).toEqual({ org_enabled: true, enabled: true });
    expect(view.series.github?.at(-1)).toBe(2);
    expect(view.series.github?.at(-3)).toBe(1);
    expect(view.series.local_commits?.at(-1)).toBe(2);
    expect(view.series.prompts?.at(-1)).toBe(25);
    expect(view.series.sessions?.at(-1)).toBe(4);
    expect(view.prompts_by_agent).toEqual({
      '2026-10-14': { 'claude-code': 20, codex: 5 },
      '2026-10-12': { codex: 30 },
    });
    // Codex 35, Claude Code 20: most first.
    expect(view.agents).toEqual(['codex', 'claude-code']);
  });

  it('is null — not zeros — once the organisation turned it off, though the rows are still held', () => {
    share({ org: false, user: true });
    const view = getPeopleActivity(t.db, actor(owner), bea, '52w', NOW);

    expect(view.sharing).toEqual({ org_enabled: false, enabled: false });
    expect(view.series).toMatchObject({
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
    });
    expect(view.prompts_by_agent).toEqual({});
    expect(view.agents).toEqual([]);
    expect(view.tz).toBe('UTC');
  });

  it('is shown whatever the person\'s old switch says — the organisation\'s alone decides (D-102 amended)', () => {
    share({ org: true, user: false });
    const view = getPeopleActivity(t.db, actor(owner), bea, '12w', NOW);

    expect(view.sharing).toEqual({ org_enabled: true, enabled: true });
    expect(view.series.github?.at(-1)).toBe(2);
    expect(view.series.prompts?.at(-1)).toBe(25);
    expect(view.agents).toEqual(['codex', 'claude-code']);
  });

  it('ends on today in the zone of their latest report', () => {
    // 20:00 UTC on the 14th is already the 15th in Kolkata.
    send([{ day: '2026-10-15', sessions: 1 }], { tz: 'Asia/Kolkata' });
    const view = getPeopleActivity(t.db, actor(owner), bea, '12w', NOW);
    expect([view.tz, view.end, view.start]).toEqual(['Asia/Kolkata', '2026-10-15', '2026-07-24']);
    expect(view.series.sessions?.at(-1)).toBe(1);
    expect(view.series.sessions?.at(-2)).toBe(4);
  });
});

describe('bounded reads (D-079 item 5)', () => {
  it('reads every table through an index, one person’s days at a time, never sorting, never the log', () => {
    share({ org: true, user: true });
    send([{ day: '2026-10-14', sessions: 1, pushed_keys: ['a1b2c3d4e5f6a7b8'] }]);
    act(bea, 'user', NOW - HOUR);

    const statements = preparedDuring(t.sqlite, () =>
      getPeopleActivity(t.db, actor(owner), bea, '52w', NOW),
    );
    expect(statements.length).toBeGreaterThan(0);

    const touched = statements.filter((sql) => /\b"?activity"?\b/.test(sql));
    expect(touched, 'a read of the activity log').toEqual([]);

    for (const source of statements) {
      const bindings = Array.from({ length: (source.match(/\?/g) ?? []).length }, () => 'x');
      const plan = (
        t.sqlite.prepare(`EXPLAIN QUERY PLAN ${source}`).all(...bindings) as { detail: string }[]
      ).map((row) => row.detail);
      // `orgs` holds exactly one row (§4.2): reading it whole is reading one row.
      const scans = plan.filter(
        (line) =>
          (line.startsWith('SCAN ') && !/^SCAN orgs\b/.test(line)) || line.includes('TEMP B-TREE'),
      );
      expect(scans, `${source}\n${plan.join('\n')}`).toEqual([]);
    }

    const heatmapReads = statements.filter((sql) =>
      /board_activity_days|local_activity_days|pushed_commit_keys/.test(sql),
    );
    expect(heatmapReads.length).toBeGreaterThanOrEqual(3);
  });
});
