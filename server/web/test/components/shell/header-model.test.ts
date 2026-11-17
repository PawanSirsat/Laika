/**
 * The app header's rules (LAI-1188): when an address is a view of somebody else, where "back to me"
 * goes, which views of a person a reader is offered (from the server's
 * permissions, never a role), who the People group finds, and when `/` is
 * the header search's. The browser half is `test/browser/header-search.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  backToMeHref,
  matchPeople,
  personTargets,
  personView,
  slashOpensSearch,
} from '../../../src/components/shell/header-model.ts';

const q = (text: string): URLSearchParams => new URLSearchParams(text);
void describe('a person view', () => {
  void test('My day’s ?user=, Work’s &person= and Time’s &member= name somebody else', () => {
    assert.deepEqual(personView('/my-day', q('user=u2'), 'u1'), { kind: 'my-day', userId: 'u2' });
    assert.deepEqual(personView('/organisation', q('tab=work&person=u2'), 'u1'), {
      kind: 'work',
      userId: 'u2',
    });
    assert.deepEqual(personView('/insights', q('tab=time&member=u2'), 'u1'), {
      kind: 'time',
      userId: 'u2',
    });
  });

  void test('the reader, nobody, unassigned, several people, or another tab is not one', () => {
    assert.equal(personView('/my-day', q(''), 'u1'), undefined);
    assert.equal(personView('/my-day', q('user=u1'), 'u1'), undefined);
    assert.equal(personView('/my-day', q('user='), 'u1'), undefined);
    assert.equal(personView('/organisation', q('tab=work&person=none'), 'u1'), undefined);
    assert.equal(personView('/organisation', q('tab=people&person=u2'), 'u1'), undefined);
    assert.equal(personView('/insights', q('tab=time&member=u2,u3'), 'u1'), undefined);
    assert.equal(personView('/insights', q('tab=usage&member=u2'), 'u1'), undefined);
    assert.equal(personView('/people', q('user=u2'), 'u1'), undefined);
  });

  void test('back to me is the same screen as the reader’s own, other filters kept', () => {
    const day = personView('/my-day', q('user=u2&day=2026-11-16'), 'u1');
    assert.ok(day !== undefined);
    assert.equal(
      backToMeHref(day, '/my-day', q('user=u2&day=2026-11-16'), 'u1'),
      '/my-day?day=2026-11-16',
    );
    const work = personView('/organisation', q('tab=work&person=u2&status=todo'), 'u1');
    assert.ok(work !== undefined);
    assert.equal(
      backToMeHref(work, '/organisation', q('tab=work&person=u2&status=todo'), 'u1'),
      '/organisation?tab=work&person=u1&status=todo',
    );
    const time = personView('/insights', q('tab=time&member=u2'), 'u1');
    assert.ok(time !== undefined);
    assert.equal(
      backToMeHref(time, '/insights', q('tab=time&member=u2'), 'u1'),
      '/insights?tab=time&member=u1',
    );
  });
});

void describe('the views of a person a reader is offered', () => {
  const holder =
    (...granted: string[]) =>
    (permission: string): boolean =>
      granted.includes(permission);
  const ids = (holds: (p: string) => boolean, path = '/organisation', params = q('')): string[] =>
    personTargets('u2', holds, path, params).map((t) => t.id);

  void test('an owner or admin with the default grants gets all four, each with the person in it', () => {
    const all = holder('profile.read', 'people.analytics.read', 'time.report.read');
    assert.deepEqual(ids(all), ['profile', 'my-day', 'work', 'time']);
    assert.deepEqual(
      personTargets('u2', all, '/organisation', q('')).map((t) => t.href),
      [
        '/people?user=u2',
        '/my-day?user=u2',
        '/organisation?tab=work&person=u2',
        '/insights?tab=time&member=u2',
      ],
    );
  });

  void test('each view follows its own permission, and nothing is offered without one', () => {
    assert.deepEqual(ids(holder()), []);
    assert.deepEqual(ids(holder('profile.read')), ['profile']);
    assert.deepEqual(ids(holder('people.analytics.read')), ['my-day', 'work']);
    assert.deepEqual(ids(holder('time.report.read')), ['time']);
  });

  void test('the screen the reader is on comes first', () => {
    const all = holder('profile.read', 'people.analytics.read', 'time.report.read');
    assert.equal(ids(all, '/my-day')[0], 'my-day');
    assert.equal(ids(all, '/organisation', q('tab=work'))[0], 'work');
    assert.equal(ids(all, '/insights', q('tab=time'))[0], 'time');
  });

  void test('an id is escaped into each address', () => {
    const all = holder('profile.read');
    assert.equal(personTargets('a b', all, '/', q(''))[0]?.href, '/people?user=a%20b');
  });
});

void describe('the People group', () => {
  const people = [
    { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com' },
    { id: 'u3', name: 'Alan Turing', email: 'alan@bletchley.example' },
  ];

  void test('matches every word against name and email, and leaves the reader out', () => {
    assert.deepEqual(
      matchPeople(people, 'grace', 'u1').map((p) => p.id),
      ['u2'],
    );
    assert.deepEqual(
      matchPeople(people, 'bletchley', 'u1').map((p) => p.id),
      ['u3'],
    );
    assert.deepEqual(
      matchPeople(people, 'a', 'u1').map((p) => p.id),
      ['u2', 'u3'],
    );
    assert.deepEqual(matchPeople(people, 'ada', 'u1'), []);
    assert.deepEqual(matchPeople(people, '   ', 'u1'), []);
  });
});

void describe('who owns /', () => {
  void test('a screen with its own search field keeps it; anywhere else it is the header’s', () => {
    assert.equal(slashOpensSearch({ querySelector: () => null }), true);
    const field = {} as Element;
    assert.equal(
      slashOpensSearch({
        querySelector: (selector: string) =>
          selector === '[aria-keyshortcuts="/"]' ? field : null,
      } as Pick<Document, 'querySelector'>),
      false,
    );
  });
});
