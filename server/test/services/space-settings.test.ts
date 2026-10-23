import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { heartbeats, meetingReviews, orgs, projects, tasks, tokens } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  parseBranchRef,
  recordHeartbeat,
  resolveBranchTask,
} from '../../src/services/heartbeats.ts';
import { getActivitySharing } from '../../src/services/local-activity.ts';
import { applyMeetingReview, REVIEW_TTL_MS } from '../../src/services/meeting-reviews.ts';
import {
  addMember,
  createProject,
  removeMember,
  updateProject,
} from '../../src/services/projects.ts';
import { createTask, resolveTaskRef } from '../../src/services/tasks.ts';
import { resolveKeys } from '../../src/services/token-usage.ts';
import { logUnlistedWork, promoteUnlisted } from '../../src/services/unlisted.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import { users } from '../../src/db/schema.ts';
import { setUserActive } from '../../src/services/users.ts';

/**
 * LAI-976, below the transport: every place a key is accepted still resolves
 * an old one after a prefix change, and the two per-space rules hold on the
 * paths that are not REST or MCP — the meeting review and the unlisted pile.
 */

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

function owner(): ResolvedActor {
  const loaded = loadActor(t.db, s.userId);
  if (loaded === null) throw new Error('no owner');
  return loaded;
}

function agentOf(actor: ResolvedActor): ResolvedActor {
  return { ...actor, token: { id: 'tok', scope: 'full', projectIds: null } };
}

function makeUser(orgRole: 'member' | 'admin'): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return id;
}

