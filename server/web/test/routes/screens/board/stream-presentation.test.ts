/**
 * `src/routes/screens/board/stream-presentation.ts` — what the board says about
 * the stream (LAI-224).
 *
 * The defect this guards against is a *collapse*: `EventSource` funnels every
 * failure through one `onerror` with no status, LAI-078 therefore called all of
 * them "dropped", and a `403` rendered as *"Can't reach localhost:3370 ·
 * attempt 1"* — permanently, since no second error ever arrives to move it on —
 * directly above the board's own correct explanation that it was a permission
 * problem. Two states, one of them alarming and wrong.
 *
 * Measured in a real browser against this server: a `403` fires **one** error
 * with `readyState` CLOSED and never retries, while a killed server fires one
 * per attempt with `readyState` CONNECTING. So the two really are different
 * states, and these tests fail if they are ever described as one.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  showsUnreachableBanner,
  streamEmptyNote,
  streamPillLabel,
} from '../../../../src/routes/screens/board/stream-presentation.ts';
import type { StreamStatus } from '../../../../src/api/use-events.ts';

/** Every state the stream can be in. */
const ALL: readonly StreamStatus[] = ['connecting', 'live', 'dropped', 'refused'];

void describe('the unreachable banner is shown only when it is true', () => {
  void test('a drop shows it — the browser is retrying and it will resume', () => {
    assert.equal(showsUnreachableBanner('dropped'), true);
  });

  void test('a refusal does not — the instance answered, it did not fail', () => {
    // The whole of LAI-224. The server replied `403`; calling that unreachable
    // is false, and it sits on screen for ever because nothing follows it.
    assert.equal(showsUnreachableBanner('refused'), false);
  });

  void test('a refusal and a drop are not described the same way', () => {
    // The assertion that fails if the two collapse back into one state. Each
    // test above would still pass against a function that ignored its argument.
    assert.notEqual(
      showsUnreachableBanner('refused'),
      showsUnreachableBanner('dropped'),
      'a refused stream and a dropped one produce the same banner decision',
    );
  });

  void test('a working stream shows no banner', () => {
    assert.equal(showsUnreachableBanner('live'), false);
    assert.equal(showsUnreachableBanner('connecting'), false);
  });

  void test('exactly one state claims the instance is unreachable', () => {
    const claiming = ALL.filter((s) => showsUnreachableBanner(s));
    assert.deepEqual(claiming, ['dropped'], 'more than one state banners as unreachable');
  });
});

void describe('the pill never promises a reconnection that is not coming', () => {
  void test('live reads as the design has it', () => {
    assert.equal(streamPillLabel('live'), 'LIVE · SSE');
  });

  void test('a drop reads as reconnecting, because it is', () => {
    assert.equal(streamPillLabel('dropped'), 'RECONNECTING');
  });

  void test('a refusal does not read as reconnecting', () => {
    // The browser has closed the connection and will not open it again. A pill
    // that says RECONNECTING is a promise nothing intends to keep.
    assert.notEqual(streamPillLabel('refused'), 'RECONNECTING');
  });

  void test('every state has its own label and none is empty', () => {
    for (const status of ALL) {
      assert.ok(streamPillLabel(status).length > 0, `${status} has no label`);
    }
    assert.notEqual(streamPillLabel('refused'), streamPillLabel('dropped'));
  });
});

void describe('the rail does not say it is waiting for something that is not coming', () => {
  void test('a refusal says the updates are off, not that it is waiting', () => {
    const note = streamEmptyNote('refused');
    assert.ok(!note.includes('Waiting'), 'a refused stream claims to be waiting');
    assert.notEqual(note, streamEmptyNote('dropped'));
  });

  void test('a drop still says it is waiting, because it is', () => {
    assert.ok(streamEmptyNote('dropped').includes('Waiting'));
  });

  void test('live says it is connected', () => {
    assert.ok(streamEmptyNote('live').includes('Connected'));
  });
});
