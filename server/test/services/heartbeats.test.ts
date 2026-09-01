import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, heartbeats, orgs, projects, tasks, tokens, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  BRANCH_MAX_LENGTH,
  branchProjectPrefix,
  recordHeartbeat,
  REPO_MAX_LENGTH,
  normaliseRepo,
  resolveRepoProjects,
} from '../../src/services/heartbeats.ts';
import { createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Presence, at the service (SPEC §9.1, §4.10, D-005).
 *
 * The route tests own the transport — `202`, token-only, the strict body. What
 * is left here is what a caller reaching the service directly still gets: an
 * MCP tool or the plugin could, and a bound only the route applies is not a
 * bound (LAI-404).
 */

let t: TestDb;
let ownerId: string;

function makeUser(orgRole: OrgRole, label: string): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${label}@example.test`,
      name: label,
      orgRole,
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

/**
 * The same person, acting through a token.
 *
 * The token row is **real**, not a synthetic id: `heartbeats.token_id` is a
 * foreign key, and a fabricated one is refused by the database rather than
 * quietly stored. The route tests mint through the API and never met this; the
 * service tests would have, and the constraint said so immediately.
 */
function withToken(base: ResolvedActor, scope: 'full' | 'read_only'): ResolvedActor {
  const id = newId();
  t.db
    .insert(tokens)
    .values({
      id,
      userId: base.userId,
      name: 'test',
      prefix: 'lai_test',
      tokenHash: `${id}-hash`,
      scope,
      projectIdsJson: null,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: Date.now(),
    })
    .run();

  return { ...base, token: { id, scope, projectIds: null } };
}

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('owner', 'owner');
  const now = Date.now();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
});

afterEach(() => {
  t.close();
});

describe('what it records', () => {
  /**
   * Exhaustive on purpose, and it earned its keep: adding `project_ids` and
   * `attribution` in LAI-116 turned it red immediately. Those two are **not**
   * §4.10 columns and are not serialised by §9.1 — they are resolved (§4.3) and
   * ride the view so the route can warn about a repo nobody tracks. Asserted
   * here so the row and the resolution stay distinguishable.
   */
  it('writes §4.10’s columns, plus the resolution it does not store', () => {
    const view = recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
      repo: 'kvell/laika',
      branch: 'main',
      now: 1000,
    });

    expect(view).toEqual({
      id: view.id,
      user_id: ownerId,
      token_id: view.token_id,
      repo: 'kvell/laika',
      branch: 'main',
      matched_task_id: null,
      created_at: 1000,
      project_ids: [],
      attribution: 'none',
    });

    // The stored row still has nowhere to put either of them (D-005, §9.3).
    expect(Object.keys(t.db.select().from(heartbeats).get()!).sort()).toEqual([
      'branch',
      'createdAt',
      'id',
      'matchedTaskId',
      'repo',
      'tokenId',
      'userId',
    ]);
  });

  it('trims but does not otherwise touch the branch', () => {
    // §9.2's branch → task resolution is M5. Nothing here parses it, so a
    // branch that looks like a task key is still just a string.
    recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
      repo: '  kvell/laika  ',
      branch: '  feature/LAI-417  ',
    });

    const row = t.db.select().from(heartbeats).get();
    expect(row?.repo).toBe('kvell/laika');
    expect(row?.branch).toBe('feature/LAI-417');
    expect(row?.matchedTaskId).toBeNull();
  });

  it('writes no activity row', () => {
    // Presence is not an audited action, and §4.8's `heartbeat.session` names a
    // session rather than a ping — what writes it, and when, is M4's plugin
    // work or M5's presence view. Not this.
    recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), { repo: 'r', branch: 'b' });
    recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), { repo: 'r', branch: 'b' });

    expect(t.db.select().from(activity).all()).toHaveLength(0);
  });

  it('records a null token when there is none', () => {
    // §9.1 makes the endpoint token-only, but the service is reachable without
    // one and should say so honestly rather than inventing an id.
    recordHeartbeat(t.db, actor(ownerId), { repo: 'r', branch: 'b' });

    expect(t.db.select().from(heartbeats).get()?.tokenId).toBeNull();
  });
});

describe('the bounds are the service’s, not the route’s', () => {
  it('accepts exactly the limits', () => {
    expect(() =>
      recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
        repo: 'x'.repeat(REPO_MAX_LENGTH),
        branch: 'y'.repeat(BRANCH_MAX_LENGTH),
      }),
    ).not.toThrow();
  });

  it('refuses one character more, naming both limits', () => {
    try {
      recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
        repo: 'x'.repeat(REPO_MAX_LENGTH + 1),
        branch: 'b',
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const api = error as ApiError;
      expect(api.code).toBe('unprocessable');
      expect(api.details).toMatchObject({ repo_limit: REPO_MAX_LENGTH });
    }

    expect(t.db.select().from(heartbeats).all()).toHaveLength(0);
  });

  it('refuses an empty repo or branch', () => {
    for (const input of [
      { repo: '', branch: 'b' },
      { repo: 'r', branch: '' },
      { repo: '   ', branch: 'b' },
    ]) {
      expect(() => recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), input)).toThrowError(
        ApiError,
      );
    }
  });
});

describe('can() (§3.1’s "Send own heartbeat")', () => {
  it('allows every role that can hold a writing token', () => {
    // ✓ for all four in §3.1 — your own record about your own work — and the
    // three whose token can carry `full` scope can act on it.
    for (const role of ['owner', 'admin', 'member'] as const) {
      const id = makeUser(role, `${role}-user`);
      expect(() =>
        recordHeartbeat(t.db, withToken(actor(id), 'full'), { repo: 'r', branch: 'b' }),
      ).not.toThrow();
    }
  });

  it('refuses a Viewer even holding a token stored as `full`', () => {
    // **Stronger than "a Viewer's token is created read_only".** `can()` applies
    // `effectiveTokenScope`, which returns `read_only` for a Viewer *whatever
    // the stored row says* — so a token minted while they were a Member and
    // then demoted stops writing immediately, without anything revoking it.
    //
    // I expected this to pass and it did not, which is the better answer: the
    // forcing is at check time, not only at creation.
    const id = makeUser('viewer', 'viewer-full');

    try {
      recordHeartbeat(t.db, withToken(actor(id), 'full'), { repo: 'r', branch: 'b' });
      expect.unreachable('a Viewer is read_only whatever the token says');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });

  it('refuses a read_only token whatever the role', () => {
    // The credential, not the role — which is why the Viewer cell is ✓ and a
    // Viewer still cannot send one in practice (§9.1 is token-only, §4.9 forces
    // a Viewer's token to read_only).
    for (const role of ['owner', 'member', 'viewer'] as const) {
      const id = makeUser(role, `${role}-ro`);

      try {
        recordHeartbeat(t.db, withToken(actor(id), 'read_only'), { repo: 'r', branch: 'b' });
        expect.unreachable(`${role} with a read_only token should be refused`);
      } catch (error) {
        expect((error as ApiError).code).toBe('forbidden');
      }
    }

    expect(t.db.select().from(heartbeats).all()).toHaveLength(0);
  });
});

/**
 * Which project a heartbeat belongs to (§4.3, §9.2, LAI-116).
 *
 * LAI-108 chose to let two projects share one repo, so the mapping is
 * one-to-many and every case below is a real arrangement rather than a
 * pathological one.
 */
describe('resolving a repo to projects (LAI-116)', () => {
  /** A project tracking `repo`, created then pointed at it — §4.3's column. */
  function projectTracking(slug: string, prefix: string, repo: string | null): string {
    const project = createProject(t.sqlite, t.db, actor(ownerId), {
      name: slug,
      slug,
      prefix,
    });
    t.db.update(projects).set({ repo }).where(eq(projects.id, project.id)).run();

    return project.id;
  }

  it('resolves nothing when no project tracks the repo', () => {
    projectTracking('laika', 'LAI', 'kvell/laika');

    expect(resolveRepoProjects(t.db, 'someone/else', 'main')).toEqual({
      projectIds: [],
      attribution: 'none',
    });
  });

  it('resolves the one project that tracks it', () => {
    const id = projectTracking('laika', 'LAI', 'kvell/laika');
    projectTracking('other', 'OTH', 'kvell/other');

    expect(resolveRepoProjects(t.db, 'kvell/laika', 'main')).toEqual({
      projectIds: [id],
      attribution: 'repo',
    });
  });

  it('matches case-insensitively, because §4.3 stores what it was given', () => {
    // LAI-108 stores `repo` verbatim, so a project holding `PawanSirsat/Laika`
    // must match a plugin reporting `pawansirsat/laika`. §9.2 already matches
    // branch prefixes case-insensitively — this is that precedent, not a new one.
    const id = projectTracking('laika', 'LAI', 'PawanSirsat/Laika');

    expect(resolveRepoProjects(t.db, 'pawansirsat/laika', 'main').projectIds).toEqual([id]);
    expect(resolveRepoProjects(t.db, '  PAWANSIRSAT/LAIKA  ', 'main').projectIds).toEqual([id]);
  });

  it('ignores a project that tracks no repo at all', () => {
    projectTracking('untracked', 'UNT', null);
    const id = projectTracking('laika', 'LAI', 'kvell/laika');

    expect(resolveRepoProjects(t.db, 'kvell/laika', 'main').projectIds).toEqual([id]);
  });

  it('resolves an empty repo to nothing rather than to everything', () => {
    projectTracking('untracked', 'UNT', null);

    expect(resolveRepoProjects(t.db, '   ', 'main')).toEqual({
      projectIds: [],
      attribution: 'none',
    });
  });

  describe('a monorepo tracked by two projects', () => {
    let frontendId: string;
    let backendId: string;

    beforeEach(() => {
      frontendId = projectTracking('web', 'WEB', 'kvell/mono');
      backendId = projectTracking('api', 'API', 'kvell/mono');
    });

    it('narrows to one when the branch names a project prefix', () => {
      expect(resolveRepoProjects(t.db, 'kvell/mono', 'api-42-add-crud')).toEqual({
        projectIds: [backendId],
        attribution: 'branch',
      });
      expect(resolveRepoProjects(t.db, 'kvell/mono', 'WEB-7-fix-the-header')).toEqual({
        projectIds: [frontendId],
        attribution: 'branch',
      });
    });

    it('narrows through a path-prefixed branch', () => {
      // Half of real branch names look like this; anchoring the parse would
      // silently drop them and fall back to both projects.
      expect(resolveRepoProjects(t.db, 'kvell/mono', 'feature/api-42-add-crud').projectIds).toEqual(
        [backendId],
      );
    });

    it('attributes to both when the branch says nothing', () => {
      // The honest answer: somebody working in a monorepo is present on both,
      // and attributing to nobody would make presence empty for exactly the
      // arrangement LAI-108 went out of its way to permit.
      const result = resolveRepoProjects(t.db, 'kvell/mono', 'main');

      expect(result.projectIds.sort()).toEqual([backendId, frontendId].sort());
      expect(result.attribution).toBe('repo');
    });

    it('attributes to both when the branch names a prefix nobody has', () => {
      const result = resolveRepoProjects(t.db, 'kvell/mono', 'zzz-9-something');

      expect(result.projectIds.sort()).toEqual([backendId, frontendId].sort());
      expect(result.attribution).toBe('repo');
    });

    it('does not error on an unparseable branch — §9.2 degrades', () => {
      for (const branch of ['main', '', '   ', 'no-numbers-here', '///']) {
        expect(() => resolveRepoProjects(t.db, 'kvell/mono', branch)).not.toThrow();
      }
    });
  });

  it('carries the resolution on the recorded heartbeat', () => {
    const id = projectTracking('laika', 'LAI', 'kvell/laika');

    const view = recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
      repo: 'KVELL/LAIKA',
      branch: 'lai-42-x',
      now: 1000,
    });

    expect(view.project_ids).toEqual([id]);
    expect(view.attribution).toBe('repo');
    // Still stored verbatim — resolution reads §4.3, it does not rewrite §4.10.
    expect(view.repo).toBe('KVELL/LAIKA');
  });

  it('still accepts a heartbeat for a repo nobody tracks', () => {
    // §9.2: unmatched input degrades, it never errors.
    const view = recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
      repo: 'someone/else',
      branch: 'main',
      now: 1000,
    });

    expect(view.attribution).toBe('none');
    expect(view.project_ids).toEqual([]);
    expect(t.db.select().from(heartbeats).all()).toHaveLength(1);
  });
});

describe('reading a project prefix off a branch (§9.2)', () => {
  it('reads the convention', () => {
    expect(branchProjectPrefix('lai-42-add-task-crud')).toBe('lai');
    expect(branchProjectPrefix('LAI-42-Add-Task-CRUD')).toBe('lai');
    expect(branchProjectPrefix('lai-42')).toBe('lai');
    expect(branchProjectPrefix('feature/lai-42-x')).toBe('lai');
  });

  it('returns null rather than erroring on anything else', () => {
    for (const branch of ['main', 'develop', '', '   ', 'no-numbers', '42-leading-number']) {
      expect(branchProjectPrefix(branch)).toBeNull();
    }
  });
});

/**
 * A git remote in any form → `owner/name` (§4.3, LAI-144).
 *
 * The plugin documents that it sends "git remote", which is a URL, while §4.3
 * stores `owner/name`. Before this, a correctly configured instance sending
 * exactly what the plugin documents matched nothing at all.
 */
describe('normalising a repo (LAI-144)', () => {
  const CANONICAL = 'PawanSirsat/Laika';

  it('accepts every form git prints for the same repository', () => {
    for (const form of [
      'PawanSirsat/Laika',
      'git@github.com:PawanSirsat/Laika.git',
      'git@github.com:PawanSirsat/Laika',
      'https://github.com/PawanSirsat/Laika.git',
      'https://github.com/PawanSirsat/Laika',
      'https://github.com/PawanSirsat/Laika/',
      'http://github.com/PawanSirsat/Laika',
      'ssh://git@github.com/PawanSirsat/Laika.git',
      'git://github.com/PawanSirsat/Laika.git',
      'https://PawanSirsat@github.com/PawanSirsat/Laika.git',
      '  https://github.com/PawanSirsat/Laika.git  ',
    ]) {
      expect(normaliseRepo(form), form).toBe(CANONICAL);
    }
  });

  it('keeps a nested path, because not every host is owner/name', () => {
    // GitLab subgroups. §4.3 says `owner/name`, but truncating to two segments
    // would merge two genuinely different repositories.
    expect(normaliseRepo('https://gitlab.com/group/subgroup/laika.git')).toBe(
      'group/subgroup/laika',
    );
  });

  it('strips .git only as a suffix, never inside the name', () => {
    expect(normaliseRepo('kvell/gitignore')).toBe('kvell/gitignore');
    expect(normaliseRepo('kvell/legit')).toBe('kvell/legit');

    // The case that matters, and the one every GitHub account has: a global
    // replace turns this into `PawanSirsat/PawanSirsathub.io`.
    expect(normaliseRepo('PawanSirsat/PawanSirsat.github.io')).toBe(
      'PawanSirsat/PawanSirsat.github.io',
    );
    expect(normaliseRepo('git@github.com:PawanSirsat/PawanSirsat.github.io.git')).toBe(
      'PawanSirsat/PawanSirsat.github.io',
    );
  });

  it('a scheme with a host and no path is not a repo (LAI-428)', () => {
    // **The fall-through the ordering was supposed to prevent.** The URL form's
    // path group is optional, so `https://github.com` matched it and captured
    // nothing — and reading "captured nothing" as "did not match" handed the
    // string to the scp form, which read `https` as the host and answered
    // `github.com`.
    //
    // A form that matches has decided. Only the trailing-slash case was tested
    // before, and it passed for the wrong reason: with the slash the URL form
    // captures an empty string rather than `undefined`.
    for (const url of [
      'https://github.com',
      'https://github.com/',
      'ssh://git@host',
      'git://github.com',
      'http://gitlab.example',
    ]) {
      expect(normaliseRepo(url), url).toBeNull();
    }
  });

  it('degrades to null rather than erroring — §9.2', () => {
    for (const junk of ['', '   ', 'https://github.com/', 'git@github.com:', '/', '///', '.git']) {
      expect(normaliseRepo(junk), junk).toBeNull();
    }
  });

  it('leaves something unrecognisable alone rather than inventing structure', () => {
    // Not a URL and not `owner/name`. It still compares equal to an identical
    // stored value, which is the only thing that could reasonably be wanted.
    expect(normaliseRepo('laika')).toBe('laika');
  });
});

