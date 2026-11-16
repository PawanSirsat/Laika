import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { projectMemberships, projects, users } from '../../src/db/schema.ts';
import {
  availabilityAudienceOf,
  availabilityVisibleAmong,
  seesEveryonesAnalytics,
} from '../../src/services/availability-audience.ts';
import { listPeopleAvailability } from '../../src/services/people-load.ts';
import { freshDb, preparedDuring, seed, type TestDb } from '../helpers/db.ts';

/**
 * Whose availability a reader sees (D-137, LAI-1183): the three readers, the
 * reader always seeing themselves, and the answer agreeing with the people
 * list's, which reads the same rule.
 */

const NOW = Date.UTC(2026, 10, 12, 13);

let t: TestDb;
let owner: string;
let laika: string;
let skynet: string;

function person(name: string, orgRole: OrgRole = 'member'): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function member(userId: string, projectId: string, role: 'lead' | 'member' = 'member'): void {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role, createdAt: NOW })
    .run();
}

function actor(userId: string, extra: Partial<ResolvedActor> = {}): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return { ...loaded, ...extra };
}

let bea: string;
let cal: string;
let lena: string;
let sam: string;
let ari: string;

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  owner = s.userId;
  laika = s.projectId;
  skynet = newId();
  t.db
    .insert(projects)
    .values({
      id: skynet,
      orgId: s.orgId,
      name: 'Skynet',
      slug: 'skynet',
      prefix: 'SKY',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  // Laika: Bea, Cal and Lena, who leads it. Skynet: Sam, and Lena as a member.
  bea = person('Bea');
  cal = person('Cal');
  lena = person('Lena');
  sam = person('Sam');
  ari = person('Ari', 'admin');
  member(bea, laika);
  member(cal, laika);
  member(lena, laika, 'lead');
  member(sam, skynet);
  member(lena, skynet);
});

afterEach(() => {
  t.close();
});

const everyone = () => [owner, bea, cal, lena, sam, ari];
const seenBy = (reader: ResolvedActor) =>
  [...availabilityVisibleAmong(t.db, reader, everyone())].sort();
const sorted = (ids: string[]) => [...ids].sort();

describe('the three readers', () => {
  it('See everyone’s analytics sees everyone — and reads nothing to say so', () => {
    const reader = actor(owner);
    expect(availabilityAudienceOf(t.db, reader).reader).toBe('people');
    expect(seenBy(reader)).toEqual(sorted(everyone()));
    expect(preparedDuring(t.sqlite, () => seenBy(reader))).toEqual([]);
    expect(seesEveryonesAnalytics(actor(ari))).toBe(true);
  });

  it('a space admin sees the people of the spaces they lead — not of one they only belong to', () => {
    const reader = actor(lena);
    expect(availabilityAudienceOf(t.db, reader)).toMatchObject({ reader: 'lead' });
    // Sam shares Skynet with Lena as a member, and the list shows a lead only
    // the spaces they lead.
    expect(seenBy(reader)).toEqual(sorted([bea, cal, lena]));
  });

  it('an admin who lost See everyone’s analytics leads every space, and sees its people', () => {
    const reader = actor(ari, {
      orgGrants: { admin: ['open_all_projects'], member: [], viewer: [] },
    });
    expect(seesEveryonesAnalytics(reader)).toBe(false);
    expect(availabilityAudienceOf(t.db, reader).reader).toBe('lead');
    // Everyone in a space; the owner is in none, and Ari is always theirs.
    expect(seenBy(reader)).toEqual(sorted([bea, cal, lena, sam, ari]));
  });

  it('a member sees who shares a space with them, and nobody else', () => {
    expect(availabilityAudienceOf(t.db, actor(bea)).reader).toBe('member');
    expect(seenBy(actor(bea))).toEqual(sorted([bea, cal, lena]));
    expect(seenBy(actor(sam))).toEqual(sorted([sam, lena]));
  });

  it('a reader in no space still sees themselves', () => {
    const lone = person('Lone');
    expect(seenBy(actor(lone))).toEqual([]);
    expect([...availabilityVisibleAmong(t.db, actor(lone), [lone, bea])]).toEqual([lone]);
  });
});

describe('one rule with the people list', () => {
  it('lists exactly the people it says each reader sees', () => {
    for (const id of [bea, lena, sam]) {
      const reader = actor(id);
      const listed = listPeopleAvailability(t.db, reader, {}, NOW).data.map((r) => r.user.id);
      expect(sorted(listed), id).toEqual(seenBy(reader));
    }
  });
});
