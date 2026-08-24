import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { appendActivity, readPayload } from '../../src/db/activity.ts';
import { activity, comments, orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  addComment,
  createdViaFor,
  deleteComment,
  editComment,
  listComments,
} from '../../src/services/comments.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let adminId: string;
let taskId: string;

function makeUser(orgRole: OrgRole): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
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

/** An org member who belongs to the project, so no implicit lead is in play. */
function projectMember(role: 'member' | 'lead' | 'viewer' = 'member'): string {
  const id = makeUser(role === 'viewer' ? 'viewer' : 'member');
  addMember(t.db, actor(adminId), 'laika', id, role);
  return id;
}

const LIST = { limit: 50, cursor: null, updatedSince: null };

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
  taskId = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Do the thing' }).id;
});
afterEach(() => {
  t.close();
});

describe('adding comments (AC2)', () => {
  it('records the author and the body', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'Looks good to me');

    expect(comment.author_id).toBe(memberId);
    expect(comment.body_md).toBe('Looks good to me');
    expect(comment.edited_at).toBeNull();
  });

  it('sets created_via from how the request arrived', () => {
    const memberId = projectMember();

    // A cookie session is `web`; a token-authenticated caller is an agent (`api`).
    expect(createdViaFor(actor(memberId))).toBe('web');
    expect(createdViaFor({ ...actor(memberId), token: { scope: 'full', projectIds: null } })).toBe(
      'api',
    );
  });

  it('refuses a viewer (§3.2)', () => {
    const viewerId = projectMember('viewer');
    expect(() => addComment(t.db, actor(viewerId), taskId, 'nope')).toThrow(ApiError);
  });

  it('refuses a non-member', () => {
    const outsider = makeUser('member');
    expect(() => addComment(t.db, actor(outsider), taskId, 'nope')).toThrow(ApiError);
  });

  it('404s a task that does not exist', () => {
    expect(() => addComment(t.db, actor(adminId), newId(), 'nope')).toThrow(/No task with id/);
  });
});

describe('editing enforces §3.2', () => {
  it('lets a member edit their own and stamps edited_at', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'first');

    const edited = editComment(t.db, actor(memberId), comment.id, 'second');

    expect(edited.body_md).toBe('second');
    // A UI must be able to say "edited" without comparing timestamps.
    expect(edited.edited_at).not.toBeNull();
  });

  it('refuses a member editing someone else’s', () => {
    const authorId = projectMember();
    const otherId = projectMember();
    const comment = addComment(t.db, actor(authorId), taskId, 'mine');

    expect(() => editComment(t.db, actor(otherId), comment.id, 'hijacked')).toThrow(ApiError);
  });

  it('lets a project lead edit any', () => {
    const authorId = projectMember();
    const leadId = projectMember('lead');
    const comment = addComment(t.db, actor(authorId), taskId, 'mine');

    expect(editComment(t.db, actor(leadId), comment.id, 'moderated').body_md).toBe('moderated');
  });

  it('lets an org admin edit any', () => {
    const authorId = projectMember();
    const comment = addComment(t.db, actor(authorId), taskId, 'mine');

    expect(editComment(t.db, actor(adminId), comment.id, 'moderated').body_md).toBe('moderated');
  });

  it('refuses editing a deleted comment', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'mine');
    deleteComment(t.db, actor(memberId), comment.id);

    expect(() => editComment(t.db, actor(memberId), comment.id, 'back')).toThrow(/been deleted/);
  });
});

describe('deleting is soft, and enforces §3.2 (AC3, AC4)', () => {
  it('keeps the row and sets deleted_at', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'mine');

    deleteComment(t.db, actor(memberId), comment.id);

    const row = t.db.select().from(comments).all();
    expect(row).toHaveLength(1);
    expect(row[0]?.deletedAt).not.toBeNull();
  });

  it('hides it from an ordinary read', () => {
    const memberId = projectMember();
    const kept = addComment(t.db, actor(memberId), taskId, 'kept');
    const gone = addComment(t.db, actor(memberId), taskId, 'gone');
    deleteComment(t.db, actor(memberId), gone.id);

    const visible = listComments(t.db, actor(memberId), taskId, LIST);
    expect(visible.map((r) => r.id)).toEqual([kept.id]);
  });

  it('still reports it to a client catching up with updated_since', () => {
    // Otherwise a client that only ever saw changed rows keeps showing something
    // that was removed (§6.3).
    const memberId = projectMember();
    const gone = addComment(t.db, actor(memberId), taskId, 'gone');
    deleteComment(t.db, actor(memberId), gone.id);

    const catchingUp = listComments(t.db, actor(memberId), taskId, { ...LIST, updatedSince: 0 });
    expect(catchingUp.map((r) => r.id)).toEqual([gone.id]);
    expect(catchingUp[0]?.deletedAt).not.toBeNull();
  });

  it('refuses a member deleting someone else’s', () => {
    const authorId = projectMember();
    const otherId = projectMember();
    const comment = addComment(t.db, actor(authorId), taskId, 'mine');

    expect(() => deleteComment(t.db, actor(otherId), comment.id)).toThrow(ApiError);
  });

  it('lets a lead and an org admin delete any', () => {
    const authorId = projectMember();
    const leadId = projectMember('lead');

    const one = addComment(t.db, actor(authorId), taskId, 'one');
    const two = addComment(t.db, actor(authorId), taskId, 'two');

    expect(() => deleteComment(t.db, actor(leadId), one.id)).not.toThrow();
    expect(() => deleteComment(t.db, actor(adminId), two.id)).not.toThrow();
  });

  it('refuses deleting twice', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'mine');
    deleteComment(t.db, actor(memberId), comment.id);

    expect(() => deleteComment(t.db, actor(memberId), comment.id)).toThrow(/already been deleted/);
  });
});

