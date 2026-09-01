import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { getOrg } from '../../src/services/orgs.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * `GET /api/v1/org` (§6.4, §11.4.2, LAI-222).
 *
 * Before this, a signed-in user could not learn the name of the organisation
 * they were signed in to: `GET /me` carries `org_role` and no org, and the only
 * place an org name was served was the pre-auth invite preview.
 */

let t: TestDb;
let orgId: string;

function makeUser(orgRole: OrgRole): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: orgRole,
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

beforeEach(() => {
  t = freshDb();
  orgId = newId();
  const ownerId = makeUser('owner');
  t.db
    .insert(orgs)
    .values({
      id: orgId,
      name: 'Kvell Dynamics',
      ownerUserId: ownerId,
      createdAt: 1000,
      updatedAt: 2000,
    })
    .run();
});
afterEach(() => {
  t.close();
});

describe('who may read the organisation', () => {
  it('answers every role, because §3.1 grants org.read to all four', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const view = getOrg(t.db, actor(makeUser(role)));

      expect(view.id, role).toBe(orgId);
      expect(view.name, role).toBe('Kvell Dynamics');
    }
  });

  it('refuses a deactivated user, because can() does', () => {
    const id = makeUser('admin');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, id)).run();

    expect(() => getOrg(t.db, actor(id))).toThrow(ApiError);
  });

  it('carries the org’s own timestamps, not the caller’s', () => {
    const view = getOrg(t.db, actor(makeUser('member')));

    expect(view.created_at).toBe(1000);
    expect(view.updated_at).toBe(2000);
  });
});

describe('the provider block is gated field-level (§3.1, §11.4.2)', () => {
  beforeEach(() => {
    t.db
      .update(orgs)
      .set({ aiProvider: 'anthropic', aiApiKeyEnc: 'ciphertext' })
      .where(eq(orgs.id, orgId))
      .run();
  });

  it('gives a Viewer the org and not the provider block', () => {
    const view = getOrg(t.db, actor(makeUser('viewer')));

    expect(view.name).toBe('Kvell Dynamics');
    // **Absent, not null.** `null` would say "no provider is configured", which
    // is a different fact and one a Viewer would then act on.
    expect(view.ai).toBeUndefined();
    expect('ai' in view).toBe(false);
  });

  it('gives a Member the org and not the provider block', () => {
    expect(getOrg(t.db, actor(makeUser('member'))).ai).toBeUndefined();
  });

  it('gives an Admin and an Owner the provider block', () => {
    for (const role of ['admin', 'owner'] as const) {
      const view = getOrg(t.db, actor(makeUser(role)));

      expect(view.ai, role).toBeDefined();
      expect(view.ai?.configured, role).toBe(true);
      expect(view.ai?.provider, role).toBe('anthropic');
    }
  });

  it('reports an unconfigured provider to an Admin, rather than hiding it', () => {
    t.db.update(orgs).set({ aiProvider: null, aiApiKeyEnc: null }).where(eq(orgs.id, orgId)).run();

    const view = getOrg(t.db, actor(makeUser('admin')));

    // The block is present and says "nothing is set" — which is what the
    // Organisation screen needs to render the empty state.
    expect(view.ai).toEqual({ configured: false, provider: null, key_last4: null });
  });

  it('never returns the key, at any grade', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const serialised = JSON.stringify(getOrg(t.db, actor(makeUser(role))));

      // §12 keeps it as ciphertext and nothing decrypts it to build a response.
      expect(serialised, role).not.toContain('ciphertext');
      expect(serialised, role).not.toContain('api_key');
    }
  });

  it('never returns the other encrypted columns either', () => {
    t.db
      .update(orgs)
      .set({ smtpJsonEnc: 'smtp-secret', githubWebhookSecretEnc: 'hook-secret' })
      .where(eq(orgs.id, orgId))
      .run();

    const serialised = JSON.stringify(getOrg(t.db, actor(makeUser('owner'))));

    expect(serialised).not.toContain('smtp-secret');
    expect(serialised).not.toContain('hook-secret');
  });
});
