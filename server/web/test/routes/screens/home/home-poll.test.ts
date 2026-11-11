/**
 * The Command Center's reads (LAI-1202): when they happen, and what a section
 * shows after each — kept rows on a failed re-read, absent on a `403`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../../../src/api/errors.ts';
import {
  ageLabel,
  isAbort,
  settle,
  startPolling,
  type PollDeps,
  type SectionState,
} from '../../../../src/routes/screens/home/home-poll.ts';

function fakeDeps() {
  let tick: (() => void) | undefined;
  let shown: (() => void) | undefined;
  let cleared = false;
  let unsubscribed = false;
  const state = { visible: true };
  const deps: PollDeps = {
    setTimer: (fn) => {
      tick = fn;
      return 'timer';
    },
    clearTimer: (handle) => {
      assert.equal(handle, 'timer');
      cleared = true;
    },
    visible: () => state.visible,
    onShown: (fn) => {
      shown = fn;
      return () => {
        unsubscribed = true;
      };
    },
  };
  return {
    deps,
    state,
    tick: () => {
      tick?.();
    },
    show: () => {
      shown?.();
    },
    stopped: () => cleared && unsubscribed,
  };
}

void describe('startPolling', () => {
  void test('reads at once, loudly; then quietly on each tick while shown', () => {
    const f = fakeDeps();
    const reads: boolean[] = [];
    startPolling((quiet) => reads.push(quiet), 60_000, f.deps);
    assert.deepEqual(reads, [false]);
    f.tick();
    f.tick();
    assert.deepEqual(reads, [false, true, true]);
  });

  void test('a hidden tab asks for nothing, and reads once when it is shown again', () => {
    const f = fakeDeps();
    const reads: boolean[] = [];
    startPolling((quiet) => reads.push(quiet), 60_000, f.deps);
    f.state.visible = false;
    f.tick();
    f.tick();
    assert.deepEqual(reads, [false], 'a hidden tab polled');
    f.state.visible = true;
    f.show();
    assert.deepEqual(reads, [false, true]);
  });

  void test('stop clears the timer and the visibility listener', () => {
    const f = fakeDeps();
    const stop = startPolling(() => undefined, 60_000, f.deps);
    assert.equal(f.stopped(), false);
    stop();
    assert.equal(f.stopped(), true);
  });
});

void describe('settle', () => {
  const LOADING: SectionState<number> = { status: 'loading' };

  void test('an answer is ready, and clears an earlier failure', () => {
    assert.deepEqual(settle(LOADING, { ok: true, data: 3, at: 10 }), {
      status: 'ready',
      data: 3,
      at: 10,
    });
    const stale: SectionState<number> = { status: 'ready', data: 1, at: 1, failed: 'down' };
    assert.deepEqual(settle(stale, { ok: true, data: 2, at: 20 }), {
      status: 'ready',
      data: 2,
      at: 20,
    });
  });

  void test('a failed first read is an error with the reason', () => {
    assert.deepEqual(settle(LOADING, { ok: false, cause: new Error('the database is locked') }), {
      status: 'error',
      message: 'the database is locked',
    });
  });

  void test('a failed re-read keeps the rows it had, marked with why', () => {
    const was: SectionState<number> = { status: 'ready', data: 7, at: 5 };
    assert.deepEqual(settle(was, { ok: false, cause: new Error('offline') }), {
      status: 'ready',
      data: 7,
      at: 5,
      failed: 'offline',
    });
  });

  void test('a 403 hides the section, whatever it showed before', () => {
    const refused = new ApiError('forbidden', 'no', 403);
    assert.deepEqual(settle(LOADING, { ok: false, cause: refused }), { status: 'forbidden' });
    assert.deepEqual(settle({ status: 'ready', data: 1, at: 1 }, { ok: false, cause: refused }), {
      status: 'forbidden',
    });
    // Any other refusal is an error, not an absence.
    assert.equal(
      settle(LOADING, { ok: false, cause: new ApiError('internal', 'boom', 500) }).status,
      'error',
    );
  });

  void test('isAbort tells the caller leaving from a failure', () => {
    assert.equal(isAbort(new DOMException('gone', 'AbortError')), true);
    assert.equal(isAbort(new Error('AbortError')), false);
  });
});

void describe('ageLabel', () => {
  void test('says how old, in the largest whole unit', () => {
    const now = 10 * 24 * 3_600_000;
    assert.equal(ageLabel(now - 20_000, now), 'just now');
    assert.equal(ageLabel(now - 3 * 60_000, now), '3 min ago');
    assert.equal(ageLabel(now - 2 * 3_600_000, now), '2 h ago');
    assert.equal(ageLabel(now - 4 * 24 * 3_600_000, now), '4 d ago');
    // A clock a little ahead of the server's is not "in the future".
    assert.equal(ageLabel(now + 5_000, now), 'just now');
  });
});
