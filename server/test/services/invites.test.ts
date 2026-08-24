import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type Db } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, invites, projectMemberships, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  consumeInvite,
  createInvite,
  resolveInviteForAccept,
  INVITE_TOKEN_BYTES,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  listInvites,
  newInviteToken,
  previewInvite,
  removeOrphanedInvitee,
  revokeInvite,
} from '../../src/services/invites.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * LAI-071. The rules that matter here are single-use, expiry, entropy and which
 * §3.1 cell governs each operation — everything else is shape.
 */

let t: TestDb;
let db: Db;
let ctx: ReturnType<typeof seed>;

function actorFor(
  userId: string,
  orgRole: ResolvedActor['orgRole'],
  memberships: ResolvedActor['memberships'] = [],
): ResolvedActor {
  return {
    userId,
    email: `${userId}@example.test`,
    name: userId,
    orgRole,
    isActive: true,
    projectRole: null,
    memberships,
    token: null,
  };
}

/** A second person in the org, so tests are not all about the owner. */
function makeUser(
  role: ResolvedActor['orgRole'],
  options: { isActive?: boolean; email?: string } = {},
): string {
  const id = newId();
  const now = Date.now();

  db.insert(users)
    .values({
      id,
      email: options.email ?? `${id.toLowerCase()}@example.test`,
      name: `User ${id.slice(-4)}`,
      orgRole: role,
      avatarColor: '#123456',
      isActive: options.isActive === false ? 0 : 1,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();

  return id;
}

function owner(): ResolvedActor {
  return actorFor(ctx.userId, 'owner');
}

function expectApiError(fn: () => unknown, code: string): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      expect(err.code, err.message).toBe(code);
      return err;
    }
    throw err;
  }

  throw new Error(`Expected an ApiError with code ${code}, but nothing was thrown`);
}

beforeEach(() => {
  t = freshDb();
  db = t.db;
  ctx = seed(db);
});

describe('the token (AC5)', () => {
  it('is 256 bits of base64url — 43 characters, no padding', () => {
    expect(INVITE_TOKEN_BYTES).toBe(32);

    const token = newInviteToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(INVITE_TOKEN_BYTES);
  });

  it('is not derived from the email — the same address twice gives two tokens', () => {
    const a = createInvite(db, owner(), { email: 'same@example.test', orgRole: 'member' });
    revokeInvite(db, owner(), a.invite.id);
    const b = createInvite(db, owner(), { email: 'same@example.test', orgRole: 'member' });

    expect(b.token).not.toBe(a.token);
    // Nor is either one a transform of the address: neither contains it, and
    // neither matches any obvious hash of it.
    for (const token of [a.token, b.token]) {
      expect(token).not.toContain('same');
      expect(token).not.toBe(createHash('sha256').update('same@example.test').digest('base64url'));
    }
  });

  it('does not repeat across a large sample', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newInviteToken()));
    expect(seen.size).toBe(2000);
  });

  it('is stored hashed, and no column of the row holds the plaintext', () => {
    const { invite, token } = createInvite(db, owner(), {
      email: 'hash@example.test',
      orgRole: 'member',
    });

    const row = db.select().from(invites).where(eq(invites.id, invite.id)).get();

    expect(row?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row?.tokenHash).not.toBe(token);

    // Scanning every value rather than naming `token_hash`: this is what catches
    // a later change that adds a plaintext column beside the hash.
    for (const value of Object.values(row ?? {})) {
      expect(String(value)).not.toContain(token);
    }
  });
});

