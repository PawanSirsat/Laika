import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { readPayload } from '../../src/db/activity.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, unlistedWork, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createProject } from '../../src/services/projects.ts';
import { dismissUnlisted, listUnlisted, promoteUnlisted } from '../../src/services/unlisted.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Unlisted work — the humans' side of `log_unlisted_work` (§4.14, D-024).
 *
 * Writing a row is LAI-408's tool, so the fixture inserts them directly. That is
 * the task's own instruction and it keeps this file about triage.
 */

let t: TestDb;
let ownerId: string;
let orgId: string;

const LIST = { limit: 50, cursor: null };

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

/** A logged note. LAI-408's tool will write these; here the fixture does. */
function note(overrides: Partial<typeof unlistedWork.$inferInsert> = {}): string {
  const id = newId();
  t.db
    .insert(unlistedWork)
    .values({
      id,
      userId: ownerId,
      tokenId: null,
      repo: 'kvell/laika',
      note: 'The deploy script assumes bash 5',
      promotedTaskId: null,
      dismissedAt: null,
      createdAt: Date.now(),
      ...overrides,
    })
    .run();
  return id;
}

function unlistedActivity(): Record<string, unknown>[] {
  return (
    t.db
      .select()
      .from(activity)
      .all()
      // Every `unlisted.*` verb — logged, promoted and dismissed since LAI-113.
      .filter((r) => r.type.startsWith('unlisted.'))
      .map((r) => readPayload(r) as Record<string, unknown>)
  );
}

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('owner', 'owner');
  orgId = newId();
  const now = Date.now();
  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, actor(ownerId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});

afterEach(() => {
  t.close();
});

describe('reading the pile is org-level (§3.1 Export audit log)', () => {
  it('an owner sees it', () => {
    note();
    expect(listUnlisted(t.db, actor(ownerId), LIST)).toHaveLength(1);
  });

  it('an admin sees it', () => {
    note();
    const adminId = makeUser('admin', 'admin');
    expect(listUnlisted(t.db, actor(adminId), LIST)).toHaveLength(1);
  });

  it('a member does not', () => {
    note();
    const memberId = makeUser('member', 'member');

    try {
      listUnlisted(t.db, actor(memberId), LIST);
      expect.unreachable('the audit-log cell is Owner and Admin only');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }
  });

  it('a viewer does not', () => {
    note();
    const viewerId = makeUser('viewer', 'viewer');

    expect(() => listUnlisted(t.db, actor(viewerId), LIST)).toThrowError(ApiError);
  });
});

describe('filters', () => {
  it('narrows to one person', () => {
    const otherId = makeUser('member', 'other');
    note();
    note({ userId: otherId, note: 'theirs' });

    const mine = listUnlisted(t.db, actor(ownerId), { ...LIST, userId: ownerId });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.user_id).toBe(ownerId);
  });

  it('narrows by time, inclusively', () => {
    note({ createdAt: 1000 });
    note({ createdAt: 2000, note: 'newer' });

    expect(listUnlisted(t.db, actor(ownerId), { ...LIST, since: 2000 })).toHaveLength(1);
    // Inclusive, matching §6.3's `updated_since` semantic rather than inventing
    // a different one for this endpoint.
    expect(listUnlisted(t.db, actor(ownerId), { ...LIST, since: 1000 })).toHaveLength(2);
  });

  it('returns newest first', () => {
    note({ createdAt: 1000, note: 'older' });
    note({ createdAt: 2000, note: 'newer' });

    expect(listUnlisted(t.db, actor(ownerId), LIST).map((r) => r.note)).toEqual(['newer', 'older']);
  });

  it('leaves dismissed rows out by default and returns them on request', () => {
    const id = note();
    dismissUnlisted(t.db, actor(ownerId), id);

    expect(listUnlisted(t.db, actor(ownerId), LIST)).toHaveLength(0);
    expect(listUnlisted(t.db, actor(ownerId), { ...LIST, includeDismissed: true })).toHaveLength(1);
  });
});

