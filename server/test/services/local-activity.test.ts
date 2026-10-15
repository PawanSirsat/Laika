import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, localActivityDays, orgs, pushedCommitKeys, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  agentKindOf,
  deleteOwnLocalActivity,
  getActivitySharing,
  getOwnLocalActivity,
  type LocalActivityReport,
  MIN_SYNC_INTERVAL_S,
  recordLocalActivity,
  type ReportDay,
  setActivitySharing,
} from '../../src/services/local-activity.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * A developer's local activity counts (SPEC §6.4, §4.23, §4.24, D-079,
 * LAI-751).
 *
 * The clock is injected: `NOW` is Wednesday 14 October 2026, noon UTC, so the
 * report window — today − 14 to today + 1 in the sender's zone — is the same
 * on any day this runs (CONVENTIONS §4).
 */

const NOW = Date.UTC(2026, 9, 14, 12);
const TODAY = '2026-10-14';
const COLLECTOR_A = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const COLLECTOR_B = '0b4e7d2a-91c3-4f6e-8a1d-5c2b9e7f3a10';

let t: TestDb;
let orgId: string;
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

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function withToken(userId: string, scope: 'full' | 'read_only' = 'full'): ResolvedActor {
  return { ...actor(userId), token: { id: 'tok_x', scope, projectIds: null } };
}

/** The error a call throws, as `code` and `details` — or `'no error'`. */
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

function day(d: string, extra: Partial<ReportDay> = {}): ReportDay {
  return { day: d, prompts: {}, sessions: 0, commits_local: 0, pushed_keys: [], ...extra };
}

function report(days: ReportDay[], extra: Partial<LocalActivityReport> = {}): LocalActivityReport {
  return { v: 1, collector_id: COLLECTOR_A, tz: 'UTC', days, ...extra };
}

function switches(org: boolean, user: string, on: boolean): void {
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

function activityRows(): number {
  return (
    t.db
      .select({ n: sql<number>`count(*)` })
      .from(activity)
      .get()?.n ?? 0
  );
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  orgId = s.orgId;
  bea = makeUser('Bea', 'member');
  cal = makeUser('Cal', 'member');
});

afterEach(() => {
  t.close();
});

describe('the sharing setting', () => {
  it('is off on both sides by default, and says how often to sync', () => {
    expect(getActivitySharing(t.db, actor(bea))).toEqual({
      org_enabled: false,
      enabled: false,
      scope: 'agent-repos',
      min_sync_interval_s: MIN_SYNC_INTERVAL_S,
    });
  });

  it('is the developer’s to set, from a session, and only their own row changes', () => {
    switches(true, cal, false);
    expect(setActivitySharing(t.db, actor(bea), { enabled: true, scope: 'laika-repos' })).toEqual({
      org_enabled: true,
      enabled: true,
      scope: 'laika-repos',
      min_sync_interval_s: MIN_SYNC_INTERVAL_S,
    });
    expect(getActivitySharing(t.db, actor(cal)).enabled).toBe(false);

    // Off again, scope kept.
    expect(setActivitySharing(t.db, actor(bea), { enabled: false })).toMatchObject({
      enabled: false,
      scope: 'laika-repos',
    });
  });

  it('refuses every token the switch — an agent must not consent for its person', () => {
    for (const scope of ['full', 'read_only'] as const) {
      expect(
        refusal(() => setActivitySharing(t.db, withToken(bea, scope), { enabled: true })),
      ).toEqual({
        code: 'forbidden',
        details: { action: 'activity_sharing.set_own', reason: 'session_required' },
      });
    }
    // Nothing changed.
    expect(getActivitySharing(t.db, actor(bea)).enabled).toBe(false);
  });

  it('may be read with a token — a read-only one included — so a collector can ask first', () => {
    switches(true, bea, true);
    expect(getActivitySharing(t.db, withToken(bea, 'read_only'))).toMatchObject({
      org_enabled: true,
      enabled: true,
    });
  });

  it('writes no activity row', () => {
    const before = activityRows();
    setActivitySharing(t.db, actor(bea), { enabled: true });
    expect(activityRows()).toBe(before);
  });
});