describe('a heartbeat sending what the plugin documents (LAI-144)', () => {
  function projectTracking(slug: string, prefix: string, repo: string | null): string {
    const project = createProject(t.sqlite, t.db, actor(ownerId), { name: slug, slug, prefix });
    t.db.update(projects).set({ repo }).where(eq(projects.id, project.id)).run();

    return project.id;
  }

  it('resolves a raw git remote against a project storing owner/name', () => {
    const id = projectTracking('laika', 'LAI', 'PawanSirsat/Laika');

    // This is the case that made §9.3 presence permanently empty.
    for (const remote of [
      'git@github.com:PawanSirsat/Laika.git',
      'https://github.com/PawanSirsat/Laika.git',
      'https://github.com/PawanSirsat/Laika',
    ]) {
      expect(resolveRepoProjects(t.db, remote, 'main').projectIds, remote).toEqual([id]);
    }
  });

  it('normalises the stored side too, so the plugin need not normalise at all', () => {
    // AC4: whichever side normalises, the other has a test proving it does not
    // need to. A project row holding a URL is exactly as likely as a heartbeat
    // carrying one, and normalising one side only is a comparison that
    // disagrees with itself depending on where the URL landed.
    const id = projectTracking('laika', 'LAI', 'https://github.com/PawanSirsat/Laika.git');

    expect(resolveRepoProjects(t.db, 'PawanSirsat/Laika', 'main').projectIds).toEqual([id]);
    expect(
      resolveRepoProjects(t.db, 'git@github.com:pawansirsat/laika', 'main').projectIds,
    ).toEqual([id]);
  });

  it('still narrows a monorepo by branch when both sides are remotes', () => {
    const webId = projectTracking('web', 'WEB', 'git@github.com:kvell/mono.git');
    projectTracking('api', 'API', 'https://github.com/kvell/mono');

    expect(resolveRepoProjects(t.db, 'https://github.com/kvell/mono.git', 'web-7-x')).toEqual({
      projectIds: [webId],
      attribution: 'branch',
    });
  });

  it('does not resolve two different repositories to each other', () => {
    projectTracking('laika', 'LAI', 'PawanSirsat/Laika');
    projectTracking('other', 'OTH', 'someone/Laika');

    // Same name, different owner. Stripping too eagerly would merge them.
    expect(
      resolveRepoProjects(t.db, 'git@github.com:PawanSirsat/Laika.git', 'main').projectIds,
    ).toHaveLength(1);
  });
});

