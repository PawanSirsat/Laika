/**
 * The HR system and Holidays facts' words and lists (D-149, LAI-1182): pure,
 * with `now` passed in, so no fixture here depends on the day it runs.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { HrPerson, HrSource, OrgHoliday } from '../../../../src/api/hr.ts';
import {
  companyAddress,
  connectedLine,
  coversOf,
  HOLIDAY_COVERS,
  countsLine,
  holidayDayLabel,
  holidaysByYear,
  holidayWindow,
  initialChoice,
  isHttpsAddress,
  localDay,
  mappingChanges,
  NOT_ON_LAIKA,
  peopleToReview,
  heldBy,
  twoFactorMethodName,
  twoFactorWords,
  withHoliday,
} from '../../../../src/routes/screens/organisation/hr-derive.ts';

const person = (
  external_id: string,
  name: string,
  matched_by: HrPerson['matched_by'],
  user: HrPerson['user'] = null,
): HrPerson => ({ external_id, name, matched_by, user });

const holiday = (
  id: string,
  day: string,
  label: string,
  source: OrgHoliday['source'] = 'clan',
) => ({
  id,
  day,
  label,
  source,
  everyone: true,
});

void describe('the Holidays window', () => {
  void test('this year and next in the reader’s calendar: 1 Jan to 31 Dec the year after', () => {
    const now = new Date(2026, 10, 13, 9, 30).getTime();
    assert.deepEqual(holidayWindow(now), {
      from: '2026-01-01',
      to: '2027-12-31',
      years: [2026, 2027],
    });
    // The last minute of a year is still that year, in local time.
    assert.deepEqual(holidayWindow(new Date(2026, 11, 31, 23, 59).getTime()).years, [2026, 2027]);
    assert.deepEqual(holidayWindow(new Date(2027, 0, 1, 0, 1).getTime()).years, [2027, 2028]);
  });

  void test('a day reads as its calendar date, whatever the zone', () => {
    assert.equal(holidayDayLabel('2026-09-24'), 'Thu 24 Sep');
    assert.equal(holidayDayLabel('2027-01-01'), 'Fri 1 Jan');
    assert.equal(holidayDayLabel('not a day'), 'not a day');
    assert.equal(localDay(new Date(2026, 2, 5, 23, 59).getTime()), '2026-03-05');
  });

  void test('by year, by day then name; a year with none is kept, empty', () => {
    const groups = holidaysByYear(
      [
        holiday('c', '2026-12-25', 'Christmas Day'),
        holiday('a', '2026-09-24', 'Heritage Day'),
        holiday('b', '2026-09-24', 'Company day', 'manual'),
        holiday('z', '2028-01-01', 'Outside the window'),
      ],
      [2026, 2027],
    );
    assert.deepEqual(
      groups.map((g) => [g.year, g.holidays.map((h) => h.id)]),
      [
        [2026, ['b', 'a', 'c']],
        [2027, []],
      ],
    );
  });

  void test('whom it covers: a manual one everyone, a Clan one Clan staff or some of them', () => {
    assert.equal(coversOf({ source: 'manual', everyone: true }), 'everyone');
    assert.equal(coversOf({ source: 'clan', everyone: true }), 'clan_staff');
    assert.equal(coversOf({ source: 'clan', everyone: false }), 'some');
    assert.deepEqual(
      (['everyone', 'clan_staff', 'some'] as const).map((c) => HOLIDAY_COVERS[c].words),
      ['Everyone', 'Clan staff', 'Some people'],
    );
  });

  void test('an added holiday lands in order, once', () => {
    const list = [
      holiday('a', '2026-03-21', 'Human Rights Day'),
      holiday('c', '2026-12-25', 'Xmas'),
    ];
    const added = holiday('b', '2026-06-16', 'Youth Day', 'manual');
    assert.deepEqual(
      withHoliday(withHoliday(list, added), added).map((h) => h.id),
      ['a', 'b', 'c'],
    );
  });
});

const view = (patch: Partial<HrSource>): HrSource => ({
  status: 'connected',
  provider: 'clan',
  base_url: 'https://codesage.clan.biz/api/v1',
  account_name: 'Forge',
  account_email: 'forge@codesage.test',
  token_last4: 'a1b2',
  token_expires_at: Date.UTC(2027, 6, 12),
  expiring_soon: false,
  sees_everyone: true,
  sees_departments: true,
  sync_every_minutes: 30,
  last_attempt_at: null,
  last_success_at: null,
  last_error: null,
  last_result: null,
  two_factor: null,
  people: [],
  ...patch,
});

void describe('the connection, in words', () => {
  void test('who it is, the token’s last four, and when it runs out', () => {
    assert.equal(
      connectedLine(view({})),
      'Connected as Forge (forge@codesage.test) · token …a1b2, renews by 12 Jul 2027',
    );
    // No end date known: no "renews by".
    assert.equal(
      connectedLine(view({ token_expires_at: null })),
      'Connected as Forge (forge@codesage.test) · token …a1b2',
    );
    assert.equal(
      connectedLine(view({ account_email: null, token_last4: null, token_expires_at: null })),
      'Connected as Forge',
    );
    assert.equal(
      connectedLine(view({ account_name: null, token_expires_at: null })),
      'Connected as forge@codesage.test · token …a1b2',
    );
  });

  void test('the last sync’s counts, singular where one', () => {
    const result = {
      people: 11,
      matched: 9,
      unmatched: 2,
      holidays: 12,
      leave_days: 340,
      created: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
    };
    assert.equal(countsLine(result), '12 holidays · 340 leave days · 9 of 11 people matched');
    assert.equal(
      countsLine({ ...result, holidays: 1, leave_days: 1, people: 1, matched: 1 }),
      '1 holiday · 1 leave day · 1 of 1 people matched',
    );
  });

  void test('how the code was sent', () => {
    assert.equal(twoFactorWords('email'), 'the code Clan emailed you');
    assert.equal(twoFactorWords('google_authenticator'), 'the code from your authenticator app');
    assert.equal(twoFactorWords('sms'), 'the code Clan texted you');
    assert.equal(twoFactorWords('carrier pigeon'), 'the code from carrier pigeon');
    assert.deepEqual(
      ['email', 'google_authenticator', 'sms', 'carrier pigeon'].map(twoFactorMethodName),
      ['Email', 'Authenticator app', 'Text message', 'carrier pigeon'],
    );
  });

  void test('the company address, without the API path the server keeps', () => {
    assert.equal(companyAddress('https://codesage.clan.biz/api/v1'), 'https://codesage.clan.biz');
    assert.equal(companyAddress('https://codesage.clan.biz/api/v1/'), 'https://codesage.clan.biz');
    assert.equal(companyAddress('https://codesage.clan.biz'), 'https://codesage.clan.biz');
  });

  void test('the address must be https', () => {
    assert.equal(isHttpsAddress('https://acme.clan.biz'), true);
    assert.equal(isHttpsAddress('  https://acme.clan.biz/  '), true);
    assert.equal(isHttpsAddress('http://acme.clan.biz'), false);
    assert.equal(isHttpsAddress('acme.clan.biz'), false);
    assert.equal(isHttpsAddress(''), false);
  });
});

void describe('the people an owner maps', () => {
  const grace = person('2', 'Grace Clan', 'none');
  const linus = person('3', 'Linus Clan', 'owner', { id: 'u3', name: 'Linus' });
  const contractor = person('4', 'Contractor', 'owner');
  const people = [
    person('1', 'Ada Clan', 'email', { id: 'u1', name: 'Ada' }),
    grace,
    linus,
    contractor,
  ];

  void test('only the unmatched and the owner-mapped are offered', () => {
    assert.deepEqual(
      peopleToReview(people).map((p) => p.external_id),
      ['2', '3', '4'],
    );
  });

  void test('a row starts as the server holds it: nothing, a member, or Not on Laika', () => {
    assert.equal(initialChoice(grace), '');
    assert.equal(initialChoice(linus), 'u3');
    assert.equal(initialChoice(contractor), NOT_ON_LAIKA);
  });

  void test('only a changed row is sent; Not on Laika is null', () => {
    assert.deepEqual(mappingChanges(people, {}), []);
    assert.deepEqual(
      mappingChanges(people, {
        '2': 'u2',
        '3': 'u3', // unchanged
        '4': 'u4',
      }),
      [
        { external_id: '2', user_id: 'u2' },
        { external_id: '4', user_id: 'u4' },
      ],
    );
    assert.deepEqual(mappingChanges(people, { '3': NOT_ON_LAIKA, '2': '' }), [
      { external_id: '3', user_id: null },
    ]);
  });

  void test('who holds each member: an owner’s word and this form’s choices lock, email does not', () => {
    // As the server holds it, seen from Grace's row: Ada by email, Linus by an owner.
    assert.deepEqual(
      [...heldBy(people, {}, '2')],
      [
        ['u1', { name: 'Ada Clan', locked: false }],
        ['u3', { name: 'Linus Clan', locked: true }],
      ],
    );
    // A row never holds against itself.
    assert.deepEqual([...heldBy(people, {}, '3')], [['u1', { name: 'Ada Clan', locked: false }]]);
    // Linus moved to Not on Laika frees u3; the Contractor chose u4 here and holds it.
    assert.deepEqual(
      [...heldBy(people, { '3': NOT_ON_LAIKA, '4': 'u4' }, '2')],
      [
        ['u1', { name: 'Ada Clan', locked: false }],
        ['u4', { name: 'Contractor', locked: true }],
      ],
    );
  });
});
