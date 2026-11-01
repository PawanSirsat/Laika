/**
 * Agent selections in flight, one per task, and every one ends (LAI-538
 * review, rounds 3 and 4). A fake clock throughout: nothing here waits for
 * real time.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  abortReason,
  AGENT_SAVE_DEADLINE_MS,
  beginAgentWrite,
  endAgentWrite,
  isAgentWriteOpen,
  isAgentWriteUncertain,
  readDeadline,
  resetAgentWrites,
  subscribeAgentWrites,
  type Timers,
} from '../../src/api/agent-writes.ts';

/** Timers that fire only when the test advances them. */
function fakeClock() {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  const timers: Timers = {
    setTimeout: (run, ms) => {
      next += 1;
      due.set(next, { at: now + ms, run });
      return next;
    },
    clearTimeout: (handle) => {
      due.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...due]) {
      if (timer.at <= now) {
        due.delete(id);
        timer.run();
      }
    }
  };
  return { timers, advance, pending: () => due.size };
}

afterEach(() => {
  resetAgentWrites();
});

void describe('one write per task', () => {
  void test('a second write on the same task is refused while the first is open; another task is not', () => {
    const clock = fakeClock();
    const first = beginAgentWrite('t1', clock.timers);
    assert.ok(first !== undefined);
    assert.equal(isAgentWriteOpen('t1'), true);
    assert.equal(beginAgentWrite('t1', clock.timers), undefined);
    assert.ok(beginAgentWrite('t2', clock.timers) !== undefined);
  });

  void test('only the token that opened a record may end it', () => {
    const clock = fakeClock();
    const old = beginAgentWrite('t1', clock.timers);
    assert.ok(old !== undefined);
    endAgentWrite('t1', old.token);
    const newer = beginAgentWrite('t1', clock.timers);
    assert.ok(newer !== undefined);
    // The old request's cleanup, arriving late, must not clear the newer one.
    endAgentWrite('t1', old.token);
    assert.equal(isAgentWriteOpen('t1'), true);
    endAgentWrite('t1', newer.token);
    assert.equal(isAgentWriteOpen('t1'), false);
    assert.equal(clock.pending(), 0, 'a settled write left its deadline running');
  });
});

void describe('every record ends', () => {
  void test('the deadline aborts the request with "deadline", and the record stays until the row reconciles', () => {
    const clock = fakeClock();
    const ticket = beginAgentWrite('t1', clock.timers);
    assert.ok(ticket !== undefined);
    clock.advance(AGENT_SAVE_DEADLINE_MS - 1);
    assert.equal(ticket.signal.aborted, false);
    clock.advance(1);
    assert.equal(abortReason(ticket.signal), 'deadline');
    // Uncertain: the row reads the task back before letting the next write go.
    assert.equal(isAgentWriteOpen('t1'), true);
    endAgentWrite('t1', ticket.token);
    assert.equal(isAgentWriteOpen('t1'), false);
  });

  void test('an outcome nobody could check is marked, and the next write clears the mark', () => {
    const clock = fakeClock();
    const ticket = beginAgentWrite('t1', clock.timers);
    assert.ok(ticket !== undefined);
    endAgentWrite('t1', ticket.token, true);
    assert.equal(isAgentWriteOpen('t1'), false);
    assert.equal(isAgentWriteUncertain('t1'), true);
    assert.ok(beginAgentWrite('t1', clock.timers) !== undefined);
    assert.equal(isAgentWriteUncertain('t1'), false);
  });

  void test('a session reset aborts every write with "reset" and drops every record and mark', () => {
    const clock = fakeClock();
    const a = beginAgentWrite('t1', clock.timers);
    const b = beginAgentWrite('t2', clock.timers);
    assert.ok(a !== undefined && b !== undefined);
    endAgentWrite('t2', b.token, true);
    let heard = 0;
    const stop = subscribeAgentWrites(() => {
      heard += 1;
    });
    resetAgentWrites();
    stop();
    assert.equal(abortReason(a.signal), 'reset');
    assert.equal(isAgentWriteOpen('t1'), false);
    assert.equal(isAgentWriteUncertain('t2'), false);
    assert.equal(heard, 1);
    assert.equal(clock.pending(), 0, 'a reset left a deadline running');
    // A write after the reset is not blocked by anything from before it.
    assert.ok(beginAgentWrite('t1', clock.timers) !== undefined);
  });

  void test('a follow-up read has its own deadline, cancelled once it answers', () => {
    const clock = fakeClock();
    const read = readDeadline(clock.timers);
    clock.advance(AGENT_SAVE_DEADLINE_MS);
    assert.equal(abortReason(read.signal), 'deadline');
    const answered = readDeadline(clock.timers);
    answered.cancel();
    clock.advance(AGENT_SAVE_DEADLINE_MS);
    assert.equal(answered.signal.aborted, false);
  });
});

void describe('the session reset is wired', () => {
  void test('setStoreUser drops the agent writes when the user changes', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../src/api/store.ts', import.meta.url), 'utf8');
    const body = /export function setStoreUser[\s\S]*?\n}/.exec(source)?.[0] ?? '';
    assert.match(body, /resetAgentWrites\(\)/);
  });
});