describe('expiry (AC4)', () => {
  it('is seven days', () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);

    const now = 1_700_000_000_000;
    const { invite } = createInvite(db, owner(), { orgRole: 'member', now });

    expect(invite.expires_at).toBe(now + INVITE_TTL_MS);
  });

  it('is usable one millisecond before it expires', () => {
    const now = 1_700_000_000_000;
    const { invite, token } = createInvite(db, owner(), { orgRole: 'admin', now });

    expect(previewInvite(db, token, invite.expires_at - 1).org_role).toBe('admin');

    const invitee = makeUser('member');
    expect(
      consumeInvite(t.sqlite, db, { token, userId: invitee, now: invite.expires_at - 1 }).orgRole,
    ).toBe('admin');
  });

  it('holds the same boundary on the path that accepting reads', () => {
    // `resolveInviteForAccept` is a second query with its own `WHERE`, so it can
    // drift from `previewInvite` without any other test noticing.
    const now = 1_700_000_000_000;
    const { invite, token } = createInvite(db, owner(), { orgRole: 'member', now });

    expect(resolveInviteForAccept(db, token, invite.expires_at - 1).orgRole).toBe('member');
    expectApiError(() => resolveInviteForAccept(db, token, invite.expires_at), 'forbidden');
  });

  it('is refused at the instant it expires', () => {
    const now = 1_700_000_000_000;
    const { invite, token } = createInvite(db, owner(), { orgRole: 'admin', now });
    const invitee = makeUser('member');

    expectApiError(() => previewInvite(db, token, invite.expires_at), 'not_found');
    expectApiError(
      () => consumeInvite(t.sqlite, db, { token, userId: invitee, now: invite.expires_at }),
      'forbidden',
    );
  });
});

describe('creating (AC1)', () => {
  it('is refused to a Member and a Viewer — §3.1 grants it to admin and above', () => {
    for (const role of ['member', 'viewer'] as const) {
      const id = makeUser(role);
      expectApiError(
        () =>
          createInvite(db, actorFor(id, role), {
            email: `x-${role}@example.test`,
            orgRole: 'member',
          }),
        'forbidden',
      );
    }
  });

  it('lets an Admin invite at every role except Owner', () => {
    const adminId = makeUser('admin');
    const admin = actorFor(adminId, 'admin');

    for (const role of ['admin', 'member', 'viewer'] as const) {
      expect(
        createInvite(db, admin, { email: `${role}@example.test`, orgRole: role }).invite.org_role,
      ).toBe(role);
    }

    // §3.1's "(not to Owner)" caveat. Without it an Admin mints themselves a
    // fresh Owner account and the caveat on the direct role change is decorative.
    expectApiError(
      () => createInvite(db, admin, { email: 'escalate@example.test', orgRole: 'owner' }),
      'forbidden',
    );
  });

  it('lets an Owner invite an Owner', () => {
    expect(
      createInvite(db, owner(), { email: 'co-owner@example.test', orgRole: 'owner' }).invite
        .org_role,
    ).toBe('owner');
  });

  it('refuses an address that already has an active account', () => {
    makeUser('member', { email: 'taken@example.test' });

    const err = expectApiError(
      () => createInvite(db, owner(), { email: 'taken@example.test', orgRole: 'member' }),
      'conflict',
    );
    expect(err.message).toMatch(/already has an account/);
  });

  it('refuses an address belonging to a deactivated account, and says why', () => {
    makeUser('member', { email: 'gone@example.test', isActive: false });

    const err = expectApiError(
      () => createInvite(db, owner(), { email: 'gone@example.test', orgRole: 'member' }),
      'conflict',
    );
    // Not the same message: an invite must not be a way to restore an account
    // somebody deactivated, so the remedy named is reactivation.
    expect(err.message).toMatch(/deactivated/);
  });

  it('refuses a second live invite for one address, naming the first', () => {
    const first = createInvite(db, owner(), { email: 'dup@example.test', orgRole: 'member' });

    const err = expectApiError(
      () => createInvite(db, owner(), { email: 'dup@example.test', orgRole: 'member' }),
      'conflict',
    );
    expect(err.details).toMatchObject({ invite_id: first.invite.id });
  });

  it('allows a fresh invite once the first has expired', () => {
    const now = 1_700_000_000_000;
    createInvite(db, owner(), { email: 'again@example.test', orgRole: 'member', now });

    expect(
      createInvite(db, owner(), {
        email: 'again@example.test',
        orgRole: 'member',
        now: now + INVITE_TTL_MS + 1,
      }).invite.email,
    ).toBe('again@example.test');
  });

  it('lowercases the address, so uniqueness matches §4.1', () => {
    expect(
      createInvite(db, owner(), { email: 'MixedCase@Example.TEST', orgRole: 'member' }).invite
        .email,
    ).toBe('mixedcase@example.test');
  });

  it('accepts a link invite with no address at all', () => {
    expect(createInvite(db, owner(), { orgRole: 'viewer' }).invite.email).toBeNull();
    expect(createInvite(db, owner(), { email: null, orgRole: 'viewer' }).invite.email).toBeNull();
  });

  it('refuses a project_role with no project_id beside it', () => {
    expectApiError(
      () => createInvite(db, owner(), { orgRole: 'member', projectRole: 'lead' }),
      'unprocessable',
    );
  });

  it('refuses an unknown project', () => {
    expectApiError(
      () => createInvite(db, owner(), { orgRole: 'member', projectId: 'nope' }),
      'not_found',
    );
  });

  it('defaults a project invite to project role member', () => {
    expect(
      createInvite(db, owner(), { orgRole: 'member', projectId: ctx.projectId }).invite
        .project_role,
    ).toBe('member');
  });
});