describe('promote', () => {
  it('creates a real task through the tasks service and links the row', () => {
    const id = note();

    const { task, unlisted } = promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, {
      projectSlug: 'laika',
      title: 'Pin the deploy script to bash 5',
    });

    // A real task: numbered by the tasks service, so it has a display key.
    expect(task.key).toBe('LAI-1');
    expect(task.title).toBe('Pin the deploy script to bash 5');
    expect(unlisted.promoted_task_id).toBe(task.id);
  });

  it('preserves the agent provenance §4.14 asks for', () => {
    const id = note();
    const { task } = promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, {
      projectSlug: 'laika',
      title: 'From an agent',
    });

    // Not `web`. A person triaged it, but an agent noticed it, and the task
    // should say where the work came from.
    expect(task.created_via).toBe('mcp');
  });

  it('keeps the note as the task body', () => {
    const id = note();
    const { task } = promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, {
      projectSlug: 'laika',
      title: 'Short title',
    });

    // The agent's sentence is the only record of *why* this was worth noticing.
    expect(task.description_md).toContain('The deploy script assumes bash 5');
    expect(task.description_md).toContain('kvell/laika');
  });

  it('refuses a second promote with 409 and creates no second task', () => {
    const id = note();
    promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, {
      projectSlug: 'laika',
      title: 'First',
    });

    try {
      promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, {
        projectSlug: 'laika',
        title: 'Second',
      });
      expect.unreachable('already promoted');
    } catch (error) {
      expect((error as ApiError).code).toBe('conflict');
    }

    // The check runs before the task is created, so there is no orphan.
    expect(unlistedActivity().filter((p) => p.action === 'promoted')).toHaveLength(1);
  });

  it('refuses someone who cannot read the pile at all', () => {
    const id = note();
    const memberId = makeUser('member', 'member');

    expect(() =>
      promoteUnlisted(t.sqlite, t.db, actor(memberId), id, {
        projectSlug: 'laika',
        title: 'Nope',
      }),
    ).toThrowError(ApiError);

    expect(
      t.db.select().from(unlistedWork).where(eq(unlistedWork.id, id)).get()?.promotedTaskId,
    ).toBeNull();
  });

  it('needs task.write in the named project, not just audit access', () => {
    // **The two-check property, isolated.**
    //
    // By role alone the two cannot be separated: `audit_log.export` is Owner and
    // Admin, and both hold implicit lead on every project (`can.ts` line 95), so
    // anyone passing the first check passes the second. A test using roles would
    // pass whether or not the second check existed.
    //
    // A **token-narrowed** actor does separate them, and is a real case since
    // LAI-402: `audit_log.export` carries no `projectId` so the whitelist does
    // not apply, while `task.write` carries one and is refused.
    const id = note();
    createProject(t.sqlite, t.db, actor(ownerId), {
      name: 'Other',
      slug: 'other',
      prefix: 'OTH',
    });

    const scoped: ResolvedActor = {
      ...actor(ownerId),
      token: { id: 'tok', scope: 'full', projectIds: ['some-other-project-id'] },
    };

    // Reading the pile still works — the first gate is org-scoped.
    expect(listUnlisted(t.db, scoped, LIST)).toHaveLength(1);

    // Promoting into a project outside the token's whitelist does not.
    try {
      promoteUnlisted(t.sqlite, t.db, scoped, id, { projectSlug: 'laika', title: 'Out of scope' });
      expect.unreachable('the token is not scoped to that project');
    } catch (error) {
      expect((error as ApiError).code).toBe('forbidden');
    }

    expect(
      t.db.select().from(unlistedWork).where(eq(unlistedWork.id, id)).get()?.promotedTaskId,
    ).toBeNull();
  });

  it('refuses to promote something already dismissed', () => {
    const id = note();
    dismissUnlisted(t.db, actor(ownerId), id);

    try {
      promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, {
        projectSlug: 'laika',
        title: 'Revived',
      });
      expect.unreachable('dismissed');
    } catch (error) {
      expect((error as ApiError).code).toBe('conflict');
    }
  });

  it('404s a note that does not exist', () => {
    try {
      promoteUnlisted(t.sqlite, t.db, actor(ownerId), 'nope', {
        projectSlug: 'laika',
        title: 'x',
      });
      expect.unreachable('no such note');
    } catch (error) {
      expect((error as ApiError).code).toBe('not_found');
    }
  });
});

describe('dismiss', () => {
  it('sets dismissed_at and is idempotent', () => {
    const id = note();

    const first = dismissUnlisted(t.db, actor(ownerId), id, 1000);
    expect(first.dismissed_at).toBe(1000);

    // Second call: no throw, original timestamp stands.
    const second = dismissUnlisted(t.db, actor(ownerId), id, 2000);
    expect(second.dismissed_at).toBe(1000);
  });

  it('writes one activity row however many times it is called', () => {
    const id = note();
    dismissUnlisted(t.db, actor(ownerId), id);
    dismissUnlisted(t.db, actor(ownerId), id);
    dismissUnlisted(t.db, actor(ownerId), id);

    expect(unlistedActivity().filter((p) => p.action === 'dismissed')).toHaveLength(1);
  });

  it('refuses to dismiss something already promoted', () => {
    const id = note();
    promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, { projectSlug: 'laika', title: 'Real' });

    try {
      dismissUnlisted(t.db, actor(ownerId), id);
      expect.unreachable('promoted');
    } catch (error) {
      expect((error as ApiError).code).toBe('conflict');
    }
  });
});

describe('the audit trail (§4.8)', () => {
  it('writes exactly one org-scoped row per promote', () => {
    const id = note();
    promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, { projectSlug: 'laika', title: 'T' });

    const rows = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'unlisted.promoted');

    expect(rows).toHaveLength(1);
    // The pile belongs to no project even when what it becomes does.
    expect(rows[0]?.projectId).toBeNull();
    expect(rows[0]?.actorId).toBe(ownerId);
  });

  it('does not write the task.created row twice', () => {
    const id = note();
    promoteUnlisted(t.sqlite, t.db, actor(ownerId), id, { projectSlug: 'laika', title: 'T' });

    // The tasks service writes it; promote must not add its own.
    const created = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'task.created');

    expect(created).toHaveLength(1);
  });

  it('names the action, since one verb covers both', () => {
    const promoted = note();
    const dismissed = note();
    promoteUnlisted(t.sqlite, t.db, actor(ownerId), promoted, {
      projectSlug: 'laika',
      title: 'T',
    });
    dismissUnlisted(t.db, actor(ownerId), dismissed);

    expect(
      unlistedActivity()
        .map((p) => p.action)
        .sort(),
    ).toEqual(['dismissed', 'promoted']);
  });
});