describe('activity (AC5)', () => {
  it('writes exactly one row per mutation', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'one');
    editComment(t.db, actor(memberId), comment.id, 'two');
    deleteComment(t.db, actor(memberId), comment.id);

    // One row each — not two, not none. Which *verb* each one carries is asserted
    // separately below; LAI-110 changed that from three `comment.added` rows to
    // three distinct verbs, and this assertion is the half that did not change.
    const rows = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => readPayload(r) as Record<string, unknown>)
      .filter((r) => r.comment_id === comment.id);

    expect(rows.map((r) => String(r.action))).toEqual(['created', 'edited', 'deleted']);
  });
});

describe('listing is oldest first', () => {
  it('reads forwards, unlike the activity feed', () => {
    const memberId = projectMember();
    const first = addComment(t.db, actor(memberId), taskId, 'first', 1_000);
    const second = addComment(t.db, actor(memberId), taskId, 'second', 2_000);

    expect(listComments(t.db, actor(memberId), taskId, LIST).map((r) => r.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('refuses a non-member reading', () => {
    const outsider = makeUser('member');
    expect(() => listComments(t.db, actor(outsider), taskId, LIST)).toThrow(ApiError);
  });
});

describe('each mutation gets its own activity verb (LAI-110)', () => {
  /** Activity rows for a comment, oldest first, as `type/action`. */
  function trail(commentId: string): string[] {
    return t.db
      .select()
      .from(activity)
      .all()
      .map((row) => ({ type: row.type, payload: readPayload(row) as Record<string, unknown> }))
      .filter((row) => row.payload.comment_id === commentId)
      .map((row) => `${row.type}/${String(row.payload.action)}`);
  }

  it('writes added, edited and deleted rather than three of the same', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'First');
    editComment(t.db, actor(memberId), comment.id, 'Second');
    deleteComment(t.db, actor(memberId), comment.id);

    // The whole point: filtering `activity` by `type` — the obvious query, and what
    // the indexes on that table are for — now gives the right answer.
    expect(trail(comment.id)).toEqual([
      'comment.added/created',
      'comment.edited/edited',
      'comment.deleted/deleted',
    ]);
  });

  it('keeps the action payload, so pre-LAI-110 history stays readable', () => {
    const memberId = projectMember();
    const comment = addComment(t.db, actor(memberId), taskId, 'First');

    // A row as it was written before the vocabulary grew: the verb says "added"
    // and only the payload says otherwise. It must still be interpretable.
    appendActivity(t.db, {
      orgId: t.db.select().from(orgs).limit(1).get()!.id,
      projectId: null,
      taskId,
      actorId: memberId,
      actorKind: 'user',
      type: 'comment.added',
      payload: { action: 'deleted', comment_id: comment.id },
    });

    const rows = t.db
      .select()
      .from(activity)
      .all()
      .map((row) => readPayload(row) as Record<string, unknown>)
      .filter((row) => row.comment_id === comment.id);

    // Reading "what happened" from the payload works across both eras, which is
    // why the field was kept rather than dropped as redundant.
    expect(rows.map((row) => String(row.action))).toEqual(['created', 'deleted']);
  });

  it('allows both new verbs at the database, not merely in TypeScript', () => {
    // The CHECK constraint is the enforcement (§4.8); migration 0008 rebuilt it.
    const orgId = t.db.select().from(orgs).limit(1).get()!.id;

    for (const type of ['comment.edited', 'comment.deleted'] as const) {
      expect(() =>
        appendActivity(t.db, {
          orgId,
          taskId,
          actorId: adminId,
          actorKind: 'user',
          type,
        }),
      ).not.toThrow();
    }
  });
});
