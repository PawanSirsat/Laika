import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { readPayload } from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, projectContextRevisions, projects, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  addMember,
  CONTEXT_MD_LIMIT,
  createProject,
  getProjectContext,
  reviseProjectContext,
  updateProject,
  updateProjectContext,
} from '../../src/services/projects.ts';
import {
  diffProjectContext,
  getContextRevision,
  listContextRevisions,
} from '../../src/services/context-revisions.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The shared project context document (SPEC §7.3, LAI-404).
 *
 * §3.1's cell is "Edit project settings **and `context_md`**" — one row
 * governing both — so the permission is `project.settings.edit` and reading
 * follows project read. The tests below are that sentence, role by role.
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
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

/** The project's revision as stored — what a caller that just read it would name. */
function currentRevision(): number {
  return t.db.select().from(projects).where(eq(projects.slug, 'laika')).get()!.contextRevision;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

/** An org member holding a specific role on the project. */
function projectMember(role: 'lead' | 'member' | 'viewer', label: string): string {
  const id = makeUser(role === 'viewer' ? 'viewer' : 'member', label);
  addMember(t.db, actor(ownerId), 'laika', id, role);
  return id;
}

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('owner', 'owner');
  const now = Date.now();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, actor(ownerId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});

afterEach(() => {
  t.close();
});

describe('who may read and write it (§3.1, §7.3)', () => {
  it('a project viewer can read it', () => {
    const viewerId = projectMember('viewer', 'viewer');
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: '# Architecture',
    });

    expect(getProjectContext(t.db, actor(viewerId), 'laika').context_md).toBe('# Architecture');
  });

  it('a project member cannot write it', () => {
    const memberId = projectMember('member', 'member');

    try {
      updateProjectContext(t.db, actor(memberId), 'laika', {
        base_revision: currentRevision(),
        context_md: 'nope',
      });
      expect.unreachable('a member is not lead+');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });

  it('a project lead can write it', () => {
    const leadId = projectMember('lead', 'lead');
    const view = updateProjectContext(t.db, actor(leadId), 'laika', {
      base_revision: currentRevision(),
      context_md: '# Lead wrote',
    });

    expect(view.context_md).toBe('# Lead wrote');
  });

  it('an org admin can write it without being a project member', () => {
    // Implicit lead everywhere (§3.2), which is the case a membership-only
    // check would wrongly refuse.
    const adminId = makeUser('admin', 'admin');
    const view = updateProjectContext(t.db, actor(adminId), 'laika', {
      base_revision: currentRevision(),
      context_md: '# Admin',
    });

    expect(view.context_md).toBe('# Admin');
  });

  it('an outsider cannot even read it', () => {
    const outsiderId = makeUser('viewer', 'outsider');

    try {
      getProjectContext(t.db, actor(outsiderId), 'laika');
      expect.unreachable('an org viewer with no membership sees no project');
    } catch (error) {
      // The same answer as a slug that names nothing (LAI-555): the brief must
      // not confirm a project exists to someone who cannot see it.
      expect((error as ApiError).code).toBe('not_found');
      expect((error as ApiError).message).toBe('No project with slug "laika"');
    }
  });
});

describe('the document is returned verbatim (§7.3)', () => {
  it('does not trim, normalise or render', () => {
    // §7.3 calls it a document, not a description field. Leading whitespace is
    // markdown; trailing newlines are a diff; and rendering it here would mean
    // an agent receives HTML where the spec promised markdown.
    const raw = '  # Heading\n\n\n\tindented\n\n';
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: raw,
    });

    expect(getProjectContext(t.db, actor(ownerId), 'laika').context_md).toBe(raw);
  });

  it('reports its length and the limit, so a client can show the budget', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'abcde',
    });
    const view = getProjectContext(t.db, actor(ownerId), 'laika');

    expect(view.length).toBe(5);
    expect(view.limit).toBe(CONTEXT_MD_LIMIT);
  });

  it('starts empty, with no recorded edit', () => {
    const view = getProjectContext(t.db, actor(ownerId), 'laika');

    expect(view.context_md).toBe('');
    // Null rather than the project's `created_at`: nothing has edited the
    // document, and saying otherwise would invent a history.
    expect(view.updated_at).toBeNull();
    expect(view.updated_by).toBeNull();
  });
});

