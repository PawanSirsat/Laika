import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { appendActivity } from '../../src/db/activity.ts';
import {
  heartbeats,
  orgs,
  projects,
  sessions,
  tasks,
  tokens,
  unlistedWork,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  agentPresenceFor,
  AWAY_WINDOW_MS,
  capacityNow,
  loadOf,
  presenceNow,
  PRESENCE_WINDOW_MS,
  statusOf,
  type CapacityWorkload,
} from '../../src/services/presence.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { atCategory, freshDb, preparedDuring, queryPlansOf, type TestDb } from '../helpers/db.ts';

/**
 * §9.3's derived views (LAI-432).
 *
 * **The clock is injected.** A five-minute window tested against the real clock
 * is a flake waiting for a slow CI box, and the edges are the whole rule.
 */

const NOW = 1_800_000_000_000;

let t: TestDb;
let adminId: string;

function makeUser(orgRole: OrgRole, name: string = orgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
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

function beat(userId: string, at: number, repo = 'kvell/laika', tokenId: string | null = null) {
  t.db
    .insert(heartbeats)
    .values({
      id: newId(),
      userId,
      tokenId,
      repo,
      branch: 'main',
      matchedTaskId: null,
      createdAt: at,
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  adminId = makeUser('admin', 'Admin');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: NOW, updatedAt: NOW })
    .run();
  const project = createProject(t.sqlite, t.db, actor(adminId), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  });
  t.db.update(projects).set({ repo: 'kvell/laika' }).where(eq(projects.id, project.id)).run();
});
afterEach(() => {
  t.close();
});

describe('the five-minute window, at its edges', () => {
  it('shows a heartbeat at 4m59s and not one at 5m01s', () => {
    const recent = makeUser('member', 'Recent');
    const stale = makeUser('member', 'Stale');
    beat(recent, NOW - (PRESENCE_WINDOW_MS - 1000));
    beat(stale, NOW - (PRESENCE_WINDOW_MS + 1000));

    const names = presenceNow(t.db, actor(adminId), NOW).present.map((p) => p.name);

    expect(names).toEqual(['Recent']);
  });

  it('excludes one exactly on the boundary', () => {
    const edge = makeUser('member', 'Edge');
    beat(edge, NOW - PRESENCE_WINDOW_MS);

    // `gt`, not `gte` — five minutes ago is no longer "the last five minutes".
    expect(presenceNow(t.db, actor(adminId), NOW).present).toHaveLength(0);
  });

  it('reports one row per person, the newest', () => {
    const ada = makeUser('member', 'Ada');
    // Both on the tracked repo, so `repo` is visible to the admin and the
    // assertion is about *which* heartbeat won rather than about the gate.
    beat(ada, NOW - 60_000, 'kvell/laika');
    beat(ada, NOW - 1000, 'kvell/laika');

    const present = presenceNow(t.db, actor(adminId), NOW).present;

    expect(present).toHaveLength(1);
    expect(present[0]?.last_seen).toBe(NOW - 1000);
  });
});

describe('disabled is not empty (§4.2, §11.4.2)', () => {
  it('answers enabled:false rather than an empty list', () => {
    const ada = makeUser('member', 'Ada');
    beat(ada, NOW - 1000);
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();

    const view = presenceNow(t.db, actor(adminId), NOW);

    // "Nobody is working" and "this org does not record who is working" are the
    // same JSON to a careless reader and opposite facts to a person.
    expect(view.enabled).toBe(false);
    expect(view.present).toEqual([]);
  });

  it('an empty board with presence on is enabled:true', () => {
    const view = presenceNow(t.db, actor(adminId), NOW);

    // The other half of the same distinction. Without this the flag could be
    // hard-coded false and the test above would still pass.
    expect(view.enabled).toBe(true);
    expect(view.present).toEqual([]);
  });

  it('capacity says so too, and still lists people', () => {
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();

    const view = capacityNow(t.db, actor(adminId), NOW);

    // Capacity is not only presence: in-progress and review counts are real
    // whether or not heartbeats are recorded. Only the session columns go.
    expect(view.enabled).toBe(false);
    expect(view.people.length).toBeGreaterThan(0);
    expect(view.people.every((p) => p.active_sessions === 0)).toBe(true);
  });
});

describe('it leaks no project the caller cannot read', () => {
  it('hides where, not who, from a reader outside the project', () => {
    const outsider = makeUser('member', 'Outsider');
    const insider = makeUser('member', 'Insider');
    addMember(t.db, actor(adminId), 'laika', insider, 'member');
    beat(insider, NOW - 1000, 'kvell/laika');

    // **Changed by LAI-438.** This used to drop the entry entirely. Presence
    // answers "who is working right now", which is org-level — dropping the
    // person would make the headcount depend on who is asking. What is private
    // is *where*, because D-046's hook fires in every repository somebody opens.
    const [hidden] = presenceNow(t.db, actor(outsider), NOW).present;
    expect(hidden?.name).toBe('Insider');
    expect(hidden?.repo).toBeUndefined();
    expect(hidden?.branch).toBeUndefined();
    expect(hidden?.project_ids).toEqual([]);
    expect(hidden?.matched_task_id).toBeNull();

    const [seen] = presenceNow(t.db, actor(insider), NOW).present;
    expect(seen?.repo).toBe('kvell/laika');
  });

  it('names nobody’s untracked repo, to any reader including an admin', () => {
    const ada = makeUser('member', 'Ada');
    beat(ada, NOW - 1000, 'someone/private-side-project');

    // The leak LAI-438 exists for. `LAIKA_URL` lives in user settings (D-046),
    // so the hook fires in **every** repository somebody opens — and an
    // unrelated private repo is not the org's business, not even the owner's.
    for (const reader of [adminId, makeUser('owner', 'Owner')]) {
      const [entry] = presenceNow(t.db, actor(reader), NOW).present;

      expect(entry?.name, reader).toBe('Ada');
      expect(entry?.repo, reader).toBeUndefined();
      expect('repo' in (entry ?? {}), reader).toBe(false);
    }
  });

  it('shows it when the reader can see one of several attributed projects', () => {
    const second = createProject(t.sqlite, t.db, actor(adminId), {
      name: 'Web',
      slug: 'web',
      prefix: 'WEB',
    });
    t.db.update(projects).set({ repo: 'kvell/laika' }).where(eq(projects.id, second.id)).run();

    const reader = makeUser('member', 'Reader');
    addMember(t.db, actor(adminId), 'web', reader, 'member');
    const ada = makeUser('member', 'Ada');
    beat(ada, NOW - 1000, 'kvell/laika');

    // A monorepo attributes to both; seeing either is enough.
    expect(presenceNow(t.db, actor(reader), NOW).present).toHaveLength(1);
  });
});

