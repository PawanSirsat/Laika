/**
 * The state kit's words for a failed read (LAI-1207): `errorCopy`,
 * `safeServerMessage` and `staleCopy`, every branch.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, NetworkError } from '../../src/api/errors.ts';
import { errorCopy, safeServerMessage, staleCopy } from '../../src/components/error-copy.ts';

const api = (code: ConstructorParameters<typeof ApiError>[0], message: string, id?: string) =>
  new ApiError(code, message, 400, null, id);

void describe('safeServerMessage', () => {
  void test('shows a sentence written for people', () => {
    assert.equal(
      safeServerMessage(api('conflict', 'A column with that name already exists.')),
      'A column with that name already exists.',
    );
  });

  void test('hides an internal error’s message — it describes the server, not the reader’s problem', () => {
    assert.equal(safeServerMessage(api('internal', 'SQLITE_BUSY: database is locked')), undefined);
  });

  void test('hides a trace, a page of HTML, a dump and the client’s own stand-in', () => {
    assert.equal(safeServerMessage(api('conflict', 'Error\n    at foo (x.ts:1)')), undefined);
    assert.equal(safeServerMessage(api('conflict', '<html><body>502</body></html>')), undefined);
    assert.equal(safeServerMessage(api('conflict', 'x'.repeat(241))), undefined);
    assert.equal(safeServerMessage(api('conflict', 'Request failed with status 409.')), undefined);
    assert.equal(safeServerMessage(api('conflict', '   ')), undefined);
  });

  void test('keeps a message right at the length limit', () => {
    assert.equal(safeServerMessage(api('conflict', 'y'.repeat(240))), 'y'.repeat(240));
  });
});

void describe('errorCopy', () => {
  void test('names what failed, with the verb the caller was doing', () => {
    assert.equal(errorCopy(new Error('x'), 'members').title, 'Couldn’t load members');
    assert.equal(errorCopy(new Error('x'), 'the column', 'save').title, 'Couldn’t save the column');
  });

  void test('an unreachable instance is offline and worth retrying', () => {
    const copy = errorCopy(new NetworkError(new TypeError('fetch failed')), 'tasks');
    assert.equal(copy.kind, 'offline');
    assert.equal(copy.retryable, true);
    assert.match(copy.why, /didn’t answer/);
  });

  void test('a refusal shows the server’s words and offers no retry', () => {
    const copy = errorCopy(api('conflict', 'That name is taken.'), 'the column', 'save');
    assert.equal(copy.why, 'That name is taken.');
    assert.equal(copy.retryable, false);
    assert.equal(copy.kind, 'server');
  });

  void test('a 500 hides its message, keeps the request id, and is retryable', () => {
    const copy = errorCopy(api('internal', 'stack goes here', 'req-1'), 'members');
    assert.equal(copy.why, 'Laika hit a problem on its side. Trying again usually clears it.');
    assert.equal(copy.requestId, 'req-1');
    assert.equal(copy.retryable, true);
  });

  void test('each code with nothing safe to say gets its own reason', () => {
    assert.match(errorCopy(api('rate_limited', ''), 'x').why, /Too many requests/);
    assert.match(errorCopy(api('not_found', ''), 'x').why, /moved or deleted/);
    assert.match(errorCopy(api('unauthorized', ''), 'x').why, /session may have ended/);
    assert.equal(errorCopy(api('unprocessable', ''), 'x').why, 'The request was refused.');
  });

  void test('something that is not an API error is still retryable, not silent', () => {
    const copy = errorCopy('boom', 'tasks');
    assert.equal(copy.retryable, true);
    assert.match(copy.why, /unexpected/);
  });
});

void describe('staleCopy', () => {
  const now = new Date(2026, 10, 11, 14, 9, 0).getTime();
  const fourAgo = now - 4 * 60_000;

  void test('says how old the data is, relatively and by the clock', () => {
    const copy = staleCopy('members', fourAgo, null, now);
    assert.equal(copy.title, 'Couldn’t refresh members');
    assert.equal(copy.age, 'Showing what was read 4 min ago (2:05 PM).');
    assert.equal(copy.why, undefined);
  });

  void test('an unknown read time is said plainly, not as a made-up age', () => {
    assert.equal(staleCopy('members', null, null, now).age, 'Showing what was last read.');
  });

  void test('the reason is the network, or the server’s safe words, or nothing', () => {
    assert.equal(staleCopy('x', fourAgo, new NetworkError(null), now).why, 'Laika didn’t answer.');
    assert.equal(staleCopy('x', fourAgo, api('conflict', 'Locked.'), now).why, 'Locked.');
    assert.equal(staleCopy('x', fourAgo, api('internal', 'trace'), now).why, undefined);
  });
});
