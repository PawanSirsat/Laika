import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { SignInThrottle } from '../../src/auth/sign-in-throttle.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { accounts, orgs, passwordResets, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  consumeResetLink,
  issueResetLink,
  RESET_LINK_TTL_MS,
} from '../../src/services/password-resets.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The rules of admin-issued reset links (D-104 item 4, LAI-983), below the
 * route: who may issue, what an issue does to earlier links, and that one link
 * changes a password once even when two requests race. The route test drives
 * the same service through real better-auth.
 */

let t: TestDb;
let ownerId: string;

function makeUser(name: string, orgRole: OrgRole, isActive = 1): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name}@example.test`,
      name,
      orgRole,
      isActive,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  t.db
    .insert(accounts)
    .values({
      id: newId(),
      userId: id,
      issuer: 'laika',
      accountId: id,
      providerId: 'credential',
      password: 'hash:old',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  return loadActor(t.db, userId)!;
}

function expectRefused(fn: () => unknown, code: string, reason?: string): void {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    expect(err.code).toBe(code);
    if (reason !== undefined) expect((err.details as { reason?: string }).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected ${code}, but nothing was thrown`);
}

function passwordOf(userId: string): string | null | undefined {
  return t.db.select().from(accounts).where(eq(accounts.userId, userId)).get()?.password;
}

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('ada', 'owner');
  const now = Date.now();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
});
afterEach(() => {
  t.close();
});

describe('issuing', () => {
  it('expires within 24 hours of issue', () => {
    const grace = makeUser('grace', 'member');
    const issued = issueResetLink(t.db, actor(ownerId), grace, 1_000);

    expect(issued.expiresAt).toBe(1_000 + RESET_LINK_TTL_MS);
    expect(RESET_LINK_TTL_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('revokes the person’s earlier unused link, and only theirs', () => {
    const grace = makeUser('grace', 'member');
    const hedy = makeUser('hedy', 'member');
    issueResetLink(t.db, actor(ownerId), grace, 1_000);
    issueResetLink(t.db, actor(ownerId), hedy, 1_000);
    issueResetLink(t.db, actor(ownerId), grace, 2_000);

    const rows = t.db.select().from(passwordResets).all();
    const graces = rows.filter((r) => r.userId === grace);
    expect(graces.map((r) => r.revokedAt)).toEqual([2_000, null]);
    expect(rows.find((r) => r.userId === hedy)?.revokedAt).toBeNull();
  });

  it('refuses an Admin a link for the owner, and lets the owner issue their own', () => {
    const admin = makeUser('admin', 'admin');

    expectRefused(() => issueResetLink(t.db, actor(admin), ownerId), 'forbidden');
    expect(issueResetLink(t.db, actor(ownerId), ownerId).token).toHaveLength(43);
  });

  it('refuses a member and a viewer', () => {
    const grace = makeUser('grace', 'member');
    for (const role of ['member', 'viewer'] as const) {
      expectRefused(() => issueResetLink(t.db, actor(makeUser(role, role)), grace), 'forbidden');
    }
  });
});

describe('using', () => {
  const deps = () => ({
    hashPassword: (pw: string) => Promise.resolve(`hash:${pw}`),
    throttle: new SignInThrottle(),
  });

  it('writes the new hash to the credential account', async () => {
    const grace = makeUser('grace', 'member');
    const { token } = issueResetLink(t.db, actor(ownerId), grace);

    await consumeResetLink(t.db, { token, newPassword: 'a-long-new-passphrase' }, deps());

    expect(passwordOf(grace)).toBe('hash:a-long-new-passphrase');
  });

  it('refuses at the expiry instant, not a millisecond after', async () => {
    const grace = makeUser('grace', 'member');
    const { token, expiresAt } = issueResetLink(t.db, actor(ownerId), grace, 1_000);

    await expect(
      consumeResetLink(
        t.db,
        { token, newPassword: 'a-long-new-passphrase' },
        { ...deps(), now: () => expiresAt },
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'expired' } });
    expect(passwordOf(grace)).toBe('hash:old');
  });

  it('changes the password once when two requests race with one link', async () => {
    const grace = makeUser('grace', 'member');
    const { token } = issueResetLink(t.db, actor(ownerId), grace);

    let hashed = 0;
    const racing = {
      // Slow enough that both requests pass the checks before either claims.
      hashPassword: async (pw: string) => {
        hashed += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return `hash:${pw}`;
      },
      throttle: new SignInThrottle(),
    };

    const results = await Promise.allSettled([
      consumeResetLink(t.db, { token, newPassword: 'first-long-passphrase' }, racing),
      consumeResetLink(t.db, { token, newPassword: 'second-long-passphrase' }, racing),
    ]);

    // Both got as far as hashing: the claim, not the checks, decided it.
    expect(hashed).toBe(2);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'conflict', details: { reason: 'used' } });
    expect(passwordOf(grace)).toBe('hash:first-long-passphrase');
  });

  it('rolls the claim back when there is no password account to set', async () => {
    const grace = makeUser('grace', 'member');
    t.db.delete(accounts).where(eq(accounts.userId, grace)).run();
    const { token } = issueResetLink(t.db, actor(ownerId), grace);

    await expect(
      consumeResetLink(t.db, { token, newPassword: 'a-long-new-passphrase' }, deps()),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'no_password' } });
    expect(t.db.select().from(passwordResets).get()?.usedAt).toBeNull();
  });
});