describe('agent sessions are distinguishable from humans (§11.4.2)', () => {
  /** A real token row — `heartbeats.token_id` is a foreign key (LAI-417). */
  function tokenFor(userId: string): string {
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId,
        name: 'agent',
        prefix: 'lai_test',
        tokenHash: `${id}-hash`,
        scope: 'full',
        projectIdsJson: null,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: NOW,
      })
      .run();
    return id;
  }

  it('marks a heartbeat on a token as an agent and a cookie as not', () => {
    const human = makeUser('member', 'Human');
    const bot = makeUser('member', 'Agent');
    beat(human, NOW - 1000);
    beat(bot, NOW - 1000, 'kvell/laika', tokenFor(bot));

    const byName = new Map(
      presenceNow(t.db, actor(adminId), NOW).present.map((p) => [p.name, p.is_agent]),
    );

    // **Both halves.** Asserting only `false` passes against an implementation
    // that never reports an agent at all, which is the failure §11.4.2's
    // requirement exists to prevent.
    expect(byName.get('Human')).toBe(false);
    expect(byName.get('Agent')).toBe(true);
  });

  it('counts distinct tokens as distinct sessions', () => {
    const bot = makeUser('member', 'Agent');
    beat(bot, NOW - 2000, 'kvell/laika', tokenFor(bot));
    beat(bot, NOW - 1000, 'kvell/laika', tokenFor(bot));

    const mine = capacityNow(t.db, actor(adminId), NOW).people.find((p) => p.user_id === bot);

    // Two tokens beating is two sessions; two beats from one token is one.
    expect(mine?.active_sessions).toBe(2);
  });
});

describe('capacity', () => {
  it('counts in-progress and review work the reader can see', () => {
    const ada = makeUser('member', 'Ada');
    addMember(t.db, actor(adminId), 'laika', ada, 'member');
    const task = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Doing' });
    t.db
      .update(tasks)
      .set({
        assigneeId: ada,
        ...atCategory(t.db, task.project_id, 'in_progress'),
        startedAt: NOW - 3_600_000,
      })
      .where(eq(tasks.id, task.id))
      .run();

    const mine = capacityNow(t.db, actor(adminId), NOW).people.find((p) => p.user_id === ada);

    expect(mine?.in_progress_tasks).toEqual([task.id]);
    expect(mine?.oldest_in_progress_ms).toBe(3_600_000);
  });

  it('hides tasks in a project the reader cannot see', () => {
    const ada = makeUser('member', 'Ada');
    const outsider = makeUser('member', 'Outsider');
    const task = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Doing' });
    t.db
      .update(tasks)
      .set({ assigneeId: ada, ...atCategory(t.db, task.project_id, 'in_progress') })
      .where(eq(tasks.id, task.id))
      .run();

    const seen = capacityNow(t.db, actor(outsider), NOW).people.find((p) => p.user_id === ada);

    expect(seen?.in_progress_tasks).toEqual([]);
  });

  it('gives `unlisted` only to a caller who may read the pile', () => {
    const ada = makeUser('member', 'Ada');
    t.db
      .insert(unlistedWork)
      .values({
        id: newId(),
        userId: ada,
        tokenId: null,
        repo: 'kvell/laika',
        note: 'Noticed something',
        promotedTaskId: null,
        dismissedAt: null,
        createdAt: NOW,
      })
      .run();

    const asAdmin = capacityNow(t.db, actor(adminId), NOW).people.find((p) => p.user_id === ada);
    const asMember = capacityNow(t.db, actor(ada), NOW).people.find((p) => p.user_id === ada);

    // §3.1 puts reading unlisted work behind "Export audit log", which is what
    // `listUnlisted` already asks for. **Absent, not empty** — an empty array
    // would say "this person has logged nothing", a different fact.
    expect(asAdmin?.unlisted).toHaveLength(1);
    expect(asMember?.unlisted).toBeUndefined();
    expect(asMember !== undefined && 'unlisted' in asMember).toBe(false);
  });
});

describe('permissions', () => {
  it('refuses a deactivated user, because can() does', () => {
    const ada = makeUser('member', 'Ada');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, ada)).run();

    expect(() => presenceNow(t.db, actor(ada), NOW)).toThrow(ApiError);
    expect(() => capacityNow(t.db, actor(ada), NOW)).toThrow(ApiError);
  });

  it('allows every role to ask', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(() => presenceNow(t.db, actor(makeUser(role)), NOW), role).not.toThrow();
    }
  });
});

/**
 * Where somebody is working is private; that they are working is not
 * (§9.3, D-046, LAI-438).
 *
 * `LAIKA_URL` lives in `~/.claude/settings.json` — *user* settings — so the
 * heartbeat hook fires in **every** repository that person opens. Consent to be
 * seen working on the org's projects is not consent to publish the name of
 * everything else you open.
 */