function actorFor(id: string): ResolvedActor {
  const loaded = loadActor(t.db, id);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('old keys resolve after a prefix change, everywhere a key is accepted', () => {
  let first: string;

  beforeEach(() => {
    first = createTask(t.sqlite, t.db, owner(), 'laika', { title: 'First' }).id;
    t.db.update(projects).set({ repo: 'kvell/laika' }).where(eq(projects.id, s.projectId)).run();
    updateProject(t.db, owner(), 'laika', { prefix: 'SKY' });
  });

  it('resolveTaskRef — MCP tools, time entries, meeting reviews', () => {
    for (const ref of ['LAI-1', 'lai-1', 'SKY-1']) {
      expect(resolveTaskRef(t.db, ref, owner()), ref).toBe(first);
    }
    // A number the project never had is still nothing, under either prefix.
    expect(resolveTaskRef(t.db, 'LAI-9', owner())).toBe('LAI-9');
  });

  it('resolveKeys — token usage, time drafts, the Solidtime import', () => {
    const resolved = resolveKeys(t.db, owner(), new Set(['LAI-1', 'SKY-1']));
    expect(resolved.get('LAI-1')?.taskId).toBe(first);
    expect(resolved.get('SKY-1')?.taskId).toBe(first);
  });

  it('resolveBranchTask — heartbeats and the GitHub webhook', () => {
    expect(resolveBranchTask(t.db, 'kvell/laika', 'lai-1-old-branch')?.taskId).toBe(first);
    expect(resolveBranchTask(t.db, 'kvell/laika', 'sky-1-new-branch')?.taskId).toBe(first);
  });

  it('the collector’s key prefixes — local activity counts an old branch', () => {
    t.db.update(orgs).set({ developerInsights: 1 }).run();
    const view = getActivitySharing(t.db, owner(), 'collector-1');
    expect(view.task_prefixes).toEqual(expect.arrayContaining(['LAI', 'SKY']));
  });

  it('a new project may not take the old prefix', () => {
    const error = refusal(() =>
      createProject(t.sqlite, t.db, owner(), { name: 'X', slug: 'x', prefix: 'LAI' }),
    );
    expect(error.code).toBe('conflict');
    expect(error.details).toMatchObject({ field: 'prefix', reason: 'former' });
  });
});

describe('the per-space rules hold on the import paths', () => {
  const NOW = Date.UTC(2026, 9, 22);

  function review(): { id: string; proposalId: string } {
    const proposalId = newId();
    const id = newId();
    t.db
      .insert(meetingReviews)
      .values({
        id,
        projectId: s.projectId,
        source: 'recorder',
        transcriptHash: 'abc',
        proposalsJson: JSON.stringify([
          {
            id: proposalId,
            kind: 'new',
            task: null,
            title: 'From the meeting',
            description: null,
            changes: null,
            reason: null,
            quote: 'said in the meeting',
          },
        ]),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        expiresAt: NOW + REVIEW_TTL_MS,
        createdAt: NOW,
      })
      .run();
    return { id, proposalId };
  }

  it('a meeting review’s new task follows space admins only', () => {
    const memberId = makeUser('member');
    addMember(t.db, owner(), 'laika', memberId, 'member');
    updateProject(t.db, owner(), 'laika', { task_create_min_role: 'lead' });

    const { id, proposalId } = review();
    const error = refusal(() =>
      applyMeetingReview(t.sqlite, t.db, actorFor(memberId), id, {
        accepted_proposal_ids: [proposalId],
        now: NOW,
      }),
    );
    expect(error.code).toBe('forbidden');
    expect(error.details).toMatchObject({ action: 'task.create', reason: 'task_create_min_role' });
  });

  it('a meeting review applied by an agent token is refused when agents are off', () => {
    updateProject(t.db, owner(), 'laika', { agents_allowed: false });
    const { id, proposalId } = review();
    const error = refusal(() =>
      applyMeetingReview(t.sqlite, t.db, agentOf(owner()), id, {
        accepted_proposal_ids: [proposalId],
        now: NOW,
      }),
    );
    expect(error.code).toBe('forbidden');
    expect(error.details).toMatchObject({ reason: 'agents_off' });
  });

  it('promoting unlisted work into the space by an agent token is refused when agents are off', () => {
    const note = logUnlistedWork(t.db, owner(), { repo: 'kvell/elsewhere', note: 'Did a thing' });
    updateProject(t.db, owner(), 'laika', { agents_allowed: false });

    const error = refusal(() =>
      promoteUnlisted(t.sqlite, t.db, agentOf(owner()), note.id, {
        projectSlug: 'laika',
        title: 'Promoted',
      }),
    );
    expect(error.code).toBe('forbidden');
    expect(error.details).toMatchObject({ action: 'task.create', reason: 'agents_off' });

    // The person may.
    expect(
      promoteUnlisted(t.sqlite, t.db, owner(), note.id, { projectSlug: 'laika', title: 'Promoted' })
        .task.title,
    ).toBe('Promoted');
  });

  it('the rules take effect for an actor loaded after the change, not before', () => {
    // `loadActor` reads them, as it reads the grants: a switch flipped after
    // sign-in must not linger in a request that started later.
    updateProject(t.db, owner(), 'laika', { agents_allowed: false });
    expect(owner().projectRules?.get(s.projectId)).toMatchObject({ agentsAllowed: false });
  });
});

/**
 * LAI-976 review: writes that reach a task without a project action. Removing
 * someone from a space asks `project.members.manage` of that space; deactivating
 * them asks `user.deactivate` of the org and then moves their tasks in every
 * space, so the space rule is asked of each one. A heartbeat is the token's own
 * and stores the branch on the task it names.
 */
describe('agents off holds on the writes no project action authorises', () => {
  let leaving: string;
  let held: string;

  beforeEach(() => {
    leaving = makeUser('member');
    addMember(t.db, owner(), 'laika', leaving, 'member');
    held = createTask(t.sqlite, t.db, owner(), 'laika', { title: 'Held', assignee_id: leaving }).id;
    updateProject(t.db, owner(), 'laika', { agents_allowed: false });
  });

  function assigneeOf(id: string): string | null {
    return t.db.select().from(tasks).where(eq(tasks.id, id)).get()!.assigneeId;
  }

  function isActive(id: string): number {
    return t.db.select().from(users).where(eq(users.id, id)).get()!.isActive;
  }

  it('refuses an agent token deactivating someone who holds a task there, and changes nothing', () => {
    for (const choice of ['unassign', { reassign_to: s.userId }] as const) {
      const error = refusal(() =>
        setUserActive(t.db, agentOf(owner()), leaving, false, Date.now(), choice),
      );
      expect(error.code).toBe('forbidden');
      expect(error.details).toMatchObject({ action: 'task.write', reason: 'agents_off' });
      expect(assigneeOf(held)).toBe(leaving);
      expect(isActive(leaving)).toBe(1);
    }
  });

  it('lets the same person do it from a session, and the token once agents are on', () => {
    updateProject(t.db, owner(), 'laika', { agents_allowed: true });
    setUserActive(t.db, agentOf(owner()), leaving, false, Date.now(), 'unassign');
    expect(assigneeOf(held)).toBeNull();
    expect(isActive(leaving)).toBe(0);
  });

  it('a person on a session is not touched by the switch', () => {
    setUserActive(t.db, owner(), leaving, false, Date.now(), 'unassign');
    expect(assigneeOf(held)).toBeNull();
    expect(isActive(leaving)).toBe(0);
  });

  it('refuses an agent token removing someone from the space', () => {
    const error = refusal(() =>
      removeMember(t.db, agentOf(owner()), 'laika', leaving, Date.now(), 'unassign'),
    );
    expect(error.code).toBe('forbidden');
    expect(error.details).toMatchObject({ reason: 'agents_off' });
    expect(assigneeOf(held)).toBe(leaving);
  });

  /** A token row the heartbeat can reference — `heartbeats.token_id` is a foreign key. */
  function storedAgent(): ResolvedActor {
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId: s.userId,
        name: 'agent',
        prefix: 'lai_test',
        tokenHash: `${id}-hash`,
        scope: 'full',
        projectIdsJson: null,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: Date.now(),
      })
      .run();
    return { ...owner(), token: { id, scope: 'full', projectIds: null } };
  }

  it('records an agent’s heartbeat but keeps its branch off the task', () => {
    t.db.update(projects).set({ repo: 'kvell/laika' }).where(eq(projects.id, s.projectId)).run();
    const beat = recordHeartbeat(t.db, storedAgent(), {
      repo: 'kvell/laika',
      branch: 'lai-1-agent-branch',
      now: 1000,
    });
    expect(beat.matched_task_id).toBe(held);
    expect(t.db.select().from(heartbeats).where(eq(heartbeats.id, beat.id)).get()).toBeDefined();
    expect(t.db.select().from(tasks).where(eq(tasks.id, held)).get()!.branch).toBeNull();

    updateProject(t.db, owner(), 'laika', { agents_allowed: true });
    recordHeartbeat(t.db, storedAgent(), {
      repo: 'kvell/laika',
      branch: 'lai-1-agent-branch',
      now: 2000,
    });
    expect(t.db.select().from(tasks).where(eq(tasks.id, held)).get()!.branch).toBe(
      'lai-1-agent-branch',
    );
  });
});

