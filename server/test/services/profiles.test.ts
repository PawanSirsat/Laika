import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../src/db/activity.ts';
import { type OrgRole, type ProfileKind } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { heartbeats, orgs, projects, tokens, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { SERVER_ROOT } from '../../src/paths.ts';
import { ALL_ACTIONS } from '../../src/policy/actions.ts';
import { can } from '../../src/policy/can.ts';
import {
  getProfile,
  PROFILE_LIST_LIMIT,
  PROFILE_WINDOW_WEEKS,
  rateMember,
  setProfileKind,
} from '../../src/services/profiles.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createProjectStatus } from '../../src/services/project-statuses.ts';
import { changeStatus, claimTask, createTask, updateTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The member profile (SPEC §6.4, §11.4.2, D-078, LAI-743).
 *
 * ## The clock is injected, never the calendar
 *
 * Every write below takes an explicit time and `getProfile` takes `NOW`, so the
 * twelve-week window is the same on any day this runs — the fixture states the
 * instant it reasons about rather than hoping today agrees (CONVENTIONS §4).
 *
 * ## One fixture, every figure exact
 *
 * The board history is built through the real services — claim, finish, send
 * back, accept, reopen — so each count is what those writes actually record,
 * and each expected number below is derived in a comment beside the write that
 * produces it. A count that only matched because the setup was empty would
 * fail the "someone else" and "outside the window" cases, which are seeded on
 * purpose.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Monday 12 October 2026, 00:00 UTC — the start of the current week. */
const M0 = Date.UTC(2026, 9, 12);
/** Wednesday of that week, noon. */
const NOW = Date.UTC(2026, 9, 14, 12);
/** The window: the current week and the eleven before it. */
const SINCE = M0 - 11 * WEEK;

let t: TestDb;
let ada: string; // owner — the one reading profiles
let bea: string; // the builder under test
let cal: string; // a lead who reviews, and the manager under test
let eve: string; // no history of her own, except LAI-8 where seedHistory runs

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(M0 - 30 * WEEK),
      updatedAt: new Date(M0 - 30 * WEEK),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function withToken(userId: string, projectIds: string[] | null = null): ResolvedActor {
  return { ...actor(userId), token: { id: 'tok_x', scope: 'full', projectIds } };
}

function task(slug: string, title: string, extra: Record<string, unknown> = {}): string {
  return createTask(t.sqlite, t.db, actor(ada), slug, { title, status: 'todo', ...extra }).id;
}

function move(by: string, id: string, to: Parameters<typeof changeStatus>[3], at: number): void {
  changeStatus(t.db, actor(by), id, to, at);
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
  return 'no error';
}

/**
 * The board history every metric test reads. Week indexes are 0 (oldest) to
 * 11 (this week); `M0 - n * WEEK` falls in week `11 - n`.
 */
function seedHistory(): void {
  // LAI-1: claimed, finished, accepted by Cal → accepted in week 1.
  // Cycle: claim → accept = 3 days.
  const lai1 = task('laika', 'One');
  claimTask(t.sqlite, t.db, actor(bea), lai1, M0 - 10 * WEEK);
  move(bea, lai1, 'review', M0 - 10 * WEEK + DAY);
  move(cal, lai1, 'done', M0 - 10 * WEEK + 3 * DAY);

  // LAI-2: sent back once by Cal, then accepted in week 8. Cycle 4 days.
  const lai2 = task('laika', 'Two');
  claimTask(t.sqlite, t.db, actor(bea), lai2, M0 - 3 * WEEK - DAY);
  move(bea, lai2, 'review', M0 - 3 * WEEK + DAY);
  move(cal, lai2, 'in_progress', M0 - 3 * WEEK + DAY + HOUR); // sent back
  move(bea, lai2, 'review', M0 - 3 * WEEK + 2 * DAY);
  move(cal, lai2, 'done', M0 - 3 * WEEK + 3 * DAY);

  // LAI-3: accepted in week 10, then reopened by Cal — in progress now, so it
  // counts as accepted and reopened, and is no cycle (it is mid-way).
  const lai3 = task('laika', 'Three');
  claimTask(t.sqlite, t.db, actor(bea), lai3, M0 - WEEK);
  move(bea, lai3, 'review', M0 - WEEK + HOUR);
  move(cal, lai3, 'done', M0 - WEEK + DAY);
  move(cal, lai3, 'in_progress', M0 - WEEK + 2 * DAY); // reopened

  // LAI-4: Bea closed her own task. Not accepted — nobody else accepted it —
  // but it is done in the window, so it is a 1-day cycle.
  const lai4 = task('laika', 'Four');
  claimTask(t.sqlite, t.db, actor(bea), lai4, M0 - 2 * WEEK);
  move(bea, lai4, 'done', M0 - 2 * WEEK + DAY);

  // LAI-5: never started — Cal moved it from To do to Done, in week 7.
  // Accepted, and the cycle's one unmeasured task.
  const lai5 = task('laika', 'Five', { assignee_id: bea });
  move(cal, lai5, 'done', M0 - 4 * WEEK + 2 * DAY);

  // LAI-6: entirely before the window. Counts for nothing.
  const lai6 = task('laika', 'Six');
  claimTask(t.sqlite, t.db, actor(bea), lai6, M0 - 14 * WEEK);
  move(bea, lai6, 'review', M0 - 14 * WEEK + DAY);
  move(cal, lai6, 'done', M0 - 13 * WEEK);

  // LAI-7: Bea took her own task back out of review. Not a send-back — she
  // did it — and it is in progress now.
  const lai7 = task('laika', 'Seven');
  claimTask(t.sqlite, t.db, actor(bea), lai7, M0 - 5 * WEEK);
  move(bea, lai7, 'review', M0 - 5 * WEEK + DAY);
  move(bea, lai7, 'in_progress', M0 - 5 * WEEK + 2 * DAY);

  // ORB-1: in review now.
  const orb1 = task('orbit', 'Orbit one');
  claimTask(t.sqlite, t.db, actor(bea), orb1, M0 + HOUR);
  move(bea, orb1, 'review', NOW - HOUR);

  // ORB-2: Cal's own task, which Bea sent back to To do — review work Bea
  // did for somebody else.
  const orb2 = task('orbit', 'Orbit two');
  claimTask(t.sqlite, t.db, actor(cal), orb2, M0 - 2 * DAY);
  move(cal, orb2, 'review', M0 - DAY - HOUR);
  move(bea, orb2, 'todo', M0 - DAY);

  // LAI-8: Bea claimed it, released it, and Eve claimed it and had it
  // accepted. Not Bea's any more, so none of it — the claim row Bea wrote
  // included — is in her figures; it is in Eve's.
  const lai8 = task('laika', 'Eight');
  claimTask(t.sqlite, t.db, actor(bea), lai8, M0 - 6 * WEEK);
  updateTask(t.db, actor(bea), lai8, { assignee_id: null, now: M0 - 6 * WEEK + HOUR });
  claimTask(t.sqlite, t.db, actor(eve), lai8, M0 - 6 * WEEK + 2 * HOUR);
  move(eve, lai8, 'review', M0 - 6 * WEEK + DAY);
  move(cal, lai8, 'done', M0 - 6 * WEEK + 2 * DAY);
}

function seedAgents(): void {
  const token = (values: Partial<typeof tokens.$inferInsert> & { name: string }) => {
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId: bea,
        prefix: 'lai_xxxx',
        tokenHash: newId(),
        scope: 'full',
        createdAt: M0 - 20 * WEEK,
        ...values,
      })
      .run();
    return id;
  };

  token({
    name: 'Claude Code',
    lastClient: 'claude-code',
    lastClientName: 'claude-code',
    lastMcpAt: NOW - 2 * MIN,
    lastUsedAt: NOW - 2 * MIN,
  });
  const codex = token({
    name: 'Codex',
    lastClient: 'codex',
    lastClientName: 'codex_cli_rs',
    lastMcpAt: NOW - 3 * DAY,
    lastUsedAt: NOW - 3 * DAY,
  });
  token({ name: 'Cursor', lastClient: 'cursor', revokedAt: M0 - WEEK });
  token({ name: 'Gemini', lastClient: 'gemini-cli', expiresAt: NOW - DAY });

  // A heartbeat on the Codex token a minute ago: Codex is online by
  // heartbeat, Claude Code by its `/mcp` call.
  t.db
    .insert(heartbeats)
    .values({
      id: newId(),
      userId: bea,
      tokenId: codex,
      repo: 'kvell/laika',
      branch: 'lai-7-seven',
      matchedTaskId: null,
      createdAt: NOW - MIN,
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  ada = makeUser('Ada', 'owner');
  bea = makeUser('Bea', 'member');
  cal = makeUser('Cal', 'member');
  eve = makeUser('Eve', 'member');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ada, createdAt: NOW, updatedAt: NOW })
    .run();

  createProject(t.sqlite, t.db, actor(ada), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
  createProject(t.sqlite, t.db, actor(ada), { name: 'Orbit', slug: 'orbit', prefix: 'ORB' });
  addMember(t.db, actor(ada), 'laika', bea, 'member');
  addMember(t.db, actor(ada), 'orbit', bea, 'member');
  addMember(t.db, actor(ada), 'laika', cal, 'lead');
  addMember(t.db, actor(ada), 'orbit', cal, 'member');
  addMember(t.db, actor(ada), 'laika', eve, 'member');
  // Eve's project membership is removed below for the empty-profile case.
});
afterEach(() => {
  t.close();
});