describe('one heartbeat, two readers', () => {
  it('gives the repo to a member of the matching project and not to a non-member', () => {
    const insider = makeUser('member', 'Insider');
    const outsider = makeUser('member', 'Outsider');
    addMember(t.db, actor(adminId), 'laika', insider, 'member');

    const worker = makeUser('member', 'Worker');
    addMember(t.db, actor(adminId), 'laika', worker, 'member');
    beat(worker, NOW - 1000, 'kvell/laika');

    // **One heartbeat, two readers.** Either reader alone passes against an
    // implementation that hides the repo from everybody — which would close the
    // leak and make the Capacity screen useless at the same time.
    const [toInsider] = presenceNow(t.db, actor(insider), NOW).present;
    const [toOutsider] = presenceNow(t.db, actor(outsider), NOW).present;

    expect(toInsider?.repo).toBe('kvell/laika');
    expect(toInsider?.branch).toBe('main');
    expect(toInsider?.project_ids).toHaveLength(1);

    expect(toOutsider?.name).toBe('Worker');
    expect(toOutsider?.repo).toBeUndefined();
    expect(toOutsider?.branch).toBeUndefined();
  });

  it('treats "no project" and "no project you can read" identically', () => {
    const outsider = makeUser('member', 'Outsider');
    const worker = makeUser('member', 'Worker');
    addMember(t.db, actor(adminId), 'laika', worker, 'member');

    beat(worker, NOW - 2000, 'kvell/laika');
    const tracked = presenceNow(t.db, actor(outsider), NOW).present[0];

    t.db.delete(heartbeats).run();
    beat(worker, NOW - 2000, 'someone/untracked');
    const untracked = presenceNow(t.db, actor(outsider), NOW).present[0];

    // A repo tracked by a project you cannot see is exactly as private as one
    // tracked by nothing, and there is one code path so they cannot drift.
    expect({ ...tracked, last_seen: 0 }).toEqual({ ...untracked, last_seen: 0 });
  });

  it('withholds the resolved task too, not only the repo', () => {
    const outsider = makeUser('member', 'Outsider');
    const worker = makeUser('member', 'Worker');
    addMember(t.db, actor(adminId), 'laika', worker, 'member');
    const task = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Secret work' });

    // A heartbeat that **does** resolve, so `matched_task_id` is populated —
    // none of the fixtures above had one, which is why a mutation leaking it
    // survived until this test existed.
    t.db
      .insert(heartbeats)
      .values({
        id: newId(),
        userId: worker,
        tokenId: null,
        repo: 'kvell/laika',
        branch: `lai-${task.number}-x`,
        matchedTaskId: task.id,
        createdAt: NOW - 1000,
      })
      .run();

    const [hidden] = presenceNow(t.db, actor(outsider), NOW).present;
    const [seen] = presenceNow(t.db, actor(adminId), NOW).present;

    // The task id names the work as surely as the repo names the place. All
    // three of `repo`, `branch` and `matched_task_id` follow one gate, or the
    // absence of the others is decorative.
    expect(hidden?.matched_task_id).toBeNull();
    expect(seen?.matched_task_id).toBe(task.id);
  });

  it('omits the keys rather than emptying them', () => {
    const outsider = makeUser('member', 'Outsider');
    const worker = makeUser('member', 'Worker');
    beat(worker, NOW - 1000, 'someone/untracked');

    const entry = presenceNow(t.db, actor(outsider), NOW).present[0];

    // `repo: ''` is a different claim and a client would render it — the same
    // rule as `unlisted` and the org's `ai` block.
    expect('repo' in (entry ?? {})).toBe(false);
    expect('branch' in (entry ?? {})).toBe(false);
    expect(JSON.stringify(entry)).not.toContain('someone/untracked');
  });

  it('still tells the reader when the work was seen, and whether it is an agent', () => {
    const outsider = makeUser('member', 'Outsider');
    const worker = makeUser('member', 'Worker');
    beat(worker, NOW - 1000, 'someone/untracked');

    const entry = presenceNow(t.db, actor(outsider), NOW).present[0];

    // Presence keeps answering "who is working right now". Hiding the location
    // must not hollow out the view.
    expect(entry?.last_seen).toBe(NOW - 1000);
    expect(entry?.is_agent).toBe(false);
    expect(entry?.user_id).toBe(worker);
  });
});

describe('the window is an index range, not a scan (LAI-722)', () => {
  /**
   * Both views ask "every heartbeat in the last five minutes" — `created_at`
   * alone. The only index was `(user_id, created_at)`, which cannot serve that,
   * so each Presence or Capacity load walked the whole table and sorted it.
   */
  for (const [name, read] of [
    ['presence', () => presenceNow(t.db, actor(adminId), NOW)],
    ['capacity', () => capacityNow(t.db, actor(adminId), NOW)],
  ] as const) {
    it(`${name} reads heartbeats through heartbeats_created_at_idx`, () => {
      const plan = queryPlansOf(t.sqlite, 'heartbeats', read).join('\n');

      expect(plan).toContain('heartbeats_created_at_idx');
      expect(plan).not.toMatch(/SCAN heartbeats\b/);
      expect(plan).not.toContain('TEMP B-TREE FOR ORDER BY');
    });
  }
});