describe('a report is refused while either switch is off', () => {
  for (const [org, user] of [
    [false, true],
    [true, false],
    [false, false],
  ] as const) {
    it(`org ${org ? 'on' : 'off'}, developer ${user ? 'on' : 'off'}: local_activity_off, nothing kept`, () => {
      switches(org, bea, user);
      const sent = report([
        day(TODAY, { prompts: { 'claude-code': 3 }, pushed_keys: ['a1b2c3d4e5f6a7b8'] }),
      ]);

      expect(refusal(() => recordLocalActivity(t.db, actor(bea), sent, NOW))).toEqual({
        code: 'forbidden',
        details: { reason: 'local_activity_off', org_enabled: org, enabled: user },
      });
      expect(t.db.select().from(localActivityDays).all()).toEqual([]);
      expect(t.db.select().from(pushedCommitKeys).all()).toEqual([]);
    });
  }

  it('is accepted the moment both are on, and refused again the moment one goes off', () => {
    switches(true, bea, true);
    const sent = report([day(TODAY, { sessions: 1 })]);
    expect(recordLocalActivity(t.db, actor(bea), sent, NOW)).toEqual({ accepted_days: 1 });

    setActivitySharing(t.db, actor(bea), { enabled: false });
    expect(refusal(() => recordLocalActivity(t.db, actor(bea), sent, NOW))).toMatchObject({
      details: { reason: 'local_activity_off' },
    });
  });

  it('refuses a read-only token: sending is a write', () => {
    switches(true, bea, true);
    expect(
      refusal(() =>
        recordLocalActivity(t.db, withToken(bea, 'read_only'), report([day(TODAY)]), NOW),
      ),
    ).toEqual({ code: 'forbidden', details: { action: 'local_activity.send_own' } });
  });
});

