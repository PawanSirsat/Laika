import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PresencePeopleView } from '../../src/api/presence.ts';
import {
  createPresencePeopleStore,
  PRESENCE_PEOPLE_POLL_MS,
} from '../../src/api/use-presence-people.ts';
import type { PollerEnvironment } from '../../src/api/use-polled.ts';

/**
 * One poll of `/presence/people` for the whole page (LAI-1349): the first
 * subscriber starts it, every other shares it, the last stops it — and the
 * statuses map is the same object until the answer changes.
 */

function fakeEnv() {
  const timers = new Set<() => void>();
  const env: PollerEnvironment = {
    now: () => 0,
    every: (_ms, run) => {
      timers.add(run);
      return () => {
        timers.delete(run);
      };
    },
    hidden: () => false,
    onReturn: () => () => undefined,
  };
  return { env, timers, tick: () => [...timers].forEach((run) => run()) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const ANSWER: PresencePeopleView = {
  enabled: true,
  people: [
    { user_id: 'u1', name: 'Ada', status: 'online', last_seen: 1, last_seen_via: 'board' },
    { user_id: 'u2', name: 'Bea', status: 'away', last_seen: 1, last_seen_via: 'web' },
  ],
};

void describe('createPresencePeopleStore', () => {
  void test('one read for many subscribers, one timer, stopped with the last', async () => {
    let reads = 0;
    const { env, timers, tick } = fakeEnv();
    const store = createPresencePeopleStore(() => {
      reads += 1;
      return Promise.resolve(ANSWER);
    }, env);

    const off1 = store.subscribe(() => undefined);
    const off2 = store.subscribe(() => undefined);
    const off3 = store.subscribe(() => undefined);
    await flush();
    assert.equal(reads, 1, 'each subscriber read on its own');
    assert.equal(timers.size, 1);
    tick();
    await flush();
    assert.equal(reads, 2);

    off1();
    off2();
    assert.equal(timers.size, 1, 'stopped while someone still listens');
    off3();
    assert.equal(timers.size, 0, 'kept polling with nobody listening');
    assert.equal(PRESENCE_PEOPLE_POLL_MS, 30_000);
  });

  void test('statuses by user id, the same map until the answer changes; none while off', async () => {
    let answer: PresencePeopleView = ANSWER;
    const { env, tick } = fakeEnv();
    const store = createPresencePeopleStore(() => Promise.resolve(answer), env);
    assert.equal(store.statuses(), undefined, 'a status before any answer');

    const off = store.subscribe(() => undefined);
    await flush();
    const first = store.statuses();
    assert.deepEqual(
      [...(first ?? new Map())],
      [
        ['u1', 'online'],
        ['u2', 'away'],
      ],
    );
    assert.equal(store.statuses(), first, 'a new map for the same answer');

    answer = { enabled: false, people: [] };
    tick();
    await flush();
    assert.equal(store.statuses(), undefined, 'rings while presence is off');
    off();
  });
});