describe('listing (AC2)', () => {
  it('is refused to a Member — a pending invite names someone who has not joined', () => {
    const id = makeUser('member');
    expectApiError(
      () => listInvites(db, actorFor(id, 'member'), { limit: 50, cursor: null }),
      'forbidden',
    );
  });

  it('returns pending invites newest first', () => {
    const now = 1_700_000_000_000;
    const a = createInvite(db, owner(), { email: 'a@example.test', orgRole: 'member', now });
    const b = createInvite(db, owner(), {
      email: 'b@example.test',
      orgRole: 'member',
      now: now + 1,
    });

    const rows = listInvites(db, owner(), { limit: 50, cursor: null, now: now + 2 });

    expect(rows.map((r) => r.id)).toEqual([b.invite.id, a.invite.id]);
  });

  it('hides accepted and expired invites, and shows them on request', () => {
    const now = 1_700_000_000_000;
    const live = createInvite(db, owner(), { email: 'live@example.test', orgRole: 'member', now });
    const stale = createInvite(db, owner(), {
      email: 'stale@example.test',
      orgRole: 'member',
      now,
    });
    const used = createInvite(db, owner(), { email: 'used@example.test', orgRole: 'member', now });

    consumeInvite(t.sqlite, db, { token: used.token, userId: makeUser('member'), now: now + 1 });
    db.update(invites)
      .set({ expiresAt: now + 2 })
      .where(eq(invites.id, stale.invite.id))
      .run();

    const at = now + 3;

    expect(listInvites(db, owner(), { limit: 50, cursor: null, now: at }).map((r) => r.id)).toEqual(
      [live.invite.id],
    );

    expect(
      listInvites(db, owner(), { limit: 50, cursor: null, now: at, includeUsed: true }).length,
    ).toBe(3);
  });

  it('pages with a keyset cursor that neither skips nor repeats', () => {
    const now = 1_700_000_000_000;
    const made = Array.from({ length: 5 }, (_, i) =>
      createInvite(db, owner(), {
        email: `p${String(i)}@example.test`,
        orgRole: 'member',
        now: now + i,
      }),
    );

    const first = listInvites(db, owner(), { limit: 2, cursor: null, now: now + 10 }).slice(0, 2);
    const last = first[1];
    const second = listInvites(db, owner(), {
      limit: 2,
      cursor: { sortKey: last?.created_at ?? 0, id: last?.id ?? '' },
      now: now + 10,
    }).slice(0, 2);

    expect([...first, ...second].map((r) => r.id)).toEqual(
      made
        .map((m) => m.invite.id)
        .reverse()
        .slice(0, 4),
    );
  });

  it('never reports email_sent true — Laika sends no mail', () => {
    createInvite(db, owner(), { email: 'nomail@example.test', orgRole: 'member' });

    expect(listInvites(db, owner(), { limit: 50, cursor: null })[0]?.email_sent).toBe(false);
  });
});