describe('a report, both switches on', () => {
  beforeEach(() => {
    switches(true, bea, true);
    switches(true, cal, true);
  });

  it('answers how many days it accepted and nothing else — no data echoed', () => {
    const answer = recordLocalActivity(
      t.db,
      withToken(bea),
      report([
        day(TODAY, { prompts: { 'claude-code': 18, codex: 5 }, sessions: 3, commits_local: 2 }),
        day('2026-10-13', { pushed_keys: ['a1b2c3d4e5f6a7b8'] }),
      ]),
      NOW,
    );
    expect(answer).toEqual({ accepted_days: 2 });
    expect(Object.keys(answer)).toEqual(['accepted_days']);
  });

  it('stores counts per (person, machine, day), the prompts per agent beside their sum', () => {
    recordLocalActivity(
      t.db,
      actor(bea),
      report([
        day(TODAY, { prompts: { 'claude-code': 18, codex: 5 }, sessions: 3, commits_local: 2 }),
      ]),
      NOW,
    );
    expect(t.db.select().from(localActivityDays).all()).toEqual([
      {
        userId: bea,
        day: TODAY,
        collectorId: COLLECTOR_A,
        prompts: 23,
        promptsByAgent: JSON.stringify({ 'claude-code': 18, codex: 5 }),
        sessions: 3,
        commitsLocal: 2,
        tz: 'UTC',
        updatedAt: NOW,
      },
    ]);
  });

  it('replaces a snapshot rather than adding to it: a retry never doubles, a pushed commit leaves', () => {
    const first = report([
      day(TODAY, { prompts: { 'claude-code': 18 }, sessions: 3, commits_local: 2 }),
    ]);
    recordLocalActivity(t.db, actor(bea), first, NOW);
    recordLocalActivity(t.db, actor(bea), first, NOW + 1000); // a retry

    recordLocalActivity(
      t.db,
      actor(bea),
      // Later the same day: one more prompt, and one of the two commits pushed.
      report([day(TODAY, { prompts: { 'claude-code': 19 }, sessions: 3, commits_local: 1 })]),
      NOW + 2000,
    );

    const rows = t.db.select().from(localActivityDays).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ prompts: 19, sessions: 3, commitsLocal: 1 });
  });

  it('keeps one row per machine, so two machines sum and neither overwrites the other', () => {
    recordLocalActivity(t.db, actor(bea), report([day(TODAY, { sessions: 2 })]), NOW);
    recordLocalActivity(
      t.db,
      actor(bea),
      report([day(TODAY, { sessions: 5 })], { collector_id: COLLECTOR_B }),
      NOW,
    );
    expect(
      t.db
        .select({ c: localActivityDays.collectorId, s: localActivityDays.sessions })
        .from(localActivityDays)
        .all()
        .sort((a, b) => a.s - b.s),
    ).toEqual([
      { c: COLLECTOR_A, s: 2 },
      { c: COLLECTOR_B, s: 5 },
    ]);
  });

  it('keeps each pushed key once, at the earliest day any machine reported it', () => {
    const key = 'a1b2c3d4e5f6a7b8';
    recordLocalActivity(t.db, actor(bea), report([day('2026-10-12', { pushed_keys: [key] })]), NOW);
    // Another machine, a day earlier: the key moves back to it.
    recordLocalActivity(
      t.db,
      actor(bea),
      report([day('2026-10-11', { pushed_keys: [key.toUpperCase()] })], {
        collector_id: COLLECTOR_B,
      }),
      NOW,
    );
    // A later day again: it stays.
    recordLocalActivity(t.db, actor(bea), report([day(TODAY, { pushed_keys: [key] })]), NOW);
    // And a report without it removes nothing.
    recordLocalActivity(t.db, actor(bea), report([day('2026-10-12')]), NOW);

    expect(
      t.db
        .select({ key: pushedCommitKeys.key, day: pushedCommitKeys.day })
        .from(pushedCommitKeys)
        .all(),
    ).toEqual([{ key, day: '2026-10-11' }]);
  });

  it('keeps one person’s key apart from another’s', () => {
    const key = 'a1b2c3d4e5f6a7b8';
    recordLocalActivity(t.db, actor(bea), report([day(TODAY, { pushed_keys: [key] })]), NOW);
    recordLocalActivity(t.db, actor(cal), report([day(TODAY, { pushed_keys: [key] })]), NOW);
    expect(t.db.select().from(pushedCommitKeys).all()).toHaveLength(2);
  });

  it('folds agent ids onto the board’s slugs, as `laika connect` reads them; unknown is other', () => {
    expect(agentKindOf('claude-code')).toBe('claude-code');
    expect(agentKindOf('gemini')).toBe('gemini-cli');
    expect(agentKindOf('copilot')).toBe('vscode');
    expect(agentKindOf('mystery-agent')).toBe('other');

    recordLocalActivity(
      t.db,
      actor(bea),
      report([day(TODAY, { prompts: { gemini: 2, 'mystery-agent': 3, unheard: 4, codex: 0 } })]),
      NOW,
    );
    const row = t.db.select().from(localActivityDays).get();
    expect(JSON.parse(row?.promptsByAgent ?? '')).toEqual({ 'gemini-cli': 2, other: 7 });
    expect(row?.prompts).toBe(9);
  });

  it('writes no activity row', () => {
    const before = activityRows();
    recordLocalActivity(
      t.db,
      actor(bea),
      report([day(TODAY, { sessions: 1, pushed_keys: ['a1b2c3d4e5f6a7b8'] })]),
      NOW,
    );
    expect(activityRows()).toBe(before);
  });
});

