/**
 * The app's one toast queue (LAI-1129), driven by a fake clock: when each
 * toast goes, what hover and focus do to that, what Undo does, and what gives
 * way when the stack is full. `ToastProvider.tsx` only aims one timer at
 * `nextDeadline` and draws the result; the rules live here.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EMPTY_QUEUE,
  INFO_MS,
  MAX_SHOWN,
  UNDO_MS,
  dismiss,
  expire,
  nextDeadline,
  pause,
  push,
  resume,
  secondsLeft,
  settleUndo,
  startUndo,
  type ToastQueue,
} from '../../../src/components/toast/toast-model.ts';

const T0 = 1_000_000;
const undo = (): Promise<string> => Promise.resolve('put back');

function shown(q: ToastQueue): string[] {
  return q.items.map((t) => t.text);
}

void describe('toast queue: timers', () => {
  void test('info goes after INFO_MS, an Undo toast after UNDO_MS (10s, as My day), an error never', () => {
    let q = push(EMPTY_QUEUE, { text: 'info' }, T0).queue;
    q = push(q, { text: 'undoable', tone: 'success', undo }, T0).queue;
    q = push(q, { text: 'broke', tone: 'error' }, T0).queue;
    assert.equal(UNDO_MS, 10_000);
    assert.equal(nextDeadline(q), T0 + INFO_MS);

    assert.deepEqual(shown(expire(q, T0 + INFO_MS - 1)), ['info', 'undoable', 'broke']);
    q = expire(q, T0 + INFO_MS);
    assert.deepEqual(shown(q), ['undoable', 'broke']);
    assert.equal(nextDeadline(q), T0 + UNDO_MS);
    q = expire(q, T0 + UNDO_MS);
    assert.deepEqual(shown(q), ['broke']);
    // The error persists: nothing is timed, and an hour later it is still there.
    assert.equal(nextDeadline(q), undefined);
    assert.deepEqual(shown(expire(q, T0 + 3_600_000)), ['broke']);
  });

  void test('an explicit duration is honoured, except by an error', () => {
    let q = push(EMPTY_QUEUE, { text: 'long', duration: 30_000 }, T0).queue;
    q = push(q, { text: 'err', tone: 'error', duration: 1 }, T0).queue;
    assert.equal(nextDeadline(q), T0 + 30_000);
    assert.deepEqual(shown(expire(q, T0 + 30_000)), ['err']);
  });

  void test('the countdown is whole seconds, rounded up, and absent for a persisting toast', () => {
    const q = push(EMPTY_QUEUE, { text: 'u', undo }, T0).queue;
    const item = q.items[0];
    assert.ok(item !== undefined);
    assert.equal(secondsLeft(item, T0), 10);
    assert.equal(secondsLeft(item, T0 + 1), 10);
    assert.equal(secondsLeft(item, T0 + 9_001), 1);
    assert.equal(secondsLeft(item, T0 + 20_000), 0);
    const err = push(EMPTY_QUEUE, { text: 'e', tone: 'error' }, T0).queue.items[0];
    assert.ok(err !== undefined);
    assert.equal(secondsLeft(err, T0), null);
  });
});

void describe('toast queue: pause on hover or focus', () => {
  void test('pausing holds every timer with the time it had left; resuming runs on from there', () => {
    let q = push(EMPTY_QUEUE, { text: 'u', undo }, T0).queue;
    q = pause(q, T0 + 4_000);
    assert.equal(q.paused, true);
    assert.equal(nextDeadline(q), undefined, 'a paused stack still has a running timer');
    // However long the pointer rests there, nothing goes.
    assert.deepEqual(shown(expire(q, T0 + 60_000)), ['u']);
    assert.equal(secondsLeft(q.items[0]!, T0 + 60_000), 6);
    // Resumed a minute later: the six seconds it had left, not a fresh ten.
    q = resume(q, T0 + 60_000);
    assert.equal(nextDeadline(q), T0 + 66_000);
    assert.deepEqual(shown(expire(q, T0 + 65_999)), ['u']);
    assert.deepEqual(shown(expire(q, T0 + 66_000)), []);
  });

  void test('a toast that arrives while paused waits too, and pause/resume twice changes nothing', () => {
    let q = pause(EMPTY_QUEUE, T0);
    q = push(q, { text: 'late' }, T0 + 100).queue;
    assert.equal(nextDeadline(q), undefined);
    assert.equal(pause(q, T0 + 9_999), q);
    q = resume(q, T0 + 2_000);
    assert.equal(nextDeadline(q), T0 + 2_000 + INFO_MS);
    assert.equal(resume(q, T0 + 9_999), q);
  });
});

void describe('toast queue: Undo', () => {
  void test('pressing Undo holds the toast while the server answers, then the same toast says the answer', () => {
    const pushed = push(
      EMPTY_QUEUE,
      { text: 'Removed Tomas.', tone: 'success', undo, mark: 'm' },
      T0,
    );
    let q = startUndo(pushed.queue, pushed.id, T0 + 9_000);
    assert.equal(q.items[0]?.undoing, true);
    // The server is slow: the toast must not time out under the person's click.
    assert.equal(nextDeadline(q), undefined);
    assert.deepEqual(shown(expire(q, T0 + 30_000)), ['Removed Tomas.']);
    // A resume while undoing does not restart its clock either.
    q = resume(pause(q, T0 + 30_000), T0 + 30_000);
    assert.equal(nextDeadline(q), undefined);

    q = settleUndo(q, pushed.id, { text: 'Tomas is back.', tone: 'success' }, T0 + 31_000);
    const item = q.items[0];
    assert.ok(item !== undefined);
    assert.equal(item.id, pushed.id, 'a new toast replaced it, so focus on it would be lost');
    assert.equal(item.text, 'Tomas is back.');
    assert.equal(item.undo, undefined, 'Undo is still offered after it ran');
    assert.equal(item.undoing, false);
    assert.equal(item.mark, 'm');
    assert.equal(nextDeadline(q), T0 + 31_000 + INFO_MS);
  });

  void test('an Undo the server refused persists as an error', () => {
    const pushed = push(EMPTY_QUEUE, { text: 'x', undo }, T0);
    let q = startUndo(pushed.queue, pushed.id, T0);
    q = settleUndo(q, pushed.id, { text: 'No.', tone: 'error' }, T0 + 1);
    assert.equal(q.items[0]?.tone, 'error');
    assert.equal(nextDeadline(q), undefined);
  });

  void test('Undo on a toast without one changes nothing', () => {
    const pushed = push(EMPTY_QUEUE, { text: 'plain' }, T0);
    const q = startUndo(pushed.queue, pushed.id, T0);
    assert.equal(q.items[0]?.undoing, false);
    assert.equal(nextDeadline(q), T0 + INFO_MS);
  });

  void test('the undo callback is the one passed in, untouched', async () => {
    let ran = 0;
    const mine = (): Promise<string> => {
      ran += 1;
      return Promise.resolve('done');
    };
    const q = push(EMPTY_QUEUE, { text: 'x', undo: mine }, T0).queue;
    assert.equal(await q.items[0]?.undo?.(), 'done');
    assert.equal(ran, 1);
  });
});

void describe('toast queue: the stack', () => {
  void test(`at most ${String(MAX_SHOWN)} show; the oldest non-error gives way, never an error`, () => {
    let q = push(EMPTY_QUEUE, { text: 'e1', tone: 'error' }, T0).queue;
    q = push(q, { text: 'a' }, T0).queue;
    q = push(q, { text: 'b' }, T0).queue;
    q = push(q, { text: 'c' }, T0).queue;
    assert.deepEqual(shown(q), ['e1', 'b', 'c']);
    q = push(q, { text: 'e2', tone: 'error' }, T0).queue;
    q = push(q, { text: 'e3', tone: 'error' }, T0).queue;
    assert.deepEqual(shown(q), ['e1', 'e2', 'e3']);
    // All errors: the oldest error goes, rather than the newest being lost.
    q = push(q, { text: 'e4', tone: 'error' }, T0).queue;
    assert.deepEqual(shown(q), ['e2', 'e3', 'e4']);
  });

  void test('dismiss removes exactly that toast; ids are unique and caller-allocated ids are kept', () => {
    const a = push(EMPTY_QUEUE, { text: 'a' }, T0);
    const b = push(a.queue, { text: 'b' }, T0);
    assert.notEqual(a.id, b.id);
    assert.deepEqual(shown(dismiss(b.queue, a.id)), ['b']);
    const c = push(b.queue, { text: 'c' }, T0, 42);
    assert.equal(c.id, 42);
    assert.equal(c.queue.items.at(-1)?.id, 42);
    assert.equal(push(c.queue, { text: 'd' }, T0).id, 43);
  });
});
