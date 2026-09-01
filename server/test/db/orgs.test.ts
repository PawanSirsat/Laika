import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { presenceEnabled, requireOrg, requireOrgId } from '../../src/db/orgs.ts';
import { ApiError } from '../../src/errors.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The one org (SPEC §4.2, LAI-405).
 *
 * Small enough to look pointless, and worth pinning for one reason: three
 * services were about to answer this question privately, and the interesting
 * behaviour is what happens when there is **no** org — the case first-boot hits
 * and the one a private copy is most likely to get differently.
 */

let t: TestDb;

beforeEach(() => {
  t = freshDb();
});
afterEach(() => {
  t.close();
});

describe('requireOrgId', () => {
  it('returns the org', () => {
    const ownerId = newId();
    const orgId = newId();
    const now = Date.now();

    t.db
      .insert(users)
      .values({
        id: ownerId,
        email: 'owner@example.test',
        name: 'Owner',
        orgRole: 'owner',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
    t.db
      .insert(orgs)
      .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
      .run();

    expect(requireOrgId(t.db)).toBe(orgId);
  });

  it('throws rather than returning undefined when there is none', () => {
    // Before first-boot setup. Every caller writes an org-scoped `activity` row
    // next, and `org_id` is NOT NULL (§4.8) — so a silent `undefined` would
    // surface as a constraint violation three frames away from the cause.
    expect(() => requireOrgId(t.db)).toThrowError(ApiError);
  });

  it('gives the setup gate’s answer, not a 404 and not a 500 (LAI-140)', () => {
    // **Changed deliberately.** Three copies gave three answers: `conflict`
    // (invites), `not_found` — a 404 — (tokens), and a plain `Error`, a 500
    // (here). A 404 tells a client the thing is missing and a 500 tells them the
    // server broke; neither is true. Reaching here without an org means the
    // setup gate was bypassed, so this is the gate's own answer.
    try {
      requireOrgId(t.db);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('conflict');
      expect((err as ApiError).details).toEqual({ setup_required: true });
    }
  });
});

describe('requireOrg', () => {
  it('carries the name as well, for the one caller that needs it', () => {
    const ownerId = newId();
    const orgId = newId();
    const now = Date.now();

    t.db
      .insert(users)
      .values({
        id: ownerId,
        email: 'owner@example.test',
        name: 'Owner',
        orgRole: 'owner',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
    t.db
      .insert(orgs)
      .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
      .run();

    // `invites.ts` needs the name; nothing else does. It is a second function
    // rather than a wider return so `requireOrgId` keeps the shape its callers
    // actually use.
    expect(requireOrg(t.db)).toEqual({ id: orgId, name: 'Laika' });
  });

  it('refuses identically to requireOrgId — one decision, not two', () => {
    let a: unknown;
    let b: unknown;
    try {
      requireOrg(t.db);
    } catch (err) {
      a = err;
    }
    try {
      requireOrgId(t.db);
    } catch (err) {
      b = err;
    }

    // The whole point of the convergence: `requireOrgId` delegates, so these
    // cannot drift apart the way the three private copies did.
    expect((a as ApiError).code).toBe((b as ApiError).code);
    expect((a as ApiError).message).toBe((b as ApiError).message);
    expect((a as ApiError).details).toEqual((b as ApiError).details);
  });
});

describe('presenceEnabled', () => {
  function seedOrg(presence: number): void {
    const ownerId = newId();
    const now = Date.now();
    t.db
      .insert(users)
      .values({
        id: ownerId,
        email: 'owner@example.test',
        name: 'Owner',
        orgRole: 'owner',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
    t.db
      .insert(orgs)
      .values({
        id: newId(),
        name: 'Laika',
        ownerUserId: ownerId,
        presenceEnabled: presence,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  it('answers true with no org at all', () => {
    // **The case neither private copy tested**, and the reason this one does not
    // throw where `requireOrgId` does: "there is no org" has a correct answer
    // here. An instance with nothing set up has nothing to have switched off,
    // and §4.2's default is on.
    expect(presenceEnabled(t.db)).toBe(true);
  });

  it('reads the column when there is one', () => {
    seedOrg(0);

    expect(presenceEnabled(t.db)).toBe(false);
  });

  it('is on when the column says so', () => {
    seedOrg(1);

    // Both values, not just the interesting one: asserting only `false` passes
    // against an implementation that always says `false`.
    expect(presenceEnabled(t.db)).toBe(true);
  });
});