describe('day_out_of_range (§6.4)', () => {
  beforeEach(() => {
    switches(true, bea, true);
  });

  const refused = (sent: LocalActivityReport) =>
    refusal(() => recordLocalActivity(t.db, actor(bea), sent, NOW));

  it('accepts today − 14 and today + 1, the window’s two edges', () => {
    expect(
      recordLocalActivity(t.db, actor(bea), report([day('2026-09-30'), day('2026-10-15')]), NOW),
    ).toEqual({ accepted_days: 2 });
  });

  it('refuses a day just outside either edge', () => {
    for (const outside of ['2026-09-29', '2026-10-16']) {
      expect(refused(report([day(outside)])), outside).toMatchObject({
        code: 'unprocessable',
        details: {
          reason: 'day_out_of_range',
          day: outside,
          earliest: '2026-09-30',
          latest: '2026-10-15',
        },
      });
    }
  });

  it('judges the window in the sender’s zone, not the server’s', () => {
    // 22:30 UTC is already the 15th in Johannesburg, so the 16th is "today + 1"
    // there and accepted — and in UTC it would not be.
    const late = Date.UTC(2026, 9, 14, 22, 30);
    expect(
      recordLocalActivity(
        t.db,
        actor(bea),
        report([day('2026-10-16')], { tz: 'Africa/Johannesburg' }),
        late,
      ),
    ).toEqual({ accepted_days: 1 });
    expect(
      refusal(() => recordLocalActivity(t.db, actor(bea), report([day('2026-10-16')]), late)),
    ).toMatchObject({ details: { reason: 'day_out_of_range' } });
  });

  it('refuses no days, more than fourteen, a repeated day, and a date that does not exist', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) =>
      day(`2026-10-${String(i + 1).padStart(2, '0')}`),
    );
    for (const [name, sent] of [
      ['none', report([])],
      ['fifteen', report(fifteen)],
      ['repeated', report([day(TODAY), day(TODAY)])],
      ['not a date', report([day('2026-02-30')])],
    ] as const) {
      expect(refused(sent), name).toMatchObject({
        code: 'unprocessable',
        details: { reason: 'day_out_of_range' },
      });
    }
    expect(t.db.select().from(localActivityDays).all()).toEqual([]);
  });

  it('refuses a time zone the server does not know', () => {
    expect(refused(report([day(TODAY)], { tz: 'Mars/Olympus_Mons' }))).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'invalid_tz' },
    });
  });
});

describe('what the server holds, for the person it is about', () => {
  beforeEach(() => {
    switches(true, bea, true);
    switches(true, cal, true);
    recordLocalActivity(
      t.db,
      actor(bea),
      report([
        day(TODAY, {
          prompts: { 'claude-code': 4 },
          sessions: 1,
          pushed_keys: ['a1b2c3d4e5f6a7b8'],
        }),
        day('2026-10-02', { commits_local: 2 }),
      ]),
      NOW,
    );
    recordLocalActivity(
      t.db,
      actor(bea),
      report([day(TODAY, { prompts: { codex: 1 }, sessions: 2 })], { collector_id: COLLECTOR_B }),
      NOW,
    );
    // Someone else's, which must not appear.
    recordLocalActivity(t.db, actor(cal), report([day(TODAY, { sessions: 9 })]), NOW);
  });

  it('previews their own last days, every machine summed, newest first', () => {
    expect(getOwnLocalActivity(t.db, actor(bea), 14, NOW)).toEqual({
      start: '2026-10-01',
      end: TODAY,
      tz: 'UTC',
      days: [
        {
          day: TODAY,
          prompts_by_agent: { 'claude-code': 4, codex: 1 },
          sessions: 3,
          commits_local: 0,
          pushed_commits: 1,
        },
        {
          day: '2026-10-02',
          prompts_by_agent: {},
          sessions: 0,
          commits_local: 2,
          pushed_commits: 0,
        },
      ],
      collectors: 2,
      oldest_day: '2026-10-02',
    });
  });

  it('still shows what is held after sharing is turned off — it is theirs to see and delete', () => {
    setActivitySharing(t.db, actor(bea), { enabled: false });
    expect(getOwnLocalActivity(t.db, actor(bea), 14, NOW).days).toHaveLength(2);
  });

  it('refuses a token the preview and the delete', () => {
    expect(refusal(() => getOwnLocalActivity(t.db, withToken(bea), 14, NOW))).toEqual({
      code: 'forbidden',
      details: { action: 'local_activity.read_own', reason: 'session_required' },
    });
    expect(refusal(() => deleteOwnLocalActivity(t.db, withToken(bea)))).toEqual({
      code: 'forbidden',
      details: { action: 'local_activity.delete_own', reason: 'session_required' },
    });
    expect(t.db.select().from(localActivityDays).all()).toHaveLength(4);
  });

  it('deletes every local row and key of theirs, and nobody else’s', () => {
    const before = activityRows();
    deleteOwnLocalActivity(t.db, actor(bea));

    expect(t.db.select({ u: localActivityDays.userId }).from(localActivityDays).all()).toEqual([
      { u: cal },
    ]);
    expect(t.db.select().from(pushedCommitKeys).all()).toEqual([]);
    expect(getOwnLocalActivity(t.db, actor(bea), 14, NOW)).toMatchObject({
      days: [],
      collectors: 0,
      oldest_day: null,
    });
    expect(activityRows()).toBe(before);
  });
});
