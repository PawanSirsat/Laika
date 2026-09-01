import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { commentMentions, orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  mentionedUserIds,
  parseMentionHandles,
  mentionableUsers,
  resolveMentions,
} from '../../src/services/mentions.ts';
import { addComment, deleteComment, editComment } from '../../src/services/comments.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let adminId: string;
let taskId: string;
let projectId: string;

function makeUser(email: string, orgRole: OrgRole = 'member'): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email,
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

/** In the org, in the project — the ordinary case. */
function member(email: string): string {
  const id = makeUser(email);
  addMember(t.db, actor(adminId), 'laika', id, 'member');
  return id;
}

function mentionRows(commentId: string): string[] {
  return t.db
    .select({ userId: commentMentions.userId })
    .from(commentMentions)
    .where(eq(commentMentions.commentId, commentId))
    .all()
    .map((r) => r.userId)
    .sort();
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin@example.test', 'admin');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();
  const project = createProject(t.sqlite, t.db, actor(adminId), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  });
  projectId = project.id;
  taskId = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Do the thing' }).id;
});
afterEach(() => {
  t.close();
});

describe('parsing a body (AC4)', () => {
  it('finds a mention at the start, mid-sentence and inside punctuation', () => {
    expect(parseMentionHandles('@ada ping')).toEqual(['ada']);
    expect(parseMentionHandles('cc @ada please')).toEqual(['ada']);
    expect(parseMentionHandles('(@ada) and **@grace**')).toEqual(['ada', 'grace']);
  });

  it('does not read an email address as a mention', () => {
    // The character before `@` can appear in an address, so this is one address,
    // not a mention of `example.test`.
    expect(parseMentionHandles('write to ada@example.test')).toEqual([]);
    expect(parseMentionHandles('ada.lovelace+work@example.test')).toEqual([]);
  });

  it('stops at trailing punctuation but keeps an internal dot', () => {
    expect(parseMentionHandles('thanks @ada.lovelace.')).toEqual(['ada.lovelace']);
    expect(parseMentionHandles('@ada, @grace!')).toEqual(['ada', 'grace']);
  });

  it('collapses duplicates and is case-insensitive', () => {
    expect(parseMentionHandles('@Ada and @ada and @ADA')).toEqual(['ada']);
  });
});

describe('resolving to a user id (AC5)', () => {
  it('resolves a project member', () => {
    const adaId = member('ada@example.test');

    expect(resolveMentions(t.db, projectId, ['ada'])).toEqual([adaId]);
  });

  it('resolves an ambiguous handle to nobody', () => {
    member('ada@example.test');
    member('ada@other.test');

    // Picking one silently fails twice: the writer believes they notified
    // somebody, and the wrong person may be notified instead.
    expect(resolveMentions(t.db, projectId, ['ada'])).toEqual([]);
  });

  it('counts a deactivated namesake towards ambiguity', () => {
    member('ada@example.test');
    const oldId = member('ada@old.test');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, oldId)).run();

    expect(resolveMentions(t.db, projectId, ['ada'])).toEqual([]);
  });

  it('resolves a deactivated user to nobody', () => {
    const adaId = member('ada@example.test');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, adaId)).run();

    expect(resolveMentions(t.db, projectId, ['ada'])).toEqual([]);
  });

  it('resolves an unknown handle to nobody', () => {
    expect(resolveMentions(t.db, projectId, ['nobody'])).toEqual([]);
  });
});

describe('a mention is not an invitation (AC6)', () => {
  it('writes no row for somebody who cannot read the project', () => {
    // In the org — so `GET /users` would offer them to the picker — but not in
    // this project. That mismatch is exactly where this leaks.
    makeUser('outsider@example.test');
    const authorId = member('author@example.test');

    expect(resolveMentions(t.db, projectId, ['outsider'])).toEqual([]);

    const comment = addComment(t.db, actor(authorId), taskId, 'cc @outsider');
    expect(mentionRows(comment.id)).toEqual([]);
  });

  it('resolves them once they join the project', () => {
    const outsiderId = makeUser('outsider@example.test');
    expect(resolveMentions(t.db, projectId, ['outsider'])).toEqual([]);

    addMember(t.db, actor(adminId), 'laika', outsiderId, 'member');
    expect(resolveMentions(t.db, projectId, ['outsider'])).toEqual([outsiderId]);
  });
});

