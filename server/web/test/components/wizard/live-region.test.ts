/**
 * The throttled live region (LAI-1048, plan §A3), on a fake clock: at most one
 * message per gap, the newest one wins, and a repeat is not news.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createAnnouncer,
  type AnnouncerClock,
} from '../../../src/components/wizard/live-region.ts';

function fakeClock() {
  let now = 0;
  let pending: { run: () => void; at: number } | undefined;
  let cleared = 0;
  const clock: AnnouncerClock = {
    now: () => now,
    setTimer: (run, ms) => {
      pending = { run, at: now + ms };
      return pending;
    },
    clearTimer: (handle) => {
      if (handle === pending) pending = undefined;
      cleared += 1;
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      if (pending !== undefined && pending.at <= now) {
        const { run } = pending;
        pending = undefined;
        run();
      }
    },
    get waiting() {
      return pending !== undefined;
    },
    get cleared() {
      return cleared;
    },
  };
}

void describe('createAnnouncer', () => {
  void test('the first message is said at once', () => {
    const said: string[] = [];
    const { clock } = fakeClock();
    createAnnouncer((m) => said.push(m), 1000, clock).announce('one');
    assert.deepEqual(said, ['one']);
  });

  void test('inside the gap, only the newest waiting message is said, once the gap ends', () => {
    const said: string[] = [];
    const t = fakeClock();
    const a = createAnnouncer((m) => said.push(m), 1000, t.clock);
    a.announce('one');
    t.advance(100);
    a.announce('two');
    a.announce('three');
    assert.deepEqual(said, ['one'], 'a second message spoke inside the gap');
    t.advance(899);
    assert.deepEqual(said, ['one']);
    t.advance(1);
    assert.deepEqual(said, ['one', 'three']);
  });

  void test('after the gap a message is said at once again', () => {
    const said: string[] = [];
    const t = fakeClock();
    const a = createAnnouncer((m) => said.push(m), 1000, t.clock);
    a.announce('one');
    t.advance(1000);
    a.announce('two');
    assert.deepEqual(said, ['one', 'two']);
    assert.equal(t.waiting, false);
  });

  void test('the same message twice in a row is said once', () => {
    const said: string[] = [];
    const t = fakeClock();
    const a = createAnnouncer((m) => said.push(m), 1000, t.clock);
    a.announce('same');
    t.advance(5000);
    a.announce('same');
    t.advance(5000);
    a.announce('same');
    assert.deepEqual(said, ['same']);
  });

  void test('dispose drops what is waiting and clears its timer', () => {
    const said: string[] = [];
    const t = fakeClock();
    const a = createAnnouncer((m) => said.push(m), 1000, t.clock);
    a.announce('one');
    a.announce('two');
    a.dispose();
    assert.equal(t.cleared, 1);
    t.advance(5000);
    assert.deepEqual(said, ['one']);
  });
});
