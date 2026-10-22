import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OrgUser } from '../../../../src/api/users.ts';
import {
  expiryLabel,
  filterPeople,
  inviteButtonLabel,
  invitedLabel,
  lastActive,
  nextSort,
  parseEmails,
  roleCounts,
  seatLine,
  sortPeople,
} from '../../../../src/routes/screens/organisation/people-derive.ts';

/**
 * The People tab's arithmetic (LAI-893): the words for last active, the
 * order of the table, the filters and the seat line, and the invite form's
 * reading of its field.
 */

const NOW = Date.parse('2026-10-22T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const person = (id: string, name: string, org_role: string, is_active = true): OrgUser => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  person('u1', 'Ada Lovelace', 'owner'),
  person('u2', 'Tomas Nel', 'member'),
  person('u3', 'Priya Raman', 'admin'),
  person('u4', 'Sam Okafor', 'viewer', false),
  person('u5', 'Bea Nkosi', 'member'),
];

void describe('lastActive — the design’s words for when someone was seen', () => {
  void test('online is Active now; a signal ages into minutes, hours, yesterday, days and weeks', () => {
    assert.deepEqual(lastActive({ status: 'online', last_seen: NOW }, true, true, NOW), {
      text: 'Active now',
      tone: 'now',
    });
    const seen = (ago: number) =>
      lastActive({ status: 'away', last_seen: NOW - ago }, true, true, NOW);
    assert.equal(seen(30_000).text, 'just now');
    assert.equal(seen(18 * MIN).text, '18m ago');
    assert.equal(seen(2 * HOUR).text, '2h ago');
    assert.equal(seen(30 * HOUR).text, 'Yesterday');
    assert.equal(seen(6 * DAY).text, '6d ago');
    assert.equal(seen(20 * DAY).text, '2w ago');
    assert.equal(seen(2 * HOUR).tone, 'recent');
    assert.equal(seen(6 * DAY).tone, 'muted');
  });

  void test('never seen says Never; presence off and capacity unread say so, never Never', () => {
    assert.equal(lastActive({ status: 'never', last_seen: null }, true, true, NOW).text, 'Never');
    const off = lastActive({ status: null, last_seen: null }, false, true, NOW);
    assert.equal(off.text, '—');
    assert.equal(off.note, 'Presence is off');
    const unread = lastActive(undefined, undefined, true, NOW);
    assert.equal(unread.text, '—');
    assert.match(unread.note ?? '', /could not be read/);
    assert.equal(lastActive(undefined, true, false, NOW).text, 'Deactivated');
  });
});

void describe('the order and the filters', () => {
  const seenAt = (id: string): number | null =>
    ({ u1: NOW, u2: NOW - DAY, u3: NOW - HOUR, u5: null })[id] ?? null;

  void test('the reader first, deactivated last, most recently seen between', () => {
    assert.deepEqual(
      sortPeople(PEOPLE, 'active', 'u2', seenAt).map((p) => p.id),
      ['u2', 'u1', 'u3', 'u5', 'u4'],
    );
  });

  void test('by name, and by role then name', () => {
    assert.deepEqual(
      sortPeople(PEOPLE, 'name', 'u1', seenAt).map((p) => p.name),
      ['Ada Lovelace', 'Bea Nkosi', 'Priya Raman', 'Tomas Nel', 'Sam Okafor'],
    );
    assert.deepEqual(
      sortPeople(PEOPLE, 'role', 'u5', seenAt).map((p) => p.id),
      ['u5', 'u1', 'u3', 'u2', 'u4'],
    );
    assert.equal(nextSort('active'), 'name');
    assert.equal(nextSort('role'), 'active');
  });

  void test('a filter by role, a search by name or email, case aside', () => {
    assert.deepEqual(
      filterPeople(PEOPLE, 'member', '').map((p) => p.id),
      ['u2', 'u5'],
    );
    assert.deepEqual(
      filterPeople(PEOPLE, 'all', 'U3@').map((p) => p.id),
      ['u3'],
    );
    assert.deepEqual(
      filterPeople(PEOPLE, 'all', 'nel').map((p) => p.id),
      ['u2'],
    );
    assert.deepEqual(filterPeople(PEOPLE, 'all', 'zzz'), []);
  });

  void test('the counts leave deactivated people out of their role, and the seat line says what the responses hold', () => {
    const invites = [{ id: 'i1' }, { id: 'i2' }] as never[];
    assert.deepEqual(roleCounts(PEOPLE, invites), {
      all: 5,
      owner: 1,
      admin: 1,
      member: 2,
      viewer: 0,
      pending: 2,
    });
    assert.equal(seatLine(PEOPLE, invites, false, true), '4 members · 1 admin · 2 pending invites');
    assert.equal(seatLine(PEOPLE, [], true, false), '4+ members · 1 admin');
  });
});

void describe('the invite dialog’s reading of its field', () => {
  void test('addresses split on commas, semicolons and whitespace, each once', () => {
    assert.deepEqual(parseEmails(' a@x.io, b@y.io;  A@x.io\nc@z.io '), [
      'a@x.io',
      'b@y.io',
      'c@z.io',
    ]);
    assert.deepEqual(parseEmails('nothing here'), []);
  });

  void test('the button says what it will do', () => {
    assert.equal(inviteButtonLabel(0), 'Create link');
    assert.equal(inviteButtonLabel(1), 'Send invite');
    assert.equal(inviteButtonLabel(3), 'Send 3 invites');
  });

  void test('an invite’s clock', () => {
    assert.equal(expiryLabel(NOW + 6 * DAY + HOUR, NOW), 'in 6 days');
    assert.equal(expiryLabel(NOW + DAY + HOUR, NOW), 'tomorrow');
    assert.equal(expiryLabel(NOW + HOUR, NOW), 'today');
    assert.equal(expiryLabel(NOW - 1, NOW), 'expired');
    assert.equal(invitedLabel(NOW - 10 * MIN, NOW), 'just now');
    assert.equal(invitedLabel(NOW - 3 * HOUR, NOW), '3h ago');
    assert.equal(invitedLabel(NOW - 2 * DAY, NOW), '2d ago');
  });
});
