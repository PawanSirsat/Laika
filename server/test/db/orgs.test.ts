import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { requireOrgId } from '../../src/db/orgs.ts';
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
        avatarColor: '#123456',
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
    expect(() => requireOrgId(t.db)).toThrowError(/no organisation/i);
  });
});