// ------------------------------------------------------------------- access

describe('who may read and write a profile (§3.1, LAI-743)', () => {
  it('answers an owner or an admin on a session', () => {
    const admin = makeUser('Ari', 'admin');

    expect(getProfile(t.db, actor(ada), bea, NOW).user.id).toBe(bea);
    expect(getProfile(t.db, actor(admin), bea, NOW).user.id).toBe(bea);
  });

  it('refuses a member and a viewer forbidden, for every one of the three', () => {
    const viewer = makeUser('Vic', 'viewer');

    for (const who of [cal, viewer]) {
      expect(code(() => getProfile(t.db, actor(who), bea, NOW))).toBe('forbidden');
      expect(code(() => setProfileKind(t.db, actor(who), bea, 'manager', NOW))).toBe('forbidden');
      expect(code(() => rateMember(t.db, actor(who), bea, { score: 3, note: 'Fine.' }, NOW))).toBe(
        'forbidden',
      );
    }
  });

  it('refuses an owner holding a token, scoped or not', () => {
    for (const projectIds of [null, ['prj_any']]) {
      const owner = withToken(ada, projectIds);
      expect(code(() => getProfile(t.db, owner, bea, NOW))).toBe('forbidden');
      expect(code(() => setProfileKind(t.db, owner, bea, 'manager', NOW))).toBe('forbidden');
      expect(code(() => rateMember(t.db, owner, bea, { score: 3, note: 'Fine.' }, NOW))).toBe(
        'forbidden',
      );
    }
  });

  it('tells a non-admin nothing about whether an id exists', () => {
    // The refusal comes before the lookup: forbidden for a real id and a
    // made-up one alike. Only an admin learns that an id names nobody.
    expect(code(() => getProfile(t.db, actor(cal), 'usr_nobody', NOW))).toBe('forbidden');
    expect(code(() => getProfile(t.db, actor(cal), bea, NOW))).toBe('forbidden');
    expect(code(() => getProfile(t.db, actor(ada), 'usr_nobody', NOW))).toBe('not_found');
    expect(code(() => setProfileKind(t.db, actor(ada), 'usr_nobody', 'manager', NOW))).toBe(
      'not_found',
    );
    expect(
      code(() => rateMember(t.db, actor(ada), 'usr_nobody', { score: 3, note: 'Who?' }, NOW)),
    ).toBe('not_found');
  });
});

