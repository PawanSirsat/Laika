import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  LEAVE_PARTS,
  LEAVE_STATUSES,
  leaveHalf,
  leaveLabel,
  offDescription,
  offKind,
  offLabel,
  offOwes,
  type OffDay,
  type OffLeave,
} from '../../src/api/off-days.ts';

/**
 * The words and tones of a day off (D-149, LAI-1184), which My day and the
 * Time logging grid both read — so a holiday, a half day and a request say
 * the same thing on every screen.
 */

const holiday = (label: string): OffDay => ({ holiday: { label }, leave: null });
const leave = (l: Partial<OffLeave> = {}): OffDay => ({
  holiday: null,
  leave: { part: 'full', status: 'approved', type: null, ...l },
});

void describe('the client mirrors the server’s leave enums', () => {
  void test('the same parts and statuses, in the same order', async () => {
    const enums = await readFile(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
    const list = (name: string): string[] =>
      [
        ...(new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(enums)?.[1] ?? '').matchAll(/'([^']+)'/g),
      ].map((m) => m[1] ?? '');
    assert.deepEqual(list('LEAVE_PARTS'), ['full', 'first_half', 'second_half']);
    assert.deepEqual([...LEAVE_PARTS], list('LEAVE_PARTS'));
    assert.deepEqual([...LEAVE_STATUSES], list('LEAVE_STATUSES'));
  });
});

void describe('offKind — which tone the day is drawn in', () => {
  void test('none for no day off', () => {
    assert.equal(offKind(null), null);
    assert.equal(offKind(undefined), null);
    assert.equal(offKind({ holiday: null, leave: null }), null);
  });

  void test('a holiday, approved leave, pending leave', () => {
    assert.equal(offKind(holiday('Heritage Day')), 'holiday');
    assert.equal(offKind(leave()), 'leave');
    assert.equal(offKind(leave({ part: 'first_half' })), 'leave');
    assert.equal(offKind(leave({ status: 'pending' })), 'requested');
  });

  void test('a holiday wins over leave on the same day', () => {
    assert.equal(
      offKind({
        holiday: { label: 'Diwali' },
        leave: { part: 'full', status: 'approved', type: null },
      }),
      'holiday',
    );
  });
});

void describe('the words', () => {
  void test('the half a part names', () => {
    assert.equal(leaveHalf('full'), null);
    assert.equal(leaveHalf('first_half'), 'morning');
    assert.equal(leaveHalf('second_half'), 'afternoon');
  });

  void test('leave: the type only when sent, and the half only when half', () => {
    assert.equal(leaveLabel(leave().leave!), 'On leave');
    assert.equal(leaveLabel(leave({ type: 'Annual' }).leave!), 'On leave · Annual');
    assert.equal(leaveLabel(leave({ part: 'first_half' }).leave!), 'On leave · morning');
    assert.equal(
      leaveLabel(leave({ part: 'second_half', type: 'Sick' }).leave!),
      'On leave · Sick · afternoon',
    );
    assert.equal(leaveLabel(leave({ status: 'pending' }).leave!), 'Leave requested');
    assert.equal(
      leaveLabel(leave({ status: 'pending', part: 'first_half' }).leave!),
      'Leave requested · morning',
    );
  });

  void test('the label is the winner; the description keeps both', () => {
    const both: OffDay = {
      holiday: { label: 'Heritage Day' },
      leave: { part: 'full', status: 'approved', type: 'Annual' },
    };
    assert.equal(offLabel(holiday('Heritage Day')), 'Heritage Day');
    assert.equal(offLabel(leave({ type: 'Annual' })), 'On leave · Annual');
    assert.equal(offLabel(both), 'Heritage Day');
    assert.equal(offDescription(both), 'Heritage Day · On leave · Annual');
    assert.equal(offLabel(null), null);
    assert.equal(offDescription({ holiday: null, leave: null }), null);
  });
});

void describe('offOwes — what a day off leaves owing (D-149 item 6)', () => {
  void test('nothing under a holiday or approved whole-day leave', () => {
    assert.equal(offOwes(holiday('Heritage Day')), 'nothing');
    assert.equal(offOwes(leave()), 'nothing');
  });

  void test('half under approved half-day leave', () => {
    assert.equal(offOwes(leave({ part: 'first_half' })), 'half');
    assert.equal(offOwes(leave({ part: 'second_half' })), 'half');
  });

  void test('all of it under pending leave, or no day off', () => {
    assert.equal(offOwes(leave({ status: 'pending' })), 'all');
    assert.equal(offOwes(leave({ status: 'pending', part: 'first_half' })), 'all');
    assert.equal(offOwes(null), 'all');
  });

  void test('a holiday owes nothing even beside pending leave', () => {
    assert.equal(
      offOwes({
        holiday: { label: 'Diwali' },
        leave: { part: 'full', status: 'pending', type: null },
      }),
      'nothing',
    );
  });
});
