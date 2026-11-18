import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PresencePerson } from '../../../src/api/presence.ts';
import {
  diffHere,
  hereAnnouncement,
  hereFaces,
  hereLabel,
  hereStatusText,
} from '../../../src/components/shell/here-derive.ts';

/** The top bar's who's here (LAI-1348): the faces, the words, and what changed. */

const NOW = Date.UTC(2026, 10, 19, 9);
const MIN = 60_000;

const person = (user_id: string, status: PresencePerson['status'], ago = MIN): PresencePerson => ({
  user_id,
  name: user_id.toUpperCase(),
  status,
  last_seen: NOW - ago,
  last_seen_via: 'board',
});

void describe('hereFaces and hereLabel', () => {
  void test('all fit: every face, no +N, each named with its status', () => {
    const people = [person('ada', 'online'), person('bea', 'away')];
    assert.deepEqual(
      hereFaces(people, 3).shown.map((p) => p.user_id),
      ['ada', 'bea'],
    );
    assert.equal(hereFaces(people, 3).extra, 0);
    assert.equal(hereLabel(people, 3), '2 people online or away: ADA, online; BEA, away');
  });

  void test('too many: the last place is the +N, which the label counts', () => {
    const people = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id, 'online'));
    const faces = hereFaces(people, 3);
    assert.deepEqual(
      faces.shown.map((p) => p.user_id),
      ['a', 'b'],
    );
    assert.equal(faces.extra, 3);
    assert.equal(hereLabel(people, 3), '5 people online or away: A, online; B, online; and 3 more');
    assert.equal(hereLabel([person('ada', 'away')], 3), '1 person online or away: ADA, away');
  });
});

void describe('hereStatusText', () => {
  void test('online now, or away for whole minutes, as Capacity says it', () => {
    assert.equal(hereStatusText(person('ada', 'online'), NOW), 'Online now');
    assert.equal(hereStatusText(person('bea', 'away', 11 * MIN + 40_000), NOW), 'Away · 11 min');
    assert.equal(hereStatusText(person('cal', 'away', 20_000), NOW), 'Away · 1 min');
  });
});

void describe('diffHere and hereAnnouncement', () => {
  void test('the first read changes nothing: the stack appears as it is', () => {
    const diff = diffHere(undefined, [person('ada', 'online')]);
    assert.deepEqual(diff, { arrived: [], left: [], changed: [] });
    assert.equal(hereAnnouncement(diff), '');
  });

  void test('arrivals, departures and a change of status, each said once', () => {
    const before = [person('ada', 'online'), person('bea', 'online'), person('cal', 'away')];
    const after = [person('ada', 'online'), person('bea', 'away'), person('dee', 'online')];
    const diff = diffHere(before, after);
    assert.deepEqual(
      diff.arrived.map((p) => p.user_id),
      ['dee'],
    );
    assert.deepEqual(
      diff.left.map((p) => p.user_id),
      ['cal'],
    );
    assert.deepEqual(
      diff.changed.map((p) => p.user_id),
      ['bea'],
    );
    assert.equal(hereAnnouncement(diff), 'DEE came online. BEA is away. CAL went offline.');
  });

  void test('nothing changed is nothing said', () => {
    const people = [person('ada', 'online')];
    assert.equal(hereAnnouncement(diffHere(people, people)), '');
  });
});