describe('an MCP call is presence, with no heartbeat (D-076)', () => {
  /**
   * Codex, Cursor, OpenCode, Gemini CLI and Omnigent never POST /heartbeats —
   * only Claude Code's plugin hook does. Their only trace is the token they
   * call `/mcp` with.
   */
  function mcpToken(
    userId: string,
    lastMcpAt: number | null,
    options: {
      client?: string | null;
      name?: string;
      revokedAt?: number | null;
      expiresAt?: number | null;
    } = {},
  ): string {
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId,
        name: options.name ?? 'agent',
        prefix: 'lai_test',
        tokenHash: `${id}-hash`,
        scope: 'full',
        lastMcpAt,
        lastClient: options.client === undefined ? 'cursor' : options.client,
        revokedAt: options.revokedAt ?? null,
        expiresAt: options.expiresAt ?? null,
        createdAt: NOW,
      })
      .run();
    return id;
  }

  function entryFor(userId: string) {
    return presenceNow(t.db, actor(adminId), NOW).present.find((p) => p.user_id === userId);
  }

  it('shows a token used inside the window and not one used before it', () => {
    const recent = makeUser('member', 'Recent');
    const stale = makeUser('member', 'Stale');
    const edge = makeUser('member', 'Edge');
    mcpToken(recent, NOW - (PRESENCE_WINDOW_MS - 1000));
    mcpToken(stale, NOW - (PRESENCE_WINDOW_MS + 1000));
    mcpToken(edge, NOW - PRESENCE_WINDOW_MS);
    mcpToken(makeUser('member', 'Never'), null);

    const names = presenceNow(t.db, actor(adminId), NOW).present.map((p) => p.name);

    expect(names).toEqual(['Recent']);
  });

  it('is an agent, with the client, and no location at all', () => {
    const ada = makeUser('member', 'Ada');
    mcpToken(ada, NOW - 1000, { client: 'codex' });

    const entry = entryFor(ada);

    expect(entry).toEqual({
      user_id: ada,
      name: 'Ada',
      matched_task_id: null,
      project_ids: [],
      is_agent: true,
      client: 'codex',
      clients: ['codex'],
      last_seen: NOW - 1000,
    });
    // Absent, not null: `repo` is the client's "may I say where" discriminator.
    expect(entry !== undefined && 'repo' in entry).toBe(false);
    expect(entry !== undefined && 'branch' in entry).toBe(false);
  });

  it('merges with a heartbeat: the heartbeat keeps the location, the newest time wins', () => {
    const ada = makeUser('member', 'Ada');
    beat(ada, NOW - 60_000, 'kvell/laika', mcpToken(ada, null, { client: 'claude-code' }));
    mcpToken(ada, NOW - 1000, { client: 'codex' });

    const present = presenceNow(t.db, actor(adminId), NOW).present;

    expect(present).toHaveLength(1);
    expect(present[0]).toMatchObject({
      repo: 'kvell/laika',
      branch: 'main',
      last_seen: NOW - 1000,
      is_agent: true,
      client: 'codex',
      clients: ['codex', 'claude-code'],
    });
  });

  it('keeps the heartbeat’s time when it is the newer', () => {
    const ada = makeUser('member', 'Ada');
    mcpToken(ada, NOW - 60_000, { client: 'codex' });
    beat(ada, NOW - 1000, 'kvell/laika', mcpToken(ada, null, { client: 'claude-code' }));

    expect(entryFor(ada)).toMatchObject({
      last_seen: NOW - 1000,
      client: 'claude-code',
      clients: ['claude-code', 'codex'],
    });
  });

  it('counts one token beating and calling MCP as one client, once', () => {
    const ada = makeUser('member', 'Ada');
    const token = mcpToken(ada, NOW - 2000, { client: 'claude-code' });
    beat(ada, NOW - 1000, 'kvell/laika', token);

    expect(entryFor(ada)).toMatchObject({ client: 'claude-code', clients: ['claude-code'] });
    expect(
      capacityNow(t.db, actor(adminId), NOW).people.find((p) => p.user_id === ada)?.active_sessions,
    ).toBe(1);
  });

  it('names a heartbeat token that never spoke MCP from its token name', () => {
    const ada = makeUser('member', 'Ada');
    beat(
      ada,
      NOW - 1000,
      'kvell/laika',
      mcpToken(ada, null, { client: null, name: 'laika-claude on macOS' }),
    );

    expect(entryFor(ada)).toMatchObject({ client: 'claude-code', clients: ['claude-code'] });
  });

  it('gives a cookie heartbeat no client', () => {
    const ada = makeUser('member', 'Ada');
    beat(ada, NOW - 1000);

    expect(entryFor(ada)).toMatchObject({ is_agent: false, client: null, clients: [] });
  });

  it('drops a revoked token', () => {
    const ada = makeUser('member', 'Ada');
    mcpToken(ada, NOW - 1000, { revokedAt: NOW - 500 });

    expect(entryFor(ada)).toBeUndefined();
  });

  it('drops an expired token, and keeps one that expires later', () => {
    const gone = makeUser('member', 'Gone');
    const still = makeUser('member', 'Still');
    mcpToken(gone, NOW - 1000, { expiresAt: NOW - 500 });
    mcpToken(still, NOW - 1000, { expiresAt: NOW + 60_000 });

    expect(presenceNow(t.db, actor(adminId), NOW).present.map((p) => p.name)).toEqual(['Still']);
  });

  it('drops a heartbeat on a revoked or expired token, and keeps a cookie heartbeat', () => {
    // The same rule as an MCP call: a token that can make no further request
    // has no live session, whichever way it was last seen.
    const revoked = makeUser('member', 'Revoked');
    const expired = makeUser('member', 'Expired');
    const cookie = makeUser('member', 'Cookie');
    beat(revoked, NOW - 1000, 'kvell/laika', mcpToken(revoked, null, { revokedAt: NOW - 500 }));
    beat(expired, NOW - 1000, 'kvell/laika', mcpToken(expired, null, { expiresAt: NOW - 500 }));
    beat(cookie, NOW - 1000);

    expect(presenceNow(t.db, actor(adminId), NOW).present.map((p) => p.name)).toEqual(['Cookie']);

    const people = capacityNow(t.db, actor(adminId), NOW).people;
    for (const id of [revoked, expired]) {
      expect(people.find((p) => p.user_id === id)).toMatchObject({
        active_sessions: 0,
        last_seen: null,
      });
    }
    expect(people.find((p) => p.user_id === cookie)).toMatchObject({
      active_sessions: 1,
      last_seen: NOW - 1000,
    });
  });

  it('names the agent session even when a cookie heartbeat is newer', () => {
    const ada = makeUser('member', 'Ada');
    mcpToken(ada, NOW - 60_000, { client: 'codex' });
    beat(ada, NOW - 1000);

    expect(entryFor(ada)).toMatchObject({
      repo: 'kvell/laika',
      is_agent: true,
      client: 'codex',
      clients: ['codex'],
      last_seen: NOW - 1000,
    });
  });

  it('orders merged entries by their newest session, from either source', () => {
    const ada = makeUser('member', 'Ada');
    const bob = makeUser('member', 'Bob');
    beat(ada, NOW - 120_000);
    mcpToken(ada, NOW - 1000);
    beat(bob, NOW - 60_000);

    expect(presenceNow(t.db, actor(adminId), NOW).present.map((p) => p.name)).toEqual([
      'Ada',
      'Bob',
    ]);
  });

  it('shows nothing when presence is off', () => {
    const ada = makeUser('member', 'Ada');
    mcpToken(ada, NOW - 1000);
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();

    expect(presenceNow(t.db, actor(adminId), NOW)).toEqual({ enabled: false, present: [] });
    expect(
      capacityNow(t.db, actor(adminId), NOW).people.find((p) => p.user_id === ada),
    ).toMatchObject({ active_sessions: 0, last_seen: null });
  });

  it('counts sessions across heartbeats and MCP calls by token, in capacity', () => {
    const ada = makeUser('member', 'Ada');
    beat(ada, NOW - 3000, 'kvell/laika', mcpToken(ada, NOW - 2000, { client: 'claude-code' }));
    mcpToken(ada, NOW - 1000, { client: 'codex' });
    mcpToken(ada, NOW - (PRESENCE_WINDOW_MS + 1), { client: 'cursor' });

    const mine = capacityNow(t.db, actor(adminId), NOW).people.find((p) => p.user_id === ada);

    expect(mine).toMatchObject({ active_sessions: 2, last_seen: NOW - 1000 });
  });
});