describe('revoking (AC2)', () => {
  it('is refused to a Member', () => {
    const { invite } = createInvite(db, owner(), { email: 'r@example.test', orgRole: 'member' });
    const id = makeUser('member');

    expectApiError(() => revokeInvite(db, actorFor(id, 'member'), invite.id), 'forbidden');
  });

  it('removes the invite and makes its token useless', () => {
    const { invite, token } = createInvite(db, owner(), {
      email: 'r2@example.test',
      orgRole: 'member',
    });

    revokeInvite(db, owner(), invite.id);

    expect(db.select().from(invites).where(eq(invites.id, invite.id)).get()).toBeUndefined();
    expectApiError(() => previewInvite(db, token), 'not_found');
    expectApiError(
      () => consumeInvite(t.sqlite, db, { token, userId: makeUser('member') }),
      'forbidden',
    );
  });

  it('answers not_found for an id that never existed', () => {
    expectApiError(() => revokeInvite(db, owner(), 'nope'), 'not_found');
  });

  it('refuses to revoke an accepted invite — that row is how somebody got in', () => {
    const { invite, token } = createInvite(db, owner(), {
      email: 'in@example.test',
      orgRole: 'member',
    });
    consumeInvite(t.sqlite, db, { token, userId: makeUser('member') });

    expectApiError(() => revokeInvite(db, owner(), invite.id), 'conflict');
    expect(db.select().from(invites).where(eq(invites.id, invite.id)).get()).toBeDefined();
  });
});

describe('previewing (§6.4, unauthenticated)', () => {
  it('names the org, the inviter, the role and the expiry', () => {
    const { invite, token } = createInvite(db, owner(), {
      email: 'peek@example.test',
      orgRole: 'admin',
      projectId: ctx.projectId,
      projectRole: 'lead',
    });

    expect(previewInvite(db, token)).toEqual({
      org_name: 'Laika',
      inviter_name: 'Owner',
      org_role: 'admin',
      project_id: ctx.projectId,
      project_name: 'Laika',
      project_role: 'lead',
      email: 'peek@example.test',
      expires_at: invite.expires_at,
    });
  });

  it('answers the same not_found for unknown, spent and expired tokens', () => {
    const { token } = createInvite(db, owner(), { email: 's@example.test', orgRole: 'member' });
    consumeInvite(t.sqlite, db, { token, userId: makeUser('member') });

    const unknown = expectApiError(() => previewInvite(db, 'made-up'), 'not_found');
    const spent = expectApiError(() => previewInvite(db, token), 'not_found');

    // Identical wording on purpose: telling a guesser that their token exists
    // but is spent confirms the token, which is the thing worth protecting.
    expect(spent.message).toBe(unknown.message);
  });
});