describe('the size bound (§7.3, §14 q7)', () => {
  it('accepts exactly the limit', () => {
    const view = updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'x'.repeat(CONTEXT_MD_LIMIT),
    });

    expect(view.length).toBe(CONTEXT_MD_LIMIT);
  });

  it('refuses one character more, naming the limit and the actual length', () => {
    // "Silently blows an agent's context window is worse than no document", so
    // it must not silently anything — and a caller told only "too long" has to
    // guess how much to cut.
    try {
      updateProjectContext(t.db, actor(ownerId), 'laika', {
        base_revision: currentRevision(),
        context_md: 'x'.repeat(CONTEXT_MD_LIMIT + 1),
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const api = error as ApiError;
      expect(api.code).toBe('unprocessable');
      expect(api.details).toEqual({ limit: CONTEXT_MD_LIMIT, length: CONTEXT_MD_LIMIT + 1 });
    }
  });

  it('writes nothing when it refuses', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'kept',
    });
    const before = t.db.select().from(activity).all().length;

    expect(() =>
      updateProjectContext(t.db, actor(ownerId), 'laika', {
        base_revision: currentRevision(),
        context_md: 'x'.repeat(CONTEXT_MD_LIMIT + 1),
      }),
    ).toThrowError(ApiError);

    expect(getProjectContext(t.db, actor(ownerId), 'laika').context_md).toBe('kept');
    expect(t.db.select().from(activity).all().length).toBe(before);
  });
});

describe('every edit has a history (§7.3)', () => {
  it('writes exactly one activity row per edit', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'one',
    });
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'two',
    });

    const rows = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'project.context_updated');

    expect(rows).toHaveLength(2);
  });

  it('records what changed, in lengths a reviewer can read', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'abcd',
    });
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'abcdefghij',
    });

    const payloads = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'project.context_updated')
      .map((r) => readPayload(r));

    expect(payloads[0]).toEqual({
      changed: ['context_md'],
      length: 4,
      previous_length: 0,
      revision: 1,
    });
    expect(payloads[1]).toEqual({
      changed: ['context_md'],
      length: 10,
      previous_length: 4,
      revision: 2,
    });
  });

  it('reports who last edited it, and when', () => {
    const leadId = projectMember('lead', 'lead');
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'first',
      now: 1000,
    });
    updateProjectContext(t.db, actor(leadId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'second',
      now: 2000,
    });

    const view = getProjectContext(t.db, actor(ownerId), 'laika');

    expect(view.updated_by).toBe(leadId);
    expect(view.updated_at).toBe(2000);
  });

  it('does not report a project rename as a context edit', () => {
    // `projects.updated_at` moves on any settings change, which is why the
    // view reads the activity row instead. Renaming must leave the document's
    // history alone.
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'c',
      now: 1000,
    });
    updateProject(t.db, actor(ownerId), 'laika', { name: 'Renamed', now: 5000 });

    expect(getProjectContext(t.db, actor(ownerId), 'laika').updated_at).toBe(1000);
  });
});

describe('there is exactly one writer of the column (LAI-404 AC6)', () => {
  it('the general project update no longer touches it', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'kept by its own path',
    });

    // A rename must not clear or rewrite the document. Before LAI-404 both
    // paths wrote the column; leaving both would have meant two places
    // enforcing the size bound and two shapes of audit row.
    updateProject(t.db, actor(ownerId), 'laika', { name: 'Renamed' });

    expect(getProjectContext(t.db, actor(ownerId), 'laika').context_md).toBe(
      'kept by its own path',
    );
  });

  it('the column is only ever written through the context service', () => {
    // Structural, so it survives someone adding `context_md` back to
    // `UpdateProjectInput`: the project row's column must equal what the
    // context endpoint last set.
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      base_revision: currentRevision(),
      context_md: 'canonical',
    });

    const row = t.db.select().from(projects).where(eq(projects.slug, 'laika')).get();
    expect(row?.contextMd).toBe('canonical');
  });
});