/**
 * LAI-177, absorbed by the LAI-976 review: the branch parser reads every
 * prefix §4.3 accepts — a letter, then one to seven letters or digits — and a
 * digit never splits one, so an alias with a digit resolves like any other.
 */
describe('branch names carrying a prefix with a digit (LAI-177)', () => {
  it('parses the prefix whole', () => {
    expect(parseBranchRef('web2-1-fix')).toEqual({ prefix: 'web2', number: 1 });
    expect(parseBranchRef('p0x-12-fix')).toEqual({ prefix: 'p0x', number: 12 });
    expect(parseBranchRef('feature/P0X-12-fix')).toEqual({ prefix: 'p0x', number: 12 });
    expect(parseBranchRef('A1B2C3D4-7')).toEqual({ prefix: 'a1b2c3d4', number: 7 });
    // Unchanged for a branch that only looks like a key.
    expect(parseBranchRef('add-2fa-support')).toEqual({ prefix: 'add', number: 2 });
  });

  it('never reads part of a word as a prefix', () => {
    // A tail of a longer token is not a key: `X` is not `P0X`, and nine
    // characters is longer than any prefix may be.
    for (const branch of ['p0x', 'x-12', 'abcdefghi-3', '0x-12', 'main']) {
      expect(parseBranchRef(branch)?.prefix ?? null, branch).not.toBe('x');
    }
    expect(parseBranchRef('abcdefghi-3')).toBeNull();
    expect(parseBranchRef('0x-12')).toBeNull();
  });

  it('resolves current and former digit prefixes to the task', () => {
    t.db.update(projects).set({ repo: 'kvell/laika' }).where(eq(projects.id, s.projectId)).run();
    let twelfth = '';
    for (let n = 1; n <= 12; n += 1) {
      twelfth = createTask(t.sqlite, t.db, owner(), 'laika', { title: `T${String(n)}` }).id;
    }
    const first = resolveBranchTask(t.db, 'kvell/laika', 'lai-1-x')!.taskId;

    updateProject(t.db, owner(), 'laika', { prefix: 'WEB2' });
    expect(resolveBranchTask(t.db, 'kvell/laika', 'web2-1-fix')?.taskId).toBe(first);

    updateProject(t.db, owner(), 'laika', { prefix: 'P0X' });
    // Current.
    expect(resolveBranchTask(t.db, 'kvell/laika', 'p0x-12-fix')?.taskId).toBe(twelfth);
    // Former, digit and letters-only.
    expect(resolveBranchTask(t.db, 'kvell/laika', 'web2-1-fix')?.taskId).toBe(first);
    expect(resolveBranchTask(t.db, 'kvell/laika', 'lai-12-x')?.taskId).toBe(twelfth);
  });

  it('narrows a shared repo by a digit prefix', () => {
    t.db.update(projects).set({ repo: 'kvell/mono' }).where(eq(projects.id, s.projectId)).run();
    const other = createProject(t.sqlite, t.db, owner(), { name: 'W', slug: 'w', prefix: 'WEB2' });
    t.db.update(projects).set({ repo: 'kvell/mono' }).where(eq(projects.id, other.id)).run();
    const task = createTask(t.sqlite, t.db, owner(), 'w', { title: 'In WEB2' });

    expect(resolveBranchTask(t.db, 'kvell/mono', 'web2-1-fix')).toEqual({
      taskId: task.id,
      projectId: other.id,
    });
  });
});