describe('rows follow the body', () => {
  it('writes a row when the comment is created', () => {
    const adaId = member('ada@example.test');
    const authorId = member('author@example.test');

    const comment = addComment(t.db, actor(authorId), taskId, 'over to you @ada');

    expect(mentionRows(comment.id)).toEqual([adaId]);
  });

  it('re-derives on edit, dropping a name the edit removed', () => {
    const adaId = member('ada@example.test');
    const graceId = member('grace@example.test');
    const authorId = member('author@example.test');

    const comment = addComment(t.db, actor(authorId), taskId, 'cc @ada');
    expect(mentionRows(comment.id)).toEqual([adaId]);

    editComment(t.db, actor(authorId), comment.id, 'cc @grace');
    expect(mentionRows(comment.id)).toEqual([graceId]);
  });

  it('stops counting a mention once the comment is deleted', () => {
    const adaId = member('ada@example.test');
    const authorId = member('author@example.test');

    const comment = addComment(t.db, actor(authorId), taskId, 'cc @ada');
    expect([...(mentionedUserIds(t.db, [taskId]).get(taskId) ?? [])]).toEqual([adaId]);

    deleteComment(t.db, actor(authorId), comment.id);

    // The row survives — it records what was written — but a deleted comment
    // keeps nobody subscribed.
    expect(mentionRows(comment.id)).toEqual([adaId]);
    expect([...(mentionedUserIds(t.db, [taskId]).get(taskId) ?? [])]).toEqual([]);
  });

  it('returns an entry for every task asked about', () => {
    expect(mentionedUserIds(t.db, [taskId]).has(taskId)).toBe(true);
    expect(mentionedUserIds(t.db, []).size).toBe(0);
  });
});

/**
 * The picker and the parser are one predicate (§4.19, D-047, LAI-143).
 *
 * Two implementations of "mentionable" is one implementation and one bug, and
 * the bug is silent: a picker on a wider set offers a name, the mention resolves
 * to nobody, nothing is written, and it reads as the feature being broken.
 */
describe('who is mentionable', () => {
  function mentionable(userId: string): string[] {
    return mentionableUsers(t.db, actor(userId), 'laika').map((u) => u.id);
  }

  it('includes an org Owner who is not a member of the project', () => {
    // The case `/members` gets wrong and the reason this endpoint exists: org
    // Owners and Admins hold implicit `lead` everywhere and have **no
    // membership row** (D-006), so they are mentionable and absent from it.
    const adaId = member('ada@example.test');

    expect(mentionable(adaId)).toContain(adminId);
  });

  it('excludes somebody in the org who is not in the project', () => {
    const adaId = member('ada@example.test');
    const outsiderId = makeUser('outsider@example.test');

    expect(mentionable(adaId)).not.toContain(outsiderId);
  });

  it('excludes a deactivated member', () => {
    const adaId = member('ada@example.test');
    const graceId = member('grace@example.test');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, graceId)).run();

    expect(mentionable(adaId)).not.toContain(graceId);
  });

  it('agrees with resolveMentions in both directions', () => {
    // The criterion: a name it returns always resolves, and a name it omits
    // never does. One direction alone is satisfiable by a set that is too wide
    // or too narrow respectively.
    member('ada@example.test');
    member('grace@example.test');
    makeUser('outsider@example.test');
    const deactivated = member('dormant@example.test');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, deactivated)).run();

    const asker = member('asker@example.test');
    const offered = new Set(mentionable(asker));

    const everyone = t.db.select({ id: users.id, email: users.email }).from(users).all();

    for (const person of everyone) {
      const handle = person.email.split('@')[0]!;
      const resolves = resolveMentions(t.db, projectId, [handle]).includes(person.id);

      expect(resolves, `${handle}: offered=${String(offered.has(person.id))}`).toBe(
        offered.has(person.id),
      );
    }
  });

  it('refuses a caller who cannot read the project', () => {
    const outsiderId = makeUser('outsider@example.test');

    expect(() => mentionableUsers(t.db, actor(outsiderId), 'laika')).toThrow(ApiError);
  });
});
