import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  heartbeats,
  orgs,
  projects,
  tasks,
  tokens,
  unlistedWork,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { capacityNow, presenceNow, PRESENCE_WINDOW_MS } from '../../src/services/presence.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

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
      avatarColor: '#123456',
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
    beat(ada, NOW - 60_000, 'kvell/laika');
    beat(ada, NOW - 1000, 'kvell/other');

    const present = presenceNow(t.db, actor(adminId), NOW).present;

    expect(present).toHaveLength(1);
    expect(present[0]?.repo).toBe('kvell/other');
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
  it('hides a heartbeat attributed only to a project the reader is not in', () => {
    const outsider = makeUser('member', 'Outsider');
    const insider = makeUser('member', 'Insider');
    addMember(t.db, actor(adminId), 'laika', insider, 'member');
    beat(insider, NOW - 1000, 'kvell/laika');

    // From the **reader's** authority, the way `resolveMentions` does it.
    expect(presenceNow(t.db, actor(outsider), NOW).present).toHaveLength(0);
    expect(presenceNow(t.db, actor(insider), NOW).present).toHaveLength(1);
  });

  it('shows a heartbeat that attributes to no project at all', () => {
    const outsider = makeUser('member', 'Outsider');
    const ada = makeUser('member', 'Ada');
    beat(ada, NOW - 1000, 'someone/untracked');

    // It names no project, so there is nothing to leak — it says only that
    // somebody is working, which the member list already gives away.
    expect(presenceNow(t.db, actor(outsider), NOW).present).toHaveLength(1);
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
      .set({ assigneeId: ada, status: 'in_progress', startedAt: NOW - 3_600_000 })
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
      .set({ assigneeId: ada, status: 'in_progress' })
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
