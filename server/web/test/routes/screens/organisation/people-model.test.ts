/**
 * Organisation → People's search, chips and invite parsing (LAI-987).
 *
 * Pure functions, so each is asserted on what it returns for an input that
 * only the real rule can satisfy — a person who matches by email and not by
 * name, a pasted list with a duplicate in different case, a space filter that
 * has not answered yet.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OrgUser } from '../../../../src/api/users.ts';
import {
  filterPeople,
  lastSeenLabel,
  newOwnerCandidates,
  parseEmails,
  peopleCounts,
  peopleQuery,
  spaceRolesFor,
  withPeopleQuery,
} from '../../../../src/routes/screens/organisation/people-model.ts';

const person = (
  id: string,
  name: string,
  org_role: string,
  extra: Partial<OrgUser> = {},
): OrgUser => ({
  id,
  name,
  email: `${id}@corp.test`,
  org_role,
  is_active: true,
  last_seen_at: null,
  created_at: 1,
  updated_at: 1,
  ...extra,
});

const PEOPLE: readonly OrgUser[] = [
  person('ada', 'Ada Lovelace', 'owner'),
  person('tom', 'Tomas Nel', 'member'),
  person('pri', 'Priya Raman', 'admin'),
  person('sam', 'Sam Okafor', 'viewer', { is_active: false }),
  person('zed', 'Zed Quill', 'member', { email: 'someone-else@corp.test' }),
];

const ids = (rows: readonly OrgUser[]): string[] => rows.map((p) => p.id);

void describe('peopleQuery and withPeopleQuery', () => {
  void test('read from the address with defaults, and write back only what is not default', () => {
    const query = peopleQuery(new URLSearchParams('tab=people&q=ada&role=admin&status=off'));
    assert.deepEqual(query, { q: 'ada', role: 'admin', status: 'off', space: '' });

    // An unknown chip value is the default, not a filter that matches nobody.
    assert.deepEqual(peopleQuery(new URLSearchParams('role=emperor&status=gone')), {
      q: '',
      role: 'all',
      status: 'all',
      space: '',
    });

    const next = withPeopleQuery(new URLSearchParams('tab=people&q=ada'), {
      q: '',
      role: 'member',
    });
    assert.equal(next.get('tab'), 'people', 'the tab was dropped');
    assert.equal(next.has('q'), false, 'an empty search stayed in the address');
    assert.equal(next.get('role'), 'member');
  });
});

void describe('filterPeople', () => {
  void test('search matches name or email, case-insensitively', () => {
    const all = { q: '', role: 'all', status: 'all', space: '' } as const;
    assert.deepEqual(ids(filterPeople(PEOPLE, { ...all, q: 'PRIYA' }, undefined)), ['pri']);
    // Zed matches by email only — a name-only search would miss them.
    assert.deepEqual(ids(filterPeople(PEOPLE, { ...all, q: 'someone-else' }, undefined)), ['zed']);
  });

  void test('role and status chips narrow independently', () => {
    const all = { q: '', role: 'all', status: 'all', space: '' } as const;
    assert.deepEqual(ids(filterPeople(PEOPLE, { ...all, role: 'member' }, undefined)), [
      'tom',
      'zed',
    ]);
    assert.deepEqual(ids(filterPeople(PEOPLE, { ...all, status: 'off' }, undefined)), ['sam']);
    assert.deepEqual(
      ids(filterPeople(PEOPLE, { ...all, status: 'active', role: 'viewer' }, undefined)),
      [],
    );
  });

  void test('a space filter keeps only that space’s members, and nobody until it has answered', () => {
    const query = { q: '', role: 'all', status: 'all', space: 'core' } as const;
    assert.deepEqual(ids(filterPeople(PEOPLE, query, new Set(['tom', 'sam']))), ['tom', 'sam']);
    // Unknown is not "everyone": showing the whole list under a space chip
    // would say they are all members.
    assert.deepEqual(ids(filterPeople(PEOPLE, query, undefined)), []);
  });
});

void describe('peopleCounts', () => {
  void test('each chip counts what it would show with the other filters applied', () => {
    const counts = peopleCounts(PEOPLE, { q: '', role: 'member', status: 'all', space: '' });
    // Role counts ignore the role chip itself but honour the status chip…
    assert.deepEqual(counts.role, { all: 5, owner: 1, admin: 1, member: 2, viewer: 1 });
    // …and status counts honour the role chip.
    assert.deepEqual(counts.status, { all: 2, active: 2, off: 0 });

    const off = peopleCounts(PEOPLE, { q: '', role: 'all', status: 'off', space: '' });
    assert.deepEqual(off.role, { all: 1, owner: 0, admin: 0, member: 0, viewer: 1 });
  });
});

void describe('lastSeenLabel', () => {
  void test('never, relative within a day, then a date', () => {
    const now = new Date(2026, 9, 23, 12, 0).getTime();
    assert.equal(lastSeenLabel(null, now).text, 'Never signed in');
    // A server from before LAI-981 sends no field; that must not throw.
    assert.equal(lastSeenLabel(undefined, now).text, 'Never signed in');
    assert.equal(lastSeenLabel(now - 3 * 3_600_000, now).text, '3 h ago');
    assert.match(lastSeenLabel(now - 9 * 86_400_000, now).text, /14 Oct/);
  });
});

void describe('parseEmails', () => {
  void test('splits on commas, semicolons, spaces and lines; dedupes case-insensitively', () => {
    const parsed = parseEmails('a@x.test, B@x.test;\nb@x.test  c@x.test\n\n');
    assert.deepEqual(parsed.valid, ['a@x.test', 'B@x.test', 'c@x.test']);
    assert.deepEqual(parsed.invalid, []);
  });

  void test('keeps what is not an address so the reader is told, rather than dropping it', () => {
    const parsed = parseEmails('ok@x.test, not-an-email, @x.test');
    assert.deepEqual(parsed.valid, ['ok@x.test']);
    assert.deepEqual(parsed.invalid, ['not-an-email', '@x.test']);
  });

  void test('a name-and-address paste yields the address', () => {
    assert.deepEqual(parseEmails('Ada Lovelace <ada@x.test>').valid, ['ada@x.test']);
  });
});

void describe('newOwnerCandidates', () => {
  void test('active admins and members other than the reader — never a viewer', () => {
    const candidates = newOwnerCandidates(PEOPLE, 'ada');
    assert.deepEqual(ids(candidates), ['pri', 'tom', 'zed']);
  });
});

void describe('spaceRolesFor', () => {
  void test('an org viewer may be invited into a space only as a viewer', () => {
    assert.deepEqual(spaceRolesFor('viewer'), ['viewer']);
    assert.deepEqual(spaceRolesFor('member'), ['lead', 'member', 'viewer']);
  });
});