describe('revisions (§4.68, proposal §4.6, LAI-555)', () => {
  it('every write makes the next revision, and the view carries it', () => {
    expect(getProjectContext(t.db, actor(ownerId), 'laika').revision).toBe(0);

    const first = updateProjectContext(t.db, actor(ownerId), 'laika', {
      context_md: 'one',
      base_revision: 0,
    });
    const second = updateProjectContext(t.db, actor(ownerId), 'laika', {
      context_md: 'two',
      base_revision: 1,
    });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(listContextRevisions(t.db, actor(ownerId), 'laika').map((r) => r.revision)).toEqual([
      2, 1,
    ]);
    expect(getContextRevision(t.db, actor(ownerId), 'laika', 1).body).toBe('one');
  });

  it('a write against an old revision is refused 409 and changes nothing', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'one', base_revision: 0 });
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'two', base_revision: 1 });
    const activityBefore = t.db.select().from(activity).all().length;

    try {
      updateProjectContext(t.db, actor(ownerId), 'laika', {
        context_md: 'clobber',
        base_revision: 1,
      });
      expect.unreachable('revision 1 is not current');
    } catch (error) {
      const api = error as ApiError;
      expect(api.code).toBe('conflict');
      expect(api.details).toEqual({
        reason: 'stale_context_revision',
        base_revision: 1,
        current_revision: 2,
      });
    }

    const view = getProjectContext(t.db, actor(ownerId), 'laika');
    expect(view.revision).toBe(2);
    expect(view.context_md).toBe('two');
    expect(t.db.select().from(projectContextRevisions).all()).toHaveLength(2);
    expect(t.db.select().from(activity).all()).toHaveLength(activityBefore);
  });

  it('a base revision ahead of the current one is refused too', () => {
    expect(() =>
      updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'x', base_revision: 5 }),
    ).toThrowError(/revision 0, not 5/);
  });

  it('an append computed inside the write cannot lose a concurrent one', () => {
    // Two appends that both read revision 0 before either wrote: the old
    // read-then-write lost one. Computed inside the write, both land.
    reviseProjectContext(t.db, actor(ownerId), 'laika', {
      baseRevision: null,
      next: (current) => `${current}A`,
    });
    reviseProjectContext(t.db, actor(ownerId), 'laika', {
      baseRevision: null,
      next: (current) => `${current}B`,
    });

    const view = getProjectContext(t.db, actor(ownerId), 'laika');
    expect(view.context_md).toBe('AB');
    expect(view.revision).toBe(2);
  });

  it('records the author and, for an agent, nothing it does not know', () => {
    const leadId = projectMember('lead', 'lead');
    updateProjectContext(t.db, actor(leadId), 'laika', { context_md: 'x', base_revision: 0 });

    const [row] = listContextRevisions(t.db, actor(ownerId), 'laika');
    expect(row?.author_id).toBe(leadId);
    expect(row?.agent_id).toBeNull();
  });

  it('a revision row is immutable: UPDATE and DELETE are refused by the database', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'one', base_revision: 0 });

    expect(() =>
      t.db.update(projectContextRevisions).set({ body: 'rewritten' }).run(),
    ).toThrowError(/append-only: UPDATE/);
    expect(() => t.db.delete(projectContextRevisions).run()).toThrowError(/append-only: DELETE/);
    expect(getContextRevision(t.db, actor(ownerId), 'laika', 1).body).toBe('one');
  });

  it('diffs two revisions, and from 0, without sending the whole document', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      context_md: 'a\nb\nc',
      base_revision: 0,
    });
    updateProjectContext(t.db, actor(ownerId), 'laika', {
      context_md: 'a\nB\nc\nd',
      base_revision: 1,
    });

    const diff = diffProjectContext(t.db, actor(ownerId), 'laika', 1);
    expect(diff).toMatchObject({ from_revision: 1, to_revision: 2, current_revision: 2 });
    expect(diff.diff).toBe('@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d');
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);

    expect(diffProjectContext(t.db, actor(ownerId), 'laika', 2).diff).toBe('');
    expect(diffProjectContext(t.db, actor(ownerId), 'laika', 0, 1).added).toBe(3);
  });

  it('a revision the project has not reached is 404; a backwards diff is 422', () => {
    expect(() => getContextRevision(t.db, actor(ownerId), 'laika', 3)).toThrowError(
      /No context revision 3/,
    );
    expect(() => diffProjectContext(t.db, actor(ownerId), 'laika', 0, 3)).toThrowError(
      /No context revision 3/,
    );
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'x', base_revision: 0 });
    expect(() => diffProjectContext(t.db, actor(ownerId), 'laika', 1, 0)).toThrowError(
      /must not be after/,
    );
  });

  it('the history follows project read: a viewer sees it, an outsider is refused', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'x', base_revision: 0 });
    const viewerId = projectMember('viewer', 'viewer');
    const outsiderId = makeUser('viewer', 'outsider');

    expect(listContextRevisions(t.db, actor(viewerId), 'laika')).toHaveLength(1);
    for (const read of [
      () => listContextRevisions(t.db, actor(outsiderId), 'laika'),
      () => getContextRevision(t.db, actor(outsiderId), 'laika', 1),
      () => diffProjectContext(t.db, actor(outsiderId), 'laika', 0),
    ]) {
      expect(read).toThrowError(ApiError);
    }
  });
});