describe('a REST write is presence too, with no heartbeat (D-081)', () => {
  /**
   * An agent on the REST API or the `laika` CLI never calls `/mcp`. Its trace
   * is `last_rest_write_at`, stamped by the auth middleware on a token's write.
   */
  function restToken(
    userId: string,
    lastRestWriteAt: number | null,
    lastMcpAt: number | null = null,
  ): string {
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId,
        name: 'omnigent on macOS',
        prefix: 'lai_test',
        tokenHash: `${id}-hash`,
        scope: 'full',
        lastRestWriteAt,
        lastMcpAt,
        createdAt: NOW,
      })
      .run();
    return id;
  }

  it('shows a token that wrote inside the window and not one that wrote before it', () => {
    const recent = makeUser('member', 'Recent');
    restToken(recent, NOW - (PRESENCE_WINDOW_MS - 1000));
    restToken(makeUser('member', 'Stale'), NOW - (PRESENCE_WINDOW_MS + 1000));
    restToken(makeUser('member', 'Never'), null);

    const present = presenceNow(t.db, actor(adminId), NOW).present;

    expect(present.map((p) => p.name)).toEqual(['Recent']);
    // Credited to the token's agent by its name, and no location at all.
    expect(present[0]).toMatchObject({
      is_agent: true,
      client: 'omnigent',
      last_seen: NOW - (PRESENCE_WINDOW_MS - 1000),
    });
    expect(present[0]).not.toHaveProperty('repo');
  });

  it('is one session with the same token’s MCP call, at the newer of the two', () => {
    const ada = makeUser('member', 'Ada');
    restToken(ada, NOW - 1000, NOW - 9000);

    expect(
      capacityNow(t.db, actor(adminId), NOW).people.find((p) => p.user_id === ada),
    ).toMatchObject({ active_sessions: 1, last_seen: NOW - 1000 });
    expect(agentPresenceFor(t.db, ada, NOW)).toEqual({
      enabled: true,
      clients: ['omnigent'],
      last_seen: NOW - 1000,
    });
  });
});

/**
 * The redesigned page's figures (LAI-767): last seen, its status, the workload
 * and its load badge, and the fields only an owner or admin is given.
 */
