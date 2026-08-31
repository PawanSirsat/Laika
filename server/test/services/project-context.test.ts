import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { readPayload } from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, projects, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  addMember,
  CONTEXT_MD_LIMIT,
  createProject,
  getProjectContext,
  updateProject,
  updateProjectContext,
} from '../../src/services/projects.ts';
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
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: '# Architecture' });

    expect(getProjectContext(t.db, actor(viewerId), 'laika').context_md).toBe('# Architecture');
  });

  it('a project member cannot write it', () => {
    const memberId = projectMember('member', 'member');

    try {
      updateProjectContext(t.db, actor(memberId), 'laika', { context_md: 'nope' });
      expect.unreachable('a member is not lead+');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });

  it('a project lead can write it', () => {
    const leadId = projectMember('lead', 'lead');
    const view = updateProjectContext(t.db, actor(leadId), 'laika', { context_md: '# Lead wrote' });

    expect(view.context_md).toBe('# Lead wrote');
  });

  it('an org admin can write it without being a project member', () => {
    // Implicit lead everywhere (§3.2), which is the case a membership-only
    // check would wrongly refuse.
    const adminId = makeUser('admin', 'admin');
    const view = updateProjectContext(t.db, actor(adminId), 'laika', { context_md: '# Admin' });

    expect(view.context_md).toBe('# Admin');
  });

  it('an outsider cannot even read it', () => {
    const outsiderId = makeUser('viewer', 'outsider');

    try {
      getProjectContext(t.db, actor(outsiderId), 'laika');
      expect.unreachable('an org viewer with no membership sees no project');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });
});

describe('the document is returned verbatim (§7.3)', () => {
  it('does not trim, normalise or render', () => {
    // §7.3 calls it a document, not a description field. Leading whitespace is
    // markdown; trailing newlines are a diff; and rendering it here would mean
    // an agent receives HTML where the spec promised markdown.
    const raw = '  # Heading\n\n\n\tindented\n\n';
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: raw });

    expect(getProjectContext(t.db, actor(ownerId), 'laika').context_md).toBe(raw);
  });

  it('reports its length and the limit, so a client can show the budget', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'abcde' });
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
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'kept' });
    const before = t.db.select().from(activity).all().length;

    expect(() =>
      updateProjectContext(t.db, actor(ownerId), 'laika', {
        context_md: 'x'.repeat(CONTEXT_MD_LIMIT + 1),
      }),
    ).toThrowError(ApiError);

    expect(getProjectContext(t.db, actor(ownerId), 'laika').context_md).toBe('kept');
    expect(t.db.select().from(activity).all().length).toBe(before);
  });
});

describe('every edit has a history (§7.3)', () => {
  it('writes exactly one activity row per edit', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'one' });
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'two' });

    const rows = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'project.updated');

    expect(rows).toHaveLength(2);
  });

  it('records what changed, in lengths a reviewer can read', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'abcd' });
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'abcdefghij' });

    const payloads = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'project.updated')
      .map((r) => readPayload(r));

    expect(payloads[0]).toEqual({ changed: ['context_md'], length: 4, previous_length: 0 });
    expect(payloads[1]).toEqual({ changed: ['context_md'], length: 10, previous_length: 4 });
  });

  it('reports who last edited it, and when', () => {
    const leadId = projectMember('lead', 'lead');
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'first', now: 1000 });
    updateProjectContext(t.db, actor(leadId), 'laika', { context_md: 'second', now: 2000 });

    const view = getProjectContext(t.db, actor(ownerId), 'laika');

    expect(view.updated_by).toBe(leadId);
    expect(view.updated_at).toBe(2000);
  });

  it('does not report a project rename as a context edit', () => {
    // `projects.updated_at` moves on any settings change, which is why the
    // view reads the activity row instead. Renaming must leave the document's
    // history alone.
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'c', now: 1000 });
    updateProject(t.db, actor(ownerId), 'laika', { name: 'Renamed', now: 5000 });

    expect(getProjectContext(t.db, actor(ownerId), 'laika').updated_at).toBe(1000);
  });
});

describe('there is exactly one writer of the column (LAI-404 AC6)', () => {
  it('the general project update no longer touches it', () => {
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'kept by its own path' });

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
    updateProjectContext(t.db, actor(ownerId), 'laika', { context_md: 'canonical' });

    const row = t.db.select().from(projects).where(eq(projects.slug, 'laika')).get();
    expect(row?.contextMd).toBe('canonical');
  });
});
