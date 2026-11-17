/**
 * What an action's toast says (LAI-1310): the success line in the caller's
 * words, the error line with the server's sentence under it, a field-naming
 * 422 pointed at its field, and silence for an abort. `use-action.ts` only
 * awaits the call and shows what these return.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, NetworkError } from '../../../src/api/errors.ts';
import {
  DEFAULT_FAILURE,
  FIELD_FAILURE,
  UNREACHABLE,
  detailOf,
  failureToast,
  isAbort,
  namesFields,
  successToast,
} from '../../../src/components/toast/action-model.ts';

const refused = (details: unknown): ApiError =>
  new ApiError('unprocessable', 'Invalid request body', 422, details);

void describe('action toast: success', () => {
  void test('a fixed line is a success toast with nothing else on it', () => {
    assert.deepEqual(successToast({ success: 'Watching LC-42' }, undefined), {
      text: 'Watching LC-42',
      tone: 'success',
    });
  });

  void test('a line made from the result names what came back', () => {
    const said = successToast(
      { success: (r: { key: string }) => `${r.key} created` },
      {
        key: 'LC-7',
      },
    );
    assert.equal(said?.text, 'LC-7 created');
  });

  void test('null success says nothing — for actions too frequent to announce', () => {
    assert.equal(successToast({ success: null }, 1), null);
  });

  void test('Undo is bound to the result, so it reverses this change and not another', async () => {
    const seen: number[] = [];
    const said = successToast(
      {
        success: 'Moved',
        undo: (id: number) => {
          seen.push(id);
          return Promise.resolve('Put back');
        },
      },
      42,
    );
    assert.notEqual(said?.undo, undefined);
    assert.equal(await said?.undo?.(), 'Put back');
    assert.deepEqual(seen, [42]);
  });

  void test('an action and a mark ride along', () => {
    const run = (): void => undefined;
    const said = successToast({ success: 'Made', action: { label: 'Open', run }, mark: 'x' }, 0);
    assert.equal(said?.action?.label, 'Open');
    assert.equal(said?.mark, 'x');
  });
});

void describe('action toast: failure', () => {
  void test("the server's sentence is the detail under the caller's headline", () => {
    const cause = new ApiError('forbidden', 'Only an admin can change this.', 403);
    assert.deepEqual(failureToast({ success: 'x', failure: 'Couldn’t sign out' }, cause), {
      text: 'Couldn’t sign out',
      tone: 'error',
      detail: 'Only an admin can change this.',
    });
  });

  void test('with no headline given it says the default, never a blank', () => {
    const said = failureToast({ success: 'x' }, new ApiError('internal', 'Boom', 500));
    assert.equal(said?.text, DEFAULT_FAILURE);
    assert.equal(said?.text, 'That didn’t work');
    assert.equal(said?.detail, 'Boom');
  });

  void test('an unreachable instance gets our sentence, since the server sent none', () => {
    const said = failureToast({ success: 'x' }, new NetworkError(new TypeError('x')));
    assert.equal(said?.detail, UNREACHABLE);
    assert.equal(detailOf(new TypeError('Failed to fetch')), UNREACHABLE);
  });

  void test('a thrown non-error has no detail worth reading', () => {
    const said = failureToast({ success: 'x', failure: 'Nope' }, 'string');
    assert.deepEqual(said, { text: 'Nope', tone: 'error' });
  });

  void test('a 422 with zod issues points at the field, whatever the headline', () => {
    const cause = refused({ issues: [{ path: 'title', message: 'Required' }] });
    assert.equal(namesFields(cause), true);
    const said = failureToast({ success: 'x', failure: 'Couldn’t rename' }, cause);
    assert.equal(said?.text, FIELD_FAILURE);
    assert.equal(said?.text, 'Couldn’t save — see the highlighted field');
    assert.equal(said?.detail, undefined, 'the field carries the message, not the toast');
  });

  void test('a service 422 naming details.field points at the field too', () => {
    assert.equal(namesFields(refused({ field: 'prefix' })), true);
  });

  void test('a 422 that names no field is the form’s, so it says the server’s sentence', () => {
    for (const details of [null, {}, { issues: [] }, { field: '' }]) {
      const cause = refused(details);
      assert.equal(namesFields(cause), false, JSON.stringify(details));
      assert.equal(failureToast({ success: 'x' }, cause)?.detail, 'Invalid request body');
    }
  });

  void test('only an unprocessable refusal names fields — a 409 with a field does not', () => {
    const cause = new ApiError('conflict', 'Taken', 409, { field: 'prefix' });
    assert.equal(namesFields(cause), false);
  });

  void test('an abort is not a failure and says nothing', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    assert.equal(isAbort(abort), true);
    assert.equal(failureToast({ success: 'x' }, abort), null);
    assert.equal(isAbort(new Error('AbortError')), false);
  });
});