/**
 * A branch resolves to a task (§9.2, LAI-430).
 *
 * `matched_task_id` was nullable and always null: `branchProjectPrefix` extracted
 * the prefix for LAI-116's repo narrowing and stopped there.
 */
describe('resolving a branch to a task (LAI-430)', () => {
  function projectTracking(slug: string, prefix: string, repo: string | null): string {
    const project = createProject(t.sqlite, t.db, actor(ownerId), { name: slug, slug, prefix });
    t.db.update(projects).set({ repo }).where(eq(projects.id, project.id)).run();
    return project.id;
  }

  function taskIn(slug: string, title = 'A task') {
    return createTask(t.sqlite, t.db, actor(ownerId), slug, { title });
  }

  function beat(repo: string, branch: string) {
    return recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), { repo, branch, now: 1000 });
  }

  it('matches the task the branch names', () => {
    projectTracking('laika', 'LAI', 'kvell/laika');
    const task = taskIn('laika');

    expect(beat('kvell/laika', `lai-${task.number}-add-crud`).matched_task_id).toBe(task.id);
  });

  it('is case-insensitive, per §9.2', () => {
    projectTracking('laika', 'LAI', 'kvell/laika');
    const task = taskIn('laika');

    for (const branch of [`lai-${task.number}-x`, `LAI-${task.number}-X`, `Lai-${task.number}-x`]) {
      expect(beat('kvell/laika', branch).matched_task_id, branch).toBe(task.id);
    }
  });

  it('stores the branch on the task, as a last-seen', () => {
    projectTracking('laika', 'LAI', 'kvell/laika');
    const task = taskIn('laika');

    beat('kvell/laika', `lai-${task.number}-first`);
    beat('kvell/laika', `lai-${task.number}-second`);

    // Overwriting is correct — §9.2's `branch` is where the work is *now*. The
    // history is `activity`.
    expect(t.db.select().from(tasks).where(eq(tasks.id, task.id)).get()?.branch).toBe(
      `lai-${task.number}-second`,
    );
  });

  describe('everything unresolvable degrades and never errors (§9.2)', () => {
    beforeEach(() => {
      projectTracking('laika', 'LAI', 'kvell/laika');
      taskIn('laika');
    });

    it('a branch that is not the convention at all', () => {
      for (const branch of ['main', 'develop', 'no-numbers', 'release/2.0', '42-leading']) {
        expect(beat('kvell/laika', branch).matched_task_id, branch).toBeNull();
      }
    });

    it('but a *missing* branch is still a 422, which is a different thing', () => {
      // §9.2's "degrades, it never errors" is about a branch that does not
      // follow the convention. A branch that is not there at all is a malformed
      // request (§6.3, LAI-417) — and conflating the two would turn a client bug
      // into a silent no-op. My first version of the test above included `''`
      // and found this.
      for (const branch of ['', '   ']) {
        expect(() => beat('kvell/laika', branch), JSON.stringify(branch)).toThrow(ApiError);
      }
    });

    it('a prefix no project holds', () => {
      expect(beat('kvell/laika', 'zzz-1-x').matched_task_id).toBeNull();
    });

    it('a number no task has', () => {
      expect(beat('kvell/laika', 'lai-9999-x').matched_task_id).toBeNull();
    });

    it('a repo no project tracks', () => {
      expect(beat('someone/else', 'lai-1-x').matched_task_id).toBeNull();
    });

    it('a number too large to be one', () => {
      // `\d+` is unbounded and a branch is untrusted input.
      expect(beat('kvell/laika', 'lai-99999999999999999999-x').matched_task_id).toBeNull();
    });

    it('writes the heartbeat anyway, every time', () => {
      beat('someone/else', 'nonsense');
      beat('kvell/laika', 'lai-9999-x');

      // Degrading means the row still lands. A heartbeat that errors because the
      // branch was odd would take presence down for a naming convention.
      expect(t.db.select().from(heartbeats).all()).toHaveLength(2);
    });
  });

  describe('the project is decided before the number', () => {
    it('does not resolve LAI-42 to WEB-42', () => {
      // **The case that corrupts data.** Two projects share a repo; the branch
      // names `web`, which narrows to the API project — and the task number
      // exists in *both*. Searching by number first would return the wrong one.
      projectTracking('web', 'WEB', 'kvell/mono');
      projectTracking('api', 'API', 'kvell/mono');
      const webTask = taskIn('web');
      const apiTask = taskIn('api');
      expect(webTask.number).toBe(apiTask.number);

      expect(beat('kvell/mono', `web-${webTask.number}-x`).matched_task_id).toBe(webTask.id);
      expect(beat('kvell/mono', `api-${apiTask.number}-x`).matched_task_id).toBe(apiTask.id);
    });

    it('resolves to nothing when an ambiguous repo is not narrowed', () => {
      projectTracking('web', 'WEB', 'kvell/mono');
      projectTracking('api', 'API', 'kvell/mono');
      const task = taskIn('web');

      // `zzz` narrows nothing, so both projects remain candidates. "Task 1 of
      // whichever sorts first" is worse than no answer.
      expect(beat('kvell/mono', `zzz-${task.number}-x`).matched_task_id).toBeNull();
    });

    it('refuses a prefix the single matching project does not hold', () => {
      // A repo with one project is returned without consulting the branch, so
      // `web-1-x` on a repo tracked only by `LAI` arrives with a project that
      // does not own that prefix. It must not resolve.
      projectTracking('laika', 'LAI', 'kvell/laika');
      const task = taskIn('laika');

      expect(beat('kvell/laika', `web-${task.number}-x`).matched_task_id).toBeNull();
    });
  });

  it('does not resolve when the org has presence_enabled = 0', () => {
    projectTracking('laika', 'LAI', 'kvell/laika');
    const task = taskIn('laika');
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();

    // Resolving would write `matched_task_id` and `tasks.branch` — exactly the
    // record of who was working on what that the switch exists to stop (D-005).
    expect(beat('kvell/laika', `lai-${task.number}-x`).matched_task_id).toBeNull();
    expect(t.db.select().from(tasks).where(eq(tasks.id, task.id)).get()?.branch).toBeNull();
  });
});

