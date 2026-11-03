/** `src/routes/screens/task/reveal-finish.ts` — the panel asks, the feed's card answers (LAI-1122). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  REVEAL_FINISH_EVENT,
  revealFinish,
  roundOf,
} from '../../../../src/routes/screens/task/reveal-finish.ts';

void describe('revealFinish', () => {
  void test('carries the round, and says whether a card took it', () => {
    const target = new EventTarget();
    const seen: (number | undefined)[] = [];
    target.addEventListener(REVEAL_FINISH_EVENT, (event) => {
      seen.push(roundOf(event));
      if (roundOf(event) === 2) event.preventDefault();
    });
    assert.equal(revealFinish(2, target), true);
    assert.equal(revealFinish(3, target), false);
    assert.deepEqual(seen, [2, 3]);
  });

  void test('reads no round from an event that is not a reveal', () => {
    assert.equal(roundOf(new Event(REVEAL_FINISH_EVENT)), undefined);
  });
});
