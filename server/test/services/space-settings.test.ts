import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { meetingReviews, orgs, projects } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { resolveBranchTask } from '../../src/services/heartbeats.ts';
import { getActivitySharing } from '../../src/services/local-activity.ts';
import { applyMeetingReview, REVIEW_TTL_MS } from '../../src/services/meeting-reviews.ts';
import { addMember, createProject, updateProject } from '../../src/services/projects.ts';
import { createTask, resolveTaskRef } from '../../src/services/tasks.ts';
import { resolveKeys } from '../../src/services/token-usage.ts';
import { logUnlistedWork, promoteUnlisted } from '../../src/services/unlisted.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import { users } from '../../src/db/schema.ts';

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