// ------------------------------------------------------------- the builder

describe('a builder’s profile, on the seeded history (LAI-743)', () => {
  beforeEach(() => {
    seedHistory();
    seedAgents();
  });

  it('says who they are, and the window it counts in', () => {
    const profile = getProfile(t.db, actor(ada), bea, NOW);

    expect(profile.user).toEqual({
      id: bea,
      name: 'Bea',
      email: 'bea@example.test',
      org_role: 'member',
      is_active: true,
      profile_kind: 'builder',
      created_at: M0 - 30 * WEEK,
    });
    expect(profile.window).toEqual({ weeks: 12, since: SINCE, until: NOW });
    expect(PROFILE_WINDOW_WEEKS).toBe(profile.window.weeks);
  });

  it('lists the projects they work in, with role, open work, accepted and reviewed', () => {
    const { projects } = getProfile(t.db, actor(ada), bea, NOW);

    expect(projects).toEqual([
      // LAI-3 and LAI-7 open; LAI-1, 2, 3, 5 accepted; no review decisions.
      expect.objectContaining({
        slug: 'laika',
        name: 'Laika',
        key: 'LAI',
        role: 'member',
        archived: false,
        open_tasks: 2,
        accepted: 4,
        reviewed: 0,
      }),
      // ORB-1 open; Bea sent ORB-2 back.
      expect.objectContaining({
        slug: 'orbit',
        role: 'member',
        open_tasks: 1,
        accepted: 0,
        reviewed: 1,
      }),
    ]);
  });

  it('shows current work: in progress oldest first, and in review', () => {
    const work = getProfile(t.db, actor(ada), bea, NOW).current_work;

    expect(work?.in_progress.map((x) => x.key)).toEqual(['LAI-7', 'LAI-3']);
    expect(work?.in_progress[0]).toMatchObject({
      title: 'Seven',
      project_slug: 'laika',
      status: 'in_progress',
      started_at: M0 - 5 * WEEK,
    });
    expect(work?.in_review.map((x) => x.key)).toEqual(['ORB-1']);
  });

  it('counts accepted per week — only what someone else moved to Done', () => {
    const delivery = getProfile(t.db, actor(ada), bea, NOW).delivery;

    expect(delivery?.accepted_per_week.map((w) => w.week_start)).toEqual(
      Array.from({ length: 12 }, (_, i) => SINCE + i * WEEK),
    );
    // LAI-1 week 1, LAI-5 week 7, LAI-2 week 8, LAI-3 week 10. LAI-4 (her own
    // close, week 9) and LAI-6 (before the window) are not here.
    expect(delivery?.accepted_per_week.map((w) => w.accepted)).toEqual([
      0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0,
    ]);
    expect(delivery?.accepted).toBe(4);
  });

  it('counts sent back (by someone else) and reopened', () => {
    const delivery = getProfile(t.db, actor(ada), bea, NOW).delivery;

    // LAI-2's one send-back by Cal. LAI-7, which Bea took back herself, is not.
    expect(delivery?.sent_back).toBe(1);
    // LAI-3, Done → In progress.
    expect(delivery?.reopened).toBe(1);
  });

  it('measures cycle time p50 and p75, and counts what it could not measure', () => {
    const cycle = getProfile(t.db, actor(ada), bea, NOW).delivery?.cycle_time;

    // Done now, completed in the window: LAI-4 1 day, LAI-1 3 days, LAI-2 4
    // days, and LAI-5 with no start. Nearest rank over [1, 3, 4] days.
    expect(cycle).toEqual({ measured: 3, unmeasured: 1, p50_ms: 3 * DAY, p75_ms: 4 * DAY });
  });

  it('counts the review work they did for others', () => {
    const review = getProfile(t.db, actor(ada), bea, NOW).review;

    expect(review.accepted).toBe(0);
    expect(review.sent_back).toBe(1);
    expect(review.recent).toEqual([
      expect.objectContaining({
        key: 'ORB-2',
        decision: 'sent_back',
        at: M0 - DAY,
        assignee: { id: cal, name: 'Cal' },
      }),
    ]);
  });

  it('lists the agents in use and which are online now', () => {
    const agents = getProfile(t.db, actor(ada), bea, NOW).agents;

    // Revoked Cursor and expired Gemini are not in use. Most recent first.
    expect(agents?.tokens.map((x) => [x.name, x.client, x.client_name])).toEqual([
      ['Claude Code', 'claude-code', 'claude-code'],
      ['Codex', 'codex', 'codex_cli_rs'],
    ]);
    expect(agents?.tokens[0]).toMatchObject({
      last_mcp_at: NOW - 2 * MIN,
      last_used_at: NOW - 2 * MIN,
    });
    // Codex by its heartbeat a minute ago, Claude Code by `/mcp` two minutes
    // ago — newest first. Where they are working is not part of a profile.
    expect(agents?.online).toEqual({
      enabled: true,
      clients: ['codex', 'claude-code'],
      last_seen: NOW - MIN,
    });
    expect(JSON.stringify(agents)).not.toContain('kvell/laika');
  });

  it('says presence is off, rather than nobody online, when the org turned it off', () => {
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();

    const agents = getProfile(t.db, actor(ada), bea, NOW).agents;

    expect(agents?.online).toEqual({ enabled: false, clients: [], last_seen: null });
    // Token metadata is not presence (D-076 item 5): the agents are still listed.
    expect(agents?.tokens).toHaveLength(2);
  });
});

// ------------------------------------------------------------- the manager