describe('capacity per person (LAI-767)', () => {
  const MIN = 60_000;
  const DAY = 86_400_000;
  const TODAY = Date.parse(`${new Date(NOW).toISOString().slice(0, 10)}T00:00:00Z`);

  function orgId(): string {
    const org = t.db.select({ id: orgs.id }).from(orgs).get();
    if (org === undefined) throw new Error('no org');
    return org.id;
  }

  function signIn(userId: string, createdAt: number, updatedAt: number = createdAt): void {
    t.db
      .insert(sessions)
      .values({
        id: newId(),
        userId,
        token: newId(),
        expiresAt: new Date(NOW + 7 * DAY),
        createdAt: new Date(createdAt),
        updatedAt: new Date(updatedAt),
      })
      .run();
  }

  /** A board action: a web session's, or an agent's on `tokenId` (§4.8). */
  function act(
    userId: string,
    at: number,
    actorKind: 'user' | 'agent' = 'user',
    tokenId: string | null = null,
  ): void {
    appendActivity(t.db, {
      orgId: orgId(),
      actorId: userId,
      actorKind,
      actorTokenId: tokenId,
      type: 'token.created',
      now: at,
    });
  }

  function token(
    userId: string,
    over: {
      lastMcpAt?: number;
      lastUsedAt?: number;
      client?: string;
      revokedAt?: number;
      expiresAt?: number;
    } = {},
  ): string {
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId,
        name: 'agent',
        prefix: 'lai_test',
        tokenHash: `${id}-hash`,
        scope: 'full',
        lastMcpAt: over.lastMcpAt ?? null,
        lastUsedAt: over.lastUsedAt ?? over.lastMcpAt ?? null,
        lastClient: over.client ?? 'codex',
        revokedAt: over.revokedAt ?? null,
        expiresAt: over.expiresAt ?? null,
        createdAt: NOW - DAY,
      })
      .run();
    return id;
  }

  function assigned(
    userId: string,
    category: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled',
    dueOn: number | null = null,
    slug = 'laika',
  ): string {
    const task = createTask(t.sqlite, t.db, actor(adminId), slug, { title: `${category} work` });
    t.db
      .update(tasks)
      .set({ assigneeId: userId, dueOn, ...atCategory(t.db, task.project_id, category) })
      .where(eq(tasks.id, task.id))
      .run();
    return task.id;
  }

  function entry(userId: string, reader: string = adminId) {
    const found = capacityNow(t.db, actor(reader), NOW).people.find((p) => p.user_id === userId);
    if (found === undefined) throw new Error('no entry');
    return found;
  }

  describe('last seen is the newest of every signal', () => {
    it('is a sign-in, then a board action, then an agent call, whichever is newest', () => {
      const ada = makeUser('member', 'Ada');

      signIn(ada, NOW - 120 * MIN);
      expect(entry(ada)).toMatchObject({
        last_seen: NOW - 120 * MIN,
        last_seen_via: 'web',
        status: 'offline',
      });

      act(ada, NOW - 30 * MIN);
      expect(entry(ada)).toMatchObject({
        last_seen: NOW - 30 * MIN,
        last_seen_via: 'board',
        status: 'away',
      });

      token(ada, { lastMcpAt: NOW - MIN });
      expect(entry(ada)).toMatchObject({
        last_seen: NOW - MIN,
        last_seen_via: 'agent',
        status: 'online',
      });
    });

    it('counts an agent’s board write, and a heartbeat older than the window', () => {
      const bea = makeUser('member', 'Bea');
      const cal = makeUser('member', 'Cal');
      act(bea, NOW - 3 * MIN, 'agent', token(bea));
      beat(cal, NOW - 2 * DAY, 'kvell/laika', token(cal));

      expect(entry(bea)).toMatchObject({ last_seen_via: 'agent', status: 'online' });
      expect(entry(cal)).toMatchObject({
        last_seen: NOW - 2 * DAY,
        last_seen_via: 'agent',
        status: 'offline',
      });
    });

    it('does not count a session’s updated_at, which an open tab’s poll slides', () => {
      const ada = makeUser('member', 'Ada');
      signIn(ada, NOW - 3 * DAY, NOW - MIN);

      expect(entry(ada)).toMatchObject({ last_seen: NOW - 3 * DAY, status: 'offline' });
    });

    it('does not count a read, or a revoked token', () => {
      const ada = makeUser('member', 'Ada');
      // `last_used_at` moves on a read (D-081); a revoked token's call is gone.
      token(ada, { lastUsedAt: NOW - MIN, client: 'cursor' });
      token(ada, { lastMcpAt: NOW - MIN, revokedAt: NOW - 1000 });

      expect(entry(ada)).toMatchObject({
        last_seen: null,
        last_seen_via: null,
        status: 'never',
      });

      // Nor a board action written on a token that can no longer make a
      // request: revoked or expired since, its agent is not here, so the row
      // neither puts the person online nor moves their last seen — the rule
      // heartbeats and `/mcp` calls already follow (D-076).
      const bea = makeUser('member', 'Bea');
      signIn(bea, NOW - 120 * MIN);
      act(bea, NOW - 2 * MIN, 'agent', token(bea, { revokedAt: NOW - MIN }));
      const cal = makeUser('member', 'Cal');
      signIn(cal, NOW - 120 * MIN);
      act(cal, NOW - 2 * MIN, 'agent', token(cal, { expiresAt: NOW - MIN }));

      // Both people in one comparison, so a failure shows each of them.
      const seen = (id: string) => {
        const e = entry(id);
        return { last_seen: e.last_seen, via: e.last_seen_via, status: e.status, agents: e.agents };
      };
      const signedIn = { last_seen: NOW - 120 * MIN, via: 'web', status: 'offline', agents: [] };
      expect({ revoked: seen(bea), expired: seen(cal) }).toEqual({
        revoked: signedIn,
        expired: signedIn,
      });
    });

    it('is never seen with no signal at all', () => {
      const dee = makeUser('member', 'Dee');

      expect(entry(dee)).toMatchObject({ last_seen: null, last_seen_via: null, status: 'never' });
    });
  });

  describe('the status thresholds', () => {
    it('is online strictly inside five minutes, away inside the hour, offline after', () => {
      expect(statusOf(NOW - (5 * MIN - 1), NOW)).toBe('online');
      expect(statusOf(NOW - 5 * MIN, NOW)).toBe('away');
      expect(statusOf(NOW - (60 * MIN - 1), NOW)).toBe('away');
      expect(statusOf(NOW - 60 * MIN, NOW)).toBe('offline');
      expect(statusOf(null, NOW)).toBe('never');
      // The same window as a live session, so a dot and a session agree.
      expect(PRESENCE_WINDOW_MS).toBe(5 * MIN);
      expect(AWAY_WINDOW_MS).toBe(60 * MIN);
    });
  });

  describe('workload', () => {
    it('counts open assigned work by category and due date, nothing finished', () => {
      const ada = makeUser('member', 'Ada');
      addMember(t.db, actor(adminId), 'laika', ada, 'member');
      assigned(ada, 'in_progress', TODAY - DAY); // overdue
      assigned(ada, 'in_progress');
      assigned(ada, 'review', TODAY); // due today: soon, not overdue
      assigned(ada, 'todo', TODAY + 7 * DAY); // the last soon day
      assigned(ada, 'backlog', TODAY + 8 * DAY); // not soon
      assigned(ada, 'done', TODAY - DAY); // finished late is finished
      assigned(ada, 'cancelled');

      const mine = entry(ada);

      // D-092: to do and backlog apart, review apart, and the committed figure
      // the load rule reads beside them.
      expect(mine.workload).toEqual({
        in_progress: 2,
        todo: 1,
        backlog: 1,
        in_review: 1,
        committed: 3,
        overdue: 1,
        due_soon: 2,
        open: 5,
      });
      expect(mine.spaces).toEqual([
        expect.objectContaining({
          slug: 'laika',
          name: 'Laika',
          open: 5,
          in_progress: 2,
          committed: 3,
          load: 'light',
        }),
      ]);
      // The ids the plugin reads keep their meaning.
      expect(mine.in_progress_tasks).toHaveLength(2);
      expect(mine.tasks_in_review).toHaveLength(1);
    });

    it('counts per space, and only the spaces the reader may read', () => {
      const ada = makeUser('member', 'Ada');
      const outsider = makeUser('member', 'Outsider');
      createProject(t.sqlite, t.db, actor(adminId), {
        name: 'Secret',
        slug: 'secret',
        prefix: 'SEC',
      });
      assigned(ada, 'in_progress', null, 'laika');
      assigned(ada, 'in_progress', null, 'secret');
      assigned(ada, 'todo', null, 'secret');

      expect(entry(ada).spaces.map((s) => [s.slug, s.open])).toEqual([
        ['secret', 2],
        ['laika', 1],
      ]);
      // An outsider reads neither project, so neither is counted for them.
      expect(entry(ada, outsider)).toMatchObject({ load: 'none', spaces: [] });
      expect(entry(ada, outsider).workload.open).toBe(0);
    });

    // LAI-832: the case between "every space" and "none" — a reader who sees
    // one of the two. Ada is Heavy in Secret and Light in Laika; to someone
    // who can read only Laika, her overall load is Laika's.
    it('leaves a space the reader cannot see out of the overall load', () => {
      const ada = makeUser('member', 'Ada');
      const reader = makeUser('member', 'Reader');
      addMember(t.db, actor(adminId), 'laika', reader, 'member');
      createProject(t.sqlite, t.db, actor(adminId), {
        name: 'Secret',
        slug: 'secret',
        prefix: 'SEC',
      });
      const seen = assigned(ada, 'in_progress', null, 'laika');
      for (let i = 0; i < 7; i += 1) assigned(ada, 'in_progress', null, 'secret');
      for (let i = 0; i < 20; i += 1) assigned(ada, 'todo', null, 'secret');

      // Control: whoever reads both sees the hidden space's weight.
      expect(entry(ada)).toMatchObject({ load: 'heavy', workload: { committed: 28 } });

      const partial = entry(ada, reader);
      expect(partial.load).toBe('light');
      expect(partial.workload).toMatchObject({ in_progress: 1, todo: 0, committed: 1, open: 1 });
      expect(partial.spaces.map((s) => [s.slug, s.load])).toEqual([['laika', 'light']]);
      expect(partial.in_progress_tasks).toEqual([seen]);
    });
  });

  describe('the load rule', () => {
    /** Counts as the server builds them: committed and open follow from the parts. */
    const work = (over: Partial<CapacityWorkload>): CapacityWorkload => {
      const w = {
        in_progress: 0,
        todo: 0,
        backlog: 0,
        in_review: 0,
        overdue: 0,
        due_soon: 0,
        ...over,
      };
      return {
        ...w,
        committed: w.in_progress + w.todo,
        open: w.in_progress + w.todo + w.backlog + w.in_review,
      };
    };

    it('is none with nothing committed', () => {
      expect(loadOf(work({}))).toBe('none');
    });

    it('is heavy above 5 in progress or above 15 committed', () => {
      expect(loadOf(work({ in_progress: 6 }))).toBe('heavy');
      expect(loadOf(work({ in_progress: 5 }))).toBe('normal');
      expect(loadOf(work({ todo: 16 }))).toBe('heavy');
      expect(loadOf(work({ todo: 15 }))).toBe('normal');
      expect(loadOf(work({ in_progress: 4, todo: 12 }))).toBe('heavy');
    });

    it('is light at up to 2 in progress and up to 5 committed, normal above', () => {
      expect(loadOf(work({ in_progress: 2, todo: 3 }))).toBe('light');
      expect(loadOf(work({ in_progress: 3 }))).toBe('normal');
      expect(loadOf(work({ in_progress: 1, todo: 5 }))).toBe('normal');
    });

    // D-092 item 3, the three causes of "everyone is Heavy" (LAI-818).
    it('does not count review: 100 waiting on reviewers, nothing committed, is no load', () => {
      expect(loadOf(work({ in_review: 100 }))).toBe('none');
      expect(loadOf(work({ in_progress: 1, in_review: 100 }))).toBe('light');
    });

    it('does not count backlog: it is the pipeline', () => {
      expect(loadOf(work({ backlog: 209 }))).toBe('none');
      expect(loadOf(work({ todo: 4, backlog: 209 }))).toBe('light');
    });

    it('does not count overdue: it is its own badge', () => {
      expect(loadOf(work({ todo: 1, overdue: 1 }))).toBe('light');
      expect(loadOf(work({ backlog: 3, overdue: 3 }))).toBe('none');
    });

    it('is served beside the counts it came from', () => {
      const ada = makeUser('member', 'Ada');
      for (let i = 0; i < 7; i += 1) assigned(ada, 'in_progress');

      expect(entry(ada)).toMatchObject({ load: 'heavy', workload: { in_progress: 7 } });
    });
  });

  describe('load is committed work (D-092, LAI-818)', () => {
    it('a person with 0 in progress, 0 to do and 100 in review is not Heavy', () => {
      const ada = makeUser('member', 'Ada');
      for (let i = 0; i < 100; i += 1) assigned(ada, 'review');

      const mine = entry(ada);
      expect(mine.load).toBe('none');
      expect(mine.workload).toMatchObject({ in_review: 100, committed: 0, open: 100 });
      // The ids are unchanged: the plugin's "In review" line still reads them.
      expect(mine.tasks_in_review).toHaveLength(100);
    });

    it('backlog is shown apart and is not load', () => {
      const ada = makeUser('member', 'Ada');
      for (let i = 0; i < 20; i += 1) assigned(ada, 'backlog');
      assigned(ada, 'todo');

      expect(entry(ada)).toMatchObject({
        load: 'light',
        workload: { todo: 1, backlog: 20, committed: 1, open: 21 },
      });
    });

    it('overdue alone is not Heavy, and is still served as its own count', () => {
      const ada = makeUser('member', 'Ada');
      assigned(ada, 'todo', TODAY - DAY);
      assigned(ada, 'backlog', TODAY - 3 * DAY);

      expect(entry(ada)).toMatchObject({
        load: 'light',
        workload: { overdue: 2, committed: 1 },
      });
    });

    it('each space carries its own load, by the same rule', () => {
      const ada = makeUser('member', 'Ada');
      createProject(t.sqlite, t.db, actor(adminId), {
        name: 'Secret',
        slug: 'secret',
        prefix: 'SEC',
      });
      for (let i = 0; i < 6; i += 1) assigned(ada, 'in_progress', null, 'laika');
      assigned(ada, 'in_progress', null, 'secret');
      for (let i = 0; i < 30; i += 1) assigned(ada, 'backlog', null, 'secret');

      const mine = entry(ada);
      expect(mine.load).toBe('heavy');
      // Secret has the most open work and the least committed: committed sorts.
      expect(mine.spaces.map((s) => [s.slug, s.committed, s.backlog, s.load])).toEqual([
        ['laika', 6, 0, 'heavy'],
        ['secret', 1, 30, 'light'],
      ]);
    });
  });

  describe('what only an owner or admin is given', () => {
    it('gives the profile kind and the 14-day series to an admin, absent for a member', () => {
      const ada = makeUser('member', 'Ada');
      const bea = makeUser('member', 'Bea');
      act(ada, NOW - 1000);
      act(ada, NOW - 1000);
      act(ada, NOW - 13 * DAY);
      act(ada, NOW - 14 * DAY); // one day before the series starts

      const asAdmin = entry(ada);
      expect(asAdmin.profile_kind).toBe('builder');
      expect(asAdmin.activity_14d).toHaveLength(14);
      expect(asAdmin.activity_14d?.[13]).toBe(2);
      expect(asAdmin.activity_14d?.[0]).toBe(1);
      expect(asAdmin.activity_14d?.reduce((a, b) => a + b, 0)).toBe(3);

      const asMember = entry(ada, bea);
      expect('profile_kind' in asMember).toBe(false);
      expect('activity_14d' in asMember).toBe(false);
      expect('activity_14d_split' in asMember).toBe(false);
    });

    it('splits the fortnight into by hand, by agents and bookkeeping (D-092, LAI-818)', () => {
      const ada = makeUser('member', 'Ada');
      const agent = token(ada, { lastMcpAt: NOW - DAY });
      const log = (
        at: number,
        actorKind: 'user' | 'agent',
        type: 'token.created' | 'task.updated' | 'sprint.tasks_changed',
        payload: unknown = {},
      ): void => {
        appendActivity(t.db, {
          orgId: orgId(),
          actorId: ada,
          actorKind,
          actorTokenId: actorKind === 'agent' ? agent : null,
          type,
          payload,
          now: at,
        });
      };

      log(NOW - 1000, 'user', 'token.created');
      log(NOW - 2000, 'user', 'task.updated', { field: 'title' });
      log(NOW - DAY, 'agent', 'token.created');
      log(NOW - 2 * DAY, 'agent', 'task.updated', { field: 'description_md' });
      log(NOW - 3 * DAY, 'agent', 'token.created');
      // Bookkeeping: a sprint move, and a reorder either way (D-060.4).
      log(NOW - 3000, 'agent', 'sprint.tasks_changed', { field: 'sprint_id', from: null, to: 's' });
      log(NOW - 4000, 'agent', 'task.updated', { field: 'position', from: 'a0', to: 'a1' });
      log(NOW - 5000, 'user', 'task.updated', { field: 'position', from: 'a1', to: 'a2' });
      // Before the window, so in neither the series nor the split.
      log(NOW - 14 * DAY, 'agent', 'sprint.tasks_changed', { field: 'sprint_id' });

      const mine = entry(ada);
      expect(mine.activity_14d_split).toEqual({ by_self: 2, by_agents: 3, bookkeeping: 3 });
      // The three are the series' total, split: nothing lost, nothing twice.
      expect(mine.activity_14d?.reduce((a, b) => a + b, 0)).toBe(8);
    });

    it('counts the bookkeeping through the activity window index, not a scan', () => {
      makeUser('member', 'Ada');
      const plans = queryPlansOf(t.sqlite, 'activity', () =>
        capacityNow(t.db, actor(adminId), NOW),
      );

      expect(plans.join('\n')).toContain('activity_org_created_at_idx');
      expect(plans.join('\n')).not.toMatch(/SCAN activity\b/);
    });

    it('shows every agent they use to an admin, and only the running ones to a member', () => {
      const ada = makeUser('member', 'Ada');
      const bea = makeUser('member', 'Bea');
      token(ada, { lastMcpAt: NOW - MIN, client: 'claude-code' });
      token(ada, { lastMcpAt: NOW - 2 * DAY, client: 'cursor' });

      expect(entry(ada).agents).toEqual([
        { client: 'claude-code', running: true, last_at: NOW - MIN },
        { client: 'cursor', running: false, last_at: NOW - 2 * DAY },
      ]);
      expect(entry(ada, bea).agents).toEqual([
        { client: 'claude-code', running: true, last_at: NOW - MIN },
      ]);
    });

    it('carries email and org role for everyone, as the member list does', () => {
      const ada = makeUser('member', 'Ada');
      const bea = makeUser('member', 'Bea');

      expect(entry(adminId, bea)).toMatchObject({
        email: `${adminId}@example.test`,
        org_role: 'admin',
      });
      expect(entry(ada, bea).org_role).toBe('member');
    });
  });

  describe('presence off', () => {
    it('serves no status, last seen or running agent, and still the workload', () => {
      const ada = makeUser('member', 'Ada');
      signIn(ada, NOW - MIN);
      act(ada, NOW - MIN);
      token(ada, { lastMcpAt: NOW - MIN, client: 'codex' });
      assigned(ada, 'in_progress');
      t.db.update(orgs).set({ presenceEnabled: 0 }).run();

      const mine = entry(ada);

      expect(mine).toMatchObject({
        status: null,
        last_seen: null,
        last_seen_via: null,
        load: 'light',
      });
      expect(mine.workload.in_progress).toBe(1);
      expect(mine.agents.some((a) => a.running)).toBe(false);
    });

    it('gives an admin the agents a person uses, but never when they were used', () => {
      const ada = makeUser('member', 'Ada');
      token(ada, { lastUsedAt: NOW - DAY, client: 'cursor' });
      t.db.update(orgs).set({ presenceEnabled: 0 }).run();

      // "Last used yesterday" would answer "when was she here" for an org
      // that chose not to record it.
      expect(entry(ada).agents).toEqual([{ client: 'cursor', running: false, last_at: null }]);
    });
  });

  describe('one pass', () => {
    it('prepares the same statements for two people as for twelve', () => {
      const countFor = (): number =>
        preparedDuring(t.sqlite, () => capacityNow(t.db, actor(adminId), NOW)).length;

      makeUser('member', 'One');
      const few = countFor();
      for (let i = 0; i < 10; i += 1) {
        const id = makeUser('member', `Person ${String(i)}`);
        signIn(id, NOW - i * MIN);
        token(id, { lastMcpAt: NOW - i * MIN });
        assigned(id, 'in_progress');
      }

      expect(countFor()).toBe(few);
    });
  });
});
