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
