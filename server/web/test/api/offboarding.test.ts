/**
 * The offboarding refusals, read from the envelope (D-104 item 5, LAI-988).
 * The browser tests drive the dialog; these pin each `reason` the server
 * sends to what the reader is told.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import { heldSummary, openTasksHeld, reassignRefusal } from '../../src/api/offboarding.ts';

const refused = (
  code: ConstructorParameters<typeof ApiError>[0],
  status: number,
  details: unknown,
) => new ApiError(code, 'the server’s words', status, details);

void describe('the 409 open_tasks refusal', () => {
  void test('is read with its count, keys and hidden', () => {
    assert.deepEqual(
      openTasksHeld(
        refused('conflict', 409, { reason: 'open_tasks', count: 3, keys: ['LC-1'], hidden: 2 }),
      ),
      { count: 3, keys: ['LC-1'], hidden: 2 },
    );
  });

  void test('any other conflict is not it', () => {
    assert.equal(openTasksHeld(refused('conflict', 409, { reason: 'last_lead' })), undefined);
    assert.equal(openTasksHeld(new Error('x')), undefined);
  });

  void test('says the keys it may, and counts the rest', () => {
    assert.equal(heldSummary({ count: 1, keys: ['LC-1'], hidden: 0 }), '1 open task: LC-1');
    assert.equal(
      heldSummary({ count: 3, keys: ['LC-1', 'LC-2'], hidden: 1 }),
      '3 open tasks: LC-1, LC-2 and 1 in a space you cannot see',
    );
    assert.equal(
      heldSummary({ count: 2, keys: [], hidden: 2 }),
      '2 open tasks: 2 in spaces you cannot see',
    );
  });
});

void describe('a refused reassignment', () => {
  const on = (reason: string, extra: Record<string, unknown> = {}) =>
    reassignRefusal(
      refused('unprocessable', 422, { field: 'open_tasks.reassign_to', reason, ...extra }),
    );

  void test('each reason has its own words', () => {
    assert.match(on('self') ?? '', /person who is leaving/);
    assert.match(on('inactive') ?? '', /deactivated/);
    assert.match(on('no_such_user') ?? '', /no longer exists/);
    assert.match(
      on('cannot_hold', { tasks: [{ key: 'LC-2', reason: 'not_on_project' }] }) ?? '',
      /not in the space of LC-2/,
    );
  });

  void test('a 422 on another field is not one', () => {
    assert.equal(reassignRefusal(refused('unprocessable', 422, { field: 'name' })), undefined);
  });
});