describe('a manager’s profile (LAI-743)', () => {
  beforeEach(() => {
    seedHistory();
    setProfileKind(t.db, actor(ada), cal, 'manager', NOW);
  });

  it('carries projects, review work and recent decisions — and no agent, work or delivery block', () => {
    const profile = getProfile(t.db, actor(ada), cal, NOW);

    expect(profile.user.profile_kind).toBe('manager');
    expect(Object.keys(profile).sort()).toEqual([
      'projects',
      'queue',
      'ratings',
      'ratings_total',
      'review',
      'user',
      'window',
    ]);
    expect('agents' in profile).toBe(false);
    expect('current_work' in profile).toBe(false);
    expect('delivery' in profile).toBe(false);
  });

  it('counts the decisions they made on other people’s work, newest first', () => {
    const { review, projects } = getProfile(t.db, actor(ada), cal, NOW);

    // Accepted Bea's LAI-1, LAI-5, LAI-2, LAI-3 and Eve's LAI-8; sent LAI-2
    // back once. LAI-6 is before the window, and reopening LAI-3 is not a
    // review decision.
    expect(review.accepted).toBe(5);
    expect(review.sent_back).toBe(1);
    expect(review.recent.map((d) => [d.key, d.decision])).toEqual([
      ['LAI-3', 'accepted'],
      ['LAI-2', 'accepted'],
      ['LAI-2', 'sent_back'],
      ['LAI-5', 'accepted'],
      ['LAI-8', 'accepted'],
      ['LAI-1', 'accepted'],
    ]);
    expect(review.recent.find((d) => d.key === 'LAI-8')?.assignee).toEqual({
      id: eve,
      name: 'Eve',
    });
    expect(review.recent[0]).toMatchObject({
      title: 'Three',
      project_slug: 'laika',
      at: M0 - WEEK + DAY,
      assignee: { id: bea, name: 'Bea' },
    });

    expect(projects).toEqual([
      expect.objectContaining({ slug: 'laika', role: 'lead', open_tasks: 0, reviewed: 6 }),
      // ORB-2 is Cal's and back in To do.
      expect.objectContaining({ slug: 'orbit', role: 'member', open_tasks: 1, reviewed: 0 }),
    ]);
  });

  it('switches back to a builder, and the builder blocks return', () => {
    setProfileKind(t.db, actor(ada), cal, 'builder', NOW);

    const profile = getProfile(t.db, actor(ada), cal, NOW);
    expect(profile.user.profile_kind).toBe('builder');
    expect(profile.agents).toBeDefined();
    expect(profile.delivery?.sent_back).toBe(1); // ORB-2, by Bea
  });
});

// ---------------------------------------------------------------- nobody yet

describe('a person with no history (LAI-743)', () => {
  it('answers zeros and empty lists, never a missing figure', () => {
    t.db.run(sql`DELETE FROM project_memberships WHERE user_id = ${eve}`);

    const profile = getProfile(t.db, actor(ada), eve, NOW);

    expect(profile.projects).toEqual([]);
    expect(profile.current_work).toEqual({
      in_progress: [],
      in_progress_total: 0,
      in_review: [],
      in_review_total: 0,
    });
    expect(profile.delivery).toEqual({
      accepted_per_week: Array.from({ length: 12 }, (_, i) => ({
        week_start: SINCE + i * WEEK,
        accepted: 0,
      })),
      accepted: 0,
      sent_back: 0,
      reopened: 0,
      cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
    });
    expect(profile.review).toEqual({
      accepted: 0,
      sent_back: 0,
      last_30_days: 0,
      per_week: Array.from({ length: 12 }, (_, i) => ({
        week_start: SINCE + i * WEEK,
        accepted: 0,
        sent_back: 0,
      })),
      time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
      recent: [],
    });
    expect(profile.agents).toEqual({
      tokens: [],
      tokens_total: 0,
      online: { enabled: true, clients: [], last_seen: null },
      writes: [],
      writes_total: 0,
    });
    expect(profile.ratings).toEqual([]);
    expect(profile.ratings_total).toBe(0);
  });
});

// --------------------------------------------------------------- the rating