/**
 * A disabled org takes no heartbeat at all (§4.2, LAI-150).
 *
 * LAI-430 stopped *resolving* the branch when presence is off, which is the half
 * that would otherwise build the who-was-working-on-what record. This is the
 * other half: §4.2 says the endpoint "accepts and **discards**", and a stored row
 * still carrying user, token, repo and branch is not discarded.
 */
describe('presence_enabled = 0 discards rather than storing (LAI-150)', () => {
  function projectTracking(slug: string, prefix: string, repo: string): string {
    const project = createProject(t.sqlite, t.db, actor(ownerId), { name: slug, slug, prefix });
    t.db.update(projects).set({ repo }).where(eq(projects.id, project.id)).run();
    return project.id;
  }

  function beat(repo = 'kvell/laika', branch = 'lai-1-x') {
    return recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), { repo, branch, now: 1000 });
  }

  beforeEach(() => {
    projectTracking('laika', 'LAI', 'kvell/laika');
    createTask(t.sqlite, t.db, actor(ownerId), 'laika', { title: 'A task' });
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();
  });

  it('writes no row', () => {
    beat();

    // Not "a row with nulls in it" — no row. The metadata a stored row carries
    // is the thing the switch exists to stop collecting.
    expect(t.db.select().from(heartbeats).all()).toEqual([]);
  });

  it('still answers, and the caller cannot tell it was dropped', () => {
    const view = beat();

    // A plugin must not start reporting errors because an org turned a feature
    // off. The view echoes what was sent, unresolved.
    expect(view.repo).toBe('kvell/laika');
    expect(view.matched_task_id).toBeNull();
    expect(view.attribution).toBe('none');
  });

  it('leaves tasks.branch alone', () => {
    const task = t.db.select().from(tasks).get();
    beat('kvell/laika', `lai-${task?.number ?? 1}-x`);

    expect(t.db.select().from(tasks).get()?.branch).toBeNull();
  });

  it('resumes on being turned back on, with no gap to backfill', () => {
    beat();
    expect(t.db.select().from(heartbeats).all()).toEqual([]);

    t.db.update(orgs).set({ presenceEnabled: 1 }).run();
    beat();

    // One row, not two. The rows during the disabled period were never taken,
    // so there is nothing to fill in — which is different from retention
    // (§11.6), where rows existed and were removed.
    expect(t.db.select().from(heartbeats).all()).toHaveLength(1);
  });

  it('still validates the body — disabled is not a bypass', () => {
    // A disabled org must not become a path that accepts anything. The bounds
    // and the required fields are §9.1's, not presence's.
    expect(() => beat('', 'main')).toThrow(ApiError);
    expect(() =>
      recordHeartbeat(t.db, withToken(actor(ownerId), 'full'), {
        repo: 'x'.repeat(REPO_MAX_LENGTH + 1),
        branch: 'main',
      }),
    ).toThrow(ApiError);
  });
});