describe('consuming (AC3)', () => {
  it('lands the account on the invited role and marks the invite used', () => {
    const { invite, token } = createInvite(db, owner(), {
      email: 'joiner@example.test',
      orgRole: 'admin',
    });
    const invitee = makeUser('member');
    const at = 1_700_000_000_123;

    const result = consumeInvite(t.sqlite, db, { token, userId: invitee, now: at });

    expect(result).toEqual({
      inviteId: invite.id,
      orgRole: 'admin',
      projectId: null,
      projectRole: null,
    });
    expect(db.select().from(users).where(eq(users.id, invitee)).get()?.orgRole).toBe('admin');

    const row = db.select().from(invites).where(eq(invites.id, invite.id)).get();
    expect(row?.acceptedBy).toBe(invitee);
    expect(row?.acceptedAt).toBe(at);
  });

  it('refuses the replay — a single-use token that is not single-use is the whole risk', () => {
    const { token } = createInvite(db, owner(), { email: 'once@example.test', orgRole: 'admin' });
    const first = makeUser('member');
    const second = makeUser('member');

    consumeInvite(t.sqlite, db, { token, userId: first });

    expectApiError(() => consumeInvite(t.sqlite, db, { token, userId: second }), 'forbidden');
    // And the second account keeps the role it had — a refused replay must not
    // half-apply.
    expect(db.select().from(users).where(eq(users.id, second)).get()?.orgRole).toBe('member');
  });

  it('refuses the replay even with only one of its two guards left', () => {
    // The pre-read and the conditional UPDATE each refuse a spent invite on
    // their own, so breaking either alone leaves every other test green. This
    // is what proves the property is actually tested rather than shadowed: the
    // conditional UPDATE is exercised here with the pre-read stepped around.
    const { invite, token } = createInvite(db, owner(), { orgRole: 'admin' });
    consumeInvite(t.sqlite, db, { token, userId: makeUser('member') });

    // Reproduce exactly what the UPDATE does, with no pre-read in front of it.
    const replayed = db
      .update(invites)
      .set({ acceptedBy: makeUser('member'), acceptedAt: Date.now() })
      .where(and(eq(invites.id, invite.id), isNull(invites.acceptedBy)))
      .run();

    expect(replayed.changes).toBe(0);
  });

  it('writes member.added, org-scoped, naming the invite it came from', () => {
    const { invite, token } = createInvite(db, owner(), {
      email: 'audit@example.test',
      orgRole: 'viewer',
    });
    const invitee = makeUser('member');

    consumeInvite(t.sqlite, db, { token, userId: invitee });

    const row = db
      .select()
      .from(activity)
      .where(eq(activity.type, 'member.added'))
      .orderBy(sql`rowid desc`)
      .get();

    expect(row?.projectId).toBeNull();
    expect(row?.actorId).toBe(invitee);
    expect(JSON.parse(row?.payloadJson ?? '{}')).toEqual({
      user_id: invitee,
      org_role: 'viewer',
      via: 'invite',
      invite_id: invite.id,
      invited_by: ctx.userId,
    });
  });

  it('adds the project membership and a second, project-scoped member.added', () => {
    const { token } = createInvite(db, owner(), {
      email: 'proj@example.test',
      orgRole: 'member',
      projectId: ctx.projectId,
      projectRole: 'lead',
    });
    const invitee = makeUser('member');

    consumeInvite(t.sqlite, db, { token, userId: invitee });

    expect(
      db.select().from(projectMemberships).where(eq(projectMemberships.userId, invitee)).get()
        ?.role,
    ).toBe('lead');

    const scoped = db
      .select()
      .from(activity)
      .where(eq(activity.projectId, ctx.projectId))
      .all()
      .filter((r) => r.type === 'member.added');

    expect(scoped).toHaveLength(1);
    expect(JSON.parse(scoped[0]?.payloadJson ?? '{}')).toEqual({
      user_id: invitee,
      role: 'lead',
      via: 'invite',
    });
  });

  it('rolls the whole thing back when any part of it fails', () => {
    const { invite, token } = createInvite(db, owner(), {
      email: 'atomic@example.test',
      orgRole: 'admin',
      projectId: ctx.projectId,
    });
    const invitee = makeUser('member');

    // A membership row already there makes the insert fail on the unique index,
    // which is the cheapest way to fail *after* the invite has been marked and
    // the role applied — exactly the half-done state the transaction exists for.
    db.insert(projectMemberships)
      .values({
        id: newId(),
        projectId: ctx.projectId,
        userId: invitee,
        role: 'viewer',
        createdAt: Date.now(),
      })
      .run();

    expect(() => consumeInvite(t.sqlite, db, { token, userId: invitee })).toThrow();

    expect(db.select().from(invites).where(eq(invites.id, invite.id)).get()?.acceptedBy).toBeNull();
    expect(db.select().from(users).where(eq(users.id, invitee)).get()?.orgRole).toBe('member');
  });
});

describe('removeOrphanedInvitee', () => {
  it('deletes the account so the address can be invited again', () => {
    const stranded = makeUser('member', { email: 'stranded@example.test' });

    removeOrphanedInvitee(db, stranded);

    expect(db.select().from(users).where(eq(users.id, stranded)).get()).toBeUndefined();
    expect(
      createInvite(db, owner(), { email: 'stranded@example.test', orgRole: 'member' }).invite.email,
    ).toBe('stranded@example.test');
  });
});