describe('rating a member (LAI-743)', () => {
  it('appends, newest first, with who and when', () => {
    const admin = makeUser('Ari', 'admin');
    rateMember(t.db, actor(ada), bea, { score: 4, note: '  Steady delivery.  ' }, NOW - 2 * DAY);
    const { rating: second, replayed } = rateMember(
      t.db,
      actor(admin),
      bea,
      { score: 5, note: 'Clears review fast.' },
      NOW - DAY,
    );

    expect(replayed).toBe(false);
    expect(second.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(second).toEqual({
      id: second.id,
      score: 5,
      note: 'Clears review fast.',
      rated_by: { id: admin, name: 'Ari' },
      created_at: NOW - DAY,
    });

    const { ratings } = getProfile(t.db, actor(ada), bea, NOW);
    expect(ratings.map((r) => [r.score, r.note, r.rated_by.name])).toEqual([
      [5, 'Clears review fast.', 'Ari'],
      // Trimmed on the way in.
      [4, 'Steady delivery.', 'Ada'],
    ]);
  });

  it('refuses rating yourself', () => {
    expect(code(() => rateMember(t.db, actor(ada), ada, { score: 5, note: 'Me.' }, NOW))).toBe(
      'forbidden',
    );
  });

  it('refuses a score outside 1–5 and a missing or long note, unprocessable', () => {
    const bad: { score: number; note: string }[] = [
      { score: 0, note: 'Low.' },
      { score: 6, note: 'High.' },
      { score: 2.5, note: 'Half.' },
      { score: 3, note: '' },
      { score: 3, note: '    ' },
      { score: 3, note: 'x'.repeat(501) },
    ];
    for (const input of bad) {
      expect(
        code(() => rateMember(t.db, actor(ada), bea, input, NOW)),
        JSON.stringify(input),
      ).toBe('unprocessable');
    }
    expect(getProfile(t.db, actor(ada), bea, NOW).ratings).toEqual([]);
  });
});

// ------------------------------------------------------- ratings are private

describe('a rating goes nowhere but the profile (D-078, LAI-743)', () => {
  it('writes no activity row, so no feed, stream or export can carry it', () => {
    const count = () => t.db.all(sql`SELECT id FROM activity`).length;
    const before = count();

    rateMember(t.db, actor(ada), bea, { score: 2, note: 'A private remark.' }, NOW);

    expect(count()).toBe(before);
    expect(
      t.db.all(sql`SELECT id FROM activity WHERE payload_json LIKE '%private remark%'`),
    ).toEqual([]);
  });

  it('is read by one module only, and no MCP tool or route reaches past it', async () => {
    // Structural, because "no endpoint leaks it" cannot be proven by asking
    // each endpoint: whatever touches the table is the leak surface. Only the
    // profile service may name it, and only the profile routes may call it.
    const { naming, importing } = ratingsBoundary(await readSources());

    expect(naming).toEqual(['db/migrate.ts', 'db/schema.ts', 'services/profiles.ts']);
    expect(importing).toEqual(['http/routes/profiles.ts']);
  });

  it('reads every source file once for both questions (LAI-749)', async () => {
    // The check above used to walk the tree and read it twice, synchronously:
    // 112 ms alone, 6.2 s in a loaded full run, past vitest's 5 s (D-055: a
    // flake is a defect). Every file is now read once, concurrently, and both
    // questions are asked of that one copy.
    const reads = new Map<string, number>();
    const sources = await readSources(async (path) => {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      return readFile(path, 'utf8');
    });

    // Not vacuous: a scan that found nothing would read nothing twice.
    expect(sources.size).toBeGreaterThan(50);
    expect([...sources.keys()]).toContain('services/profiles.ts');
    expect([...reads.values()].filter((n) => n !== 1)).toEqual([]);
    expect(reads.size).toBe(sources.size);
  });

  it('leaves the activity rows for setting a kind empty too — it is a label, not an event', () => {
    const before = t.db.all(sql`SELECT id FROM activity`).length;
    setProfileKind(t.db, actor(ada), bea, 'manager', NOW);
    expect(t.db.all(sql`SELECT id FROM activity`).length).toBe(before);
    expect(t.db.select().from(users).where(eq(users.id, bea)).get()?.profileKind).toBe('manager');
  });
});

const SOURCE_ROOT = join(SERVER_ROOT, 'src');

/**
 * Every `.ts` file under `server/src`, by path relative to it, each read once
 * and all concurrently (LAI-749). `read` is injectable so a test can count.
 */
async function readSources(
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<Map<string, string>> {
  const files = (await readdir(SOURCE_ROOT, { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
  const texts = await Promise.all(files.map((file) => read(file)));
  return new Map(files.map((file, i) => [relative(SOURCE_ROOT, file), texts[i] ?? '']));
}

/**
 * Who names `member_ratings`, and who imports the profile service — asked of
 * sources already read, so this can read nothing itself.
 */
function ratingsBoundary(sources: ReadonlyMap<string, string>): {
  naming: string[];
  importing: string[];
} {
  const service = join(SOURCE_ROOT, 'services', 'profiles.ts');
  const naming: string[] = [];
  const importing: string[] = [];

  for (const [file, text] of sources) {
    if (/\bmemberRatings\b|\bmember_ratings\b/.test(text)) naming.push(file);

    // Resolved import specifiers, not a text match: a comment naming the
    // module is not a caller.
    const absolute = join(SOURCE_ROOT, file);
    const imports = [...text.matchAll(/^import[^;]*?from '([^']+)';/gms)].some(
      ([, specifier]) =>
        specifier !== undefined &&
        specifier.startsWith('.') &&
        resolve(dirname(absolute), specifier) === service,
    );
    if (imports) importing.push(file);
  }

  return { naming: naming.sort(), importing: importing.sort() };
}

// --------------------------------------------- the kind is not a permission

describe('profile_kind changes no permission (D-078, LAI-743)', () => {
  it('gives every action the same answer for a builder and a manager, in every role', () => {
    const resources = [
      {},
      { projectId: 'prj_a' },
      { ownerId: 'self' },
      { targetUserId: 'someone' },
      { visibility: 'public' as const },
      { targetOrgRole: 'member' as const },
    ];
    const kinds: ProfileKind[] = ['builder', 'manager'];

    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const person = makeUser(`P${role}`, role);
      addMember(t.db, actor(ada), 'laika', person, role === 'viewer' ? 'viewer' : 'member');

      const answers = kinds.map((kind) => {
        t.db.update(users).set({ profileKind: kind }).where(eq(users.id, person)).run();
        // Loaded fresh from the row, as every request loads its actor.
        const loaded = actor(person);
        return ALL_ACTIONS.flatMap((action) =>
          resources.map((resource) => can(loaded, action, resource)),
        );
      });

      expect(answers[1], role).toEqual(answers[0]);
    }
  });

  it('lets a manager still do a member’s work — claim and accept', () => {
    setProfileKind(t.db, actor(ada), bea, 'manager', NOW);
    const id = task('laika', 'Still mine to do');

    const claimed = claimTask(t.sqlite, t.db, actor(bea), id, NOW);
    expect(claimed.assignee_id).toBe(bea);
    move(bea, id, 'review', NOW + MIN);
    move(cal, id, 'done', NOW + 2 * MIN);
  });
});

// ------------------------------------------- what the review's mutations hit

/**
 * Four rules LAI-743's tests did not pin, found by the review mutating them
 * and watching nothing go red (LAI-746). Each fixture here is built so the
 * mutated code gives a different answer: a test whose fixture cannot tell the
 * rule from its mutation does not test the rule.
 */
describe('rules the first fixture could not tell apart (LAI-746)', () => {
  it('does not count a move between two Done statuses as another acceptance (M2)', () => {
    createProjectStatus(t.sqlite, t.db, actor(ada), 'laika', { name: 'Shipped', category: 'done' });
    const id = task('laika', 'Shipped later');
    claimTask(t.sqlite, t.db, actor(bea), id, M0 - 2 * WEEK);
    move(bea, id, 'review', M0 - 2 * WEEK + HOUR);
    move(cal, id, 'done', M0 - 2 * WEEK + DAY);
    // Done → Shipped: both Done, so `from` and `to` are equal (D-077) — a
    // column change, not a second acceptance.
    changeStatus(t.db, actor(cal), id, { status_name: 'Shipped' }, M0 - WEEK);

    const delivery = getProfile(t.db, actor(ada), bea, NOW).delivery;
    expect(delivery?.accepted).toBe(1);
    expect(delivery?.accepted_per_week.map((w) => w.accepted)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
    ]);
    expect(getProfile(t.db, actor(ada), cal, NOW).review.accepted).toBe(1);
  });

  it('shows only this person’s agents as online, never a colleague’s (M8)', () => {
    const mine = newId();
    const theirs = newId();
    const theirBeat = newId();
    const base = { prefix: 'lai_xxxx', scope: 'full' as const, createdAt: M0 - WEEK };
    t.db
      .insert(tokens)
      .values([
        { ...base, id: mine, userId: bea, name: 'Claude Code', tokenHash: newId() },
        {
          ...base,
          id: theirs,
          userId: cal,
          name: 'Cursor',
          tokenHash: newId(),
          lastClient: 'cursor',
          lastMcpAt: NOW - MIN,
        },
        {
          ...base,
          id: theirBeat,
          userId: cal,
          name: 'Codex',
          tokenHash: newId(),
          lastClient: 'codex',
        },
      ])
      .run();
    t.db
      .insert(heartbeats)
      .values({
        id: newId(),
        userId: cal,
        tokenId: theirBeat,
        repo: 'kvell/laika',
        branch: 'main',
        matchedTaskId: null,
        createdAt: NOW - 2 * MIN,
      })
      .run();

    // Cal has a live `/mcp` call and a live heartbeat; Bea has neither.
    expect(getProfile(t.db, actor(ada), bea, NOW).agents?.online).toEqual({
      enabled: true,
      clients: [],
      last_seen: null,
    });
    // And Cal's own profile does see both — so the empty answer above is the
    // filter, not a fixture nobody is online in.
    setProfileKind(t.db, actor(ada), cal, 'builder', NOW);
    expect(getProfile(t.db, actor(ada), cal, NOW).agents?.online.clients).toEqual([
      'cursor',
      'codex',
    ]);
  });

  it('buckets an acceptance into the week it happened in, late in the week too (M18)', () => {
    // Saturday 23:00 and Sunday 23:59:59.999 belong to their own week; Monday
    // 00:00 starts the next. Rounding instead of flooring moves the first two.
    const accept = (title: string, at: number) => {
      const id = task('laika', title);
      claimTask(t.sqlite, t.db, actor(bea), id, at - 2 * DAY);
      move(bea, id, 'review', at - DAY);
      move(cal, id, 'done', at);
    };
    accept('Saturday night', M0 - 2 * WEEK + 5 * DAY + 23 * HOUR); // week 9
    accept('Last millisecond of Sunday', M0 - WEEK - 1); // week 9
    accept('First millisecond of Monday', M0 - WEEK); // week 10

    expect(
      getProfile(t.db, actor(ada), bea, NOW).delivery?.accepted_per_week.map((w) => w.accepted),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0]);
  });

  it('lists a project reached only through review decisions (M19)', () => {
    // Ada is the owner: implicit lead everywhere, no membership row in
    // `side`, no task there. Her only tie to it is accepting Bea's work.
    createProject(t.sqlite, t.db, actor(ada), { name: 'Side', slug: 'side', prefix: 'SID' });
    t.db.run(sql`DELETE FROM project_memberships WHERE user_id = ${ada}`);
    addMember(t.db, actor(ada), 'side', bea, 'member');
    const id = task('side', 'Side work');
    claimTask(t.sqlite, t.db, actor(bea), id, M0 - DAY);
    move(bea, id, 'review', M0 - DAY + HOUR);
    move(ada, id, 'done', M0 - DAY + 2 * HOUR);

    const admin = makeUser('Ari', 'admin');
    const { projects } = getProfile(t.db, actor(admin), ada, NOW);
    expect(projects).toEqual([
      expect.objectContaining({ slug: 'side', role: null, open_tasks: 0, reviewed: 1 }),
    ]);
  });
});

// ------------------------------------------------------------- long lists

/**
 * The three lists that grow with a person's history are capped, and say how
 * long they are (LAI-746). Fifty-one of each: one past the cap, so the cap and
 * the total both have something to prove.
 */
describe('long lists are capped and counted (LAI-746)', () => {
  const OVER = 51;

  it('keeps the newest ratings, the oldest open work and the latest agents', () => {
    expect(PROFILE_LIST_LIMIT).toBe(50);
    const admin = makeUser('Ari', 'admin');

    for (let i = 0; i < OVER; i += 1) {
      rateMember(
        t.db,
        actor(i % 2 === 0 ? ada : admin),
        bea,
        { score: 3, note: `Note ${String(i)}` },
        NOW - (OVER - i) * MIN,
      );

      const id = task('laika', `Open ${String(i)}`);
      claimTask(t.sqlite, t.db, actor(bea), id, M0 - (OVER - i) * HOUR);

      t.db
        .insert(tokens)
        .values({
          id: newId(),
          userId: bea,
          name: `Token ${String(i)}`,
          prefix: 'lai_xxxx',
          tokenHash: newId(),
          scope: 'full',
          lastUsedAt: NOW - (OVER - i) * MIN,
          createdAt: M0 - WEEK,
        })
        .run();
    }

    const profile = getProfile(t.db, actor(ada), bea, NOW);

    expect(profile.ratings).toHaveLength(50);
    expect(profile.ratings_total).toBe(OVER);
    // Newest first: the last one written leads, the very first is the one cut.
    expect(profile.ratings[0]?.note).toBe('Note 50');
    expect(profile.ratings.map((r) => r.note)).not.toContain('Note 0');

    expect(profile.current_work?.in_progress).toHaveLength(50);
    expect(profile.current_work?.in_progress_total).toBe(OVER);
    // Oldest start first: the newest claim is the one past the cap.
    expect(profile.current_work?.in_progress[0]?.title).toBe('Open 0');
    expect(profile.current_work?.in_progress.map((x) => x.title)).not.toContain('Open 50');
    expect(profile.current_work?.in_review).toEqual([]);
    expect(profile.current_work?.in_review_total).toBe(0);

    expect(profile.agents?.tokens).toHaveLength(50);
    expect(profile.agents?.tokens_total).toBe(OVER);
    expect(profile.agents?.tokens[0]?.name).toBe('Token 50');
    expect(profile.agents?.tokens.map((x) => x.name)).not.toContain('Token 0');
  });

  it('says the total is the length when nothing was cut', () => {
    rateMember(t.db, actor(ada), bea, { score: 4, note: 'Only one.' }, NOW);
    const profile = getProfile(t.db, actor(ada), bea, NOW);
    expect(profile.ratings_total).toBe(1);
    expect(profile.agents?.tokens_total).toBe(0);
    expect(profile.current_work?.in_progress_total).toBe(0);
  });
});

// ------------------------------------------------- v2 figures (LAI-750)

describe('review load, recent decisions and time to decide (LAI-750)', () => {
  beforeEach(() => {
    seedHistory();
  });

  it('counts a reviewer’s decisions per week, in the last 30 days, and how long they took', () => {
    const { review } = getProfile(t.db, actor(ada), cal, NOW);

    // LAI-1 week 1, LAI-8 week 5, LAI-5 week 7, LAI-2 (sent back, then
    // accepted) week 8, LAI-3 week 10. LAI-6 is before the window.
    expect(review.per_week.map((w) => w.week_start)).toEqual(
      Array.from({ length: 12 }, (_, i) => SINCE + i * WEEK),
    );
    expect(review.per_week.map((w) => w.accepted)).toEqual([0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0]);
    expect(review.per_week.map((w) => w.sent_back)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);

    // Thirty days before NOW is M0 − 27.5 days: LAI-3, both LAI-2 decisions and
    // LAI-5 (M0 − 26 d) are inside it; LAI-8 (M0 − 40 d) and LAI-1 are not.
    expect(review.last_30_days).toBe(4);

    // From the latest entry into Review to the decision: LAI-2's send-back
    // 1 h, LAI-3 23 h, LAI-2's acceptance 1 d, LAI-8 1 d, LAI-1 2 d. LAI-5 was
    // accepted straight from To do — nothing to measure, so counted, not 0.
    // Nearest rank over five: the third, 1 d.
    expect(review.time_to_decide).toEqual({ measured: 5, unmeasured: 1, p50_ms: DAY });
  });

  it('times a builder’s review work for others too', () => {
    const { review } = getProfile(t.db, actor(ada), bea, NOW);

    // ORB-2: Cal put it in Review at M0 − 1 d − 1 h; Bea sent it back at M0 − 1 d.
    expect(review.per_week.map((w) => w.sent_back)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
    expect(review.last_30_days).toBe(1);
    expect(review.time_to_decide).toEqual({ measured: 1, unmeasured: 0, p50_ms: HOUR });
  });

  it('does not time a decision on a task whose entry into Review was never logged', () => {
    // Created straight into Review: no move into it is in the log.
    const lai9 = task('laika', 'Nine', { status: 'review', assignee_id: bea });
    move(cal, lai9, 'done', NOW - HOUR);

    const { review } = getProfile(t.db, actor(ada), cal, NOW);
    expect(review.time_to_decide).toEqual({ measured: 5, unmeasured: 2, p50_ms: DAY });
    expect(review.last_30_days).toBe(5);
  });

  it('measures from the latest entry into Review, and only a decision made out of Review', () => {
    // Ada has no decisions in the seeded history; these are her only ones.
    // LAI-9: sent back after 1 d in Review, back in Review, accepted 1 h later.
    // The acceptance's wait is from the second entry (1 h), not the first (8 d).
    const lai9 = task('laika', 'Nine');
    claimTask(t.sqlite, t.db, actor(bea), lai9, NOW - 11 * DAY);
    move(bea, lai9, 'review', NOW - 10 * DAY);
    move(ada, lai9, 'in_progress', NOW - 9 * DAY);
    move(bea, lai9, 'review', NOW - 2 * DAY);
    move(ada, lai9, 'done', NOW - 2 * DAY + HOUR);
    // LAI-10: in Review once, taken back by Bea, then accepted from In
    // progress — no wait in Review to measure, though it was there before.
    const lai10 = task('laika', 'Ten');
    claimTask(t.sqlite, t.db, actor(bea), lai10, NOW - 7 * DAY);
    move(bea, lai10, 'review', NOW - 6 * DAY);
    move(bea, lai10, 'in_progress', NOW - 5 * DAY);
    move(ada, lai10, 'done', NOW - 4 * DAY);

    // Waits [1 h, 1 d]; nearest rank of two at p50 is the first.
    expect(getProfile(t.db, actor(ada), ada, NOW).review.time_to_decide).toEqual({
      measured: 2,
      unmeasured: 1,
      p50_ms: HOUR,
    });
  });
});

describe('a manager’s queue (LAI-750)', () => {
  let laika: string;

  beforeEach(() => {
    seedHistory();
    laika = t.db
      .select()
      .from(projects)
      .all()
      .find((p) => p.slug === 'laika')!.id;
  });

  function seedQueue(): void {
    // LAI-9: Bea's, in Review since NOW − 2 d — the oldest waiting.
    const lai9 = task('laika', 'Nine');
    claimTask(t.sqlite, t.db, actor(bea), lai9, NOW - 3 * DAY);
    move(bea, lai9, 'review', NOW - 2 * DAY);
    // LAI-10: Eve's, since NOW − 5 h.
    const lai10 = task('laika', 'Ten');
    claimTask(t.sqlite, t.db, actor(eve), lai10, NOW - DAY);
    move(eve, lai10, 'review', NOW - 5 * HOUR);
    // LAI-11: Cal's own — not waiting for anyone's decision but his.
    const lai11 = task('laika', 'Eleven');
    claimTask(t.sqlite, t.db, actor(cal), lai11, NOW - 4 * DAY);
    move(cal, lai11, 'review', NOW - 3 * DAY);
    // LAI-12: nobody's, created straight into Review — waiting, with no entry.
    task('laika', 'Twelve', { status: 'review' });
    // ORB-1 (Bea's, in Review since NOW − 1 h) is in Orbit, which Cal does not lead.

    // An archived project he led, with work in Review: neither led nor waiting.
    createProject(t.sqlite, t.db, actor(ada), { name: 'Old', slug: 'old', prefix: 'OLD' });
    addMember(t.db, actor(ada), 'old', cal, 'lead');
    addMember(t.db, actor(ada), 'old', bea, 'member');
    const old1 = task('old', 'Old one');
    claimTask(t.sqlite, t.db, actor(bea), old1, NOW - 9 * DAY);
    move(bea, old1, 'review', NOW - 8 * DAY);
    t.db
      .update(projects)
      .set({ archivedAt: NOW - DAY })
      .where(eq(projects.slug, 'old'))
      .run();
  }

  it('counts what waits in the projects they lead, and when the oldest entered Review', () => {
    seedQueue();
    setProfileKind(t.db, actor(ada), cal, 'manager', NOW);

    expect(getProfile(t.db, actor(ada), cal, NOW).queue).toEqual({
      projects_led: 1,
      // LAI-9, LAI-10 and LAI-12. Not LAI-11 (his), ORB-1 (not led), OLD-1 (archived).
      waiting: 3,
      oldest_waiting_since: NOW - 2 * DAY,
      projects: [{ project_id: laika, waiting: 3 }],
    });
  });

  it('answers an empty queue for a manager who leads nothing, and none for a builder', () => {
    seedQueue();
    setProfileKind(t.db, actor(ada), eve, 'manager', NOW);

    expect(getProfile(t.db, actor(ada), eve, NOW).queue).toEqual({
      projects_led: 0,
      waiting: 0,
      oldest_waiting_since: null,
      projects: [],
    });
    expect('queue' in getProfile(t.db, actor(ada), cal, NOW)).toBe(false);
  });
});

describe('a builder’s writes by agent (LAI-750)', () => {
  beforeEach(() => {
    seedHistory();
    seedAgents();
  });

  const tokenId = (name: string, userId = bea): string =>
    t.db
      .select()
      .from(tokens)
      .all()
      .find((x) => x.name === name && x.userId === userId)!.id;

  function viaToken(userId: string, id: string): ResolvedActor {
    return { ...actor(userId), token: { id, scope: 'full', projectIds: null } };
  }

  function write(userId: string, id: string | null, at: number): void {
    const orgId = t.db.select().from(orgs).get()!.id;
    appendActivity(t.db, {
      orgId,
      actorId: userId,
      actorKind: id === null ? 'user' : 'agent',
      actorTokenId: id,
      type: 'task.updated',
      now: at,
    });
  }

  it('groups their token writes in the window by the agent each token last connected as', () => {
    const claude = tokenId('Claude Code');
    const codex = tokenId('Codex');
    const cursor = tokenId('Cursor'); // revoked at M0 − 1 week: its writes still happened

    // A real write through a token: the status change stamps the token on the row.
    const lai9 = task('laika', 'Nine');
    claimTask(t.sqlite, t.db, actor(bea), lai9, M0 - 2 * WEEK);
    const before = t.db.all(sql`SELECT id FROM activity WHERE actor_token_id IS NOT NULL`).length;
    changeStatus(t.db, viaToken(bea, claude), lai9, 'review', M0 - 2 * WEEK + DAY);
    expect(
      t.db.all(sql`SELECT id FROM activity WHERE actor_token_id IS NOT NULL`).length - before,
    ).toBe(1);

    write(bea, claude, M0 - 3 * DAY);
    write(bea, codex, M0 - 5 * WEEK);
    write(bea, cursor, M0 - 2 * WEEK);
    // Not counted: Codex before the window, after NOW, Bea on a session, and
    // Cal on a token of his own.
    write(bea, codex, SINCE - DAY);
    write(bea, codex, NOW + HOUR);
    write(bea, null, M0 - DAY);
    const cals = newId();
    t.db
      .insert(tokens)
      .values({
        id: cals,
        userId: cal,
        name: 'Claude Code',
        prefix: 'lai_cccc',
        tokenHash: newId(),
        scope: 'full',
        lastClient: 'claude-code',
        createdAt: M0 - 20 * WEEK,
      })
      .run();
    write(cal, cals, M0 - DAY);

    const agents = getProfile(t.db, actor(ada), bea, NOW).agents;
    expect(agents?.writes).toEqual([
      { client: 'claude-code', writes: 2 },
      { client: 'codex', writes: 1 },
      { client: 'cursor', writes: 1 },
    ]);
    expect(agents?.writes_total).toBe(4);
  });

  it('answers no writes, not a missing figure, when they used no agent in the window', () => {
    const agents = getProfile(t.db, actor(ada), bea, NOW).agents;
    expect(agents?.writes).toEqual([]);
    expect(agents?.writes_total).toBe(0);
  });
});
