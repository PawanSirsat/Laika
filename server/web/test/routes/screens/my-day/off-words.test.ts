import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OffDay } from '../../../../src/api/off-days.ts';
import {
  offEmpty,
  offLines,
  offLineText,
} from '../../../../src/routes/screens/my-day/off-words.ts';

/**
 * What the Day page says about a day off (D-149, LAI-1184): a banner a fact,
 * the type of leave only when it was sent, the half as a person says it, and
 * an empty Timeline that names the day rather than calling it no signal.
 */

const said = (off: OffDay | null): string[] => offLines(off).map(offLineText);

void describe('offLines', () => {
  void test('a holiday by its name', () => {
    assert.deepEqual(said({ holiday: { label: 'Heritage Day' }, leave: null }), [
      'Public holiday — Heritage Day',
    ]);
  });

  void test('leave with its type and half, the type only when sent', () => {
    const leave = (
      part: 'full' | 'first_half' | 'second_half',
      type: string | null,
      status: 'approved' | 'pending' = 'approved',
    ): OffDay => ({ holiday: null, leave: { part, status, type } });
    assert.deepEqual(said(leave('first_half', 'Sick')), ['On leave — Sick (morning)']);
    assert.deepEqual(said(leave('second_half', null)), ['On leave (afternoon)']);
    assert.deepEqual(said(leave('full', null)), ['On leave']);
    assert.deepEqual(said(leave('full', 'Annual')), ['On leave — Annual']);
    // Pending is only requested, whatever its part.
    assert.deepEqual(said(leave('full', null, 'pending')), ['Leave requested']);
    assert.deepEqual(said(leave('first_half', null, 'pending')), ['Leave requested (morning)']);
  });

  void test('a holiday and leave on one day are both said, the holiday first', () => {
    const lines = offLines({
      holiday: { label: 'Heritage Day' },
      leave: { part: 'full', status: 'pending', type: null },
    });
    assert.deepEqual(
      lines.map((l) => [l.kind, l.head]),
      [
        ['holiday', 'Public holiday'],
        ['requested', 'Leave requested'],
      ],
    );
  });

  void test('no day off, no banner', () => {
    assert.deepEqual(offLines(null), []);
    assert.deepEqual(offLines(undefined), []);
  });
});

void describe('offEmpty', () => {
  void test('the day off’s name, nothing owed, and time can still be added once begun', () => {
    const holiday = offEmpty({ holiday: { label: 'Heritage Day' }, leave: null }, false);
    assert.equal(holiday.title, 'Heritage Day');
    assert.match(holiday.body, /^A public holiday: nothing is owed on it\. If you worked/);
    const leave = offEmpty(
      { holiday: null, leave: { part: 'full', status: 'approved', type: 'Annual' } },
      false,
    );
    assert.equal(leave.title, 'On leave · Annual');
    assert.match(leave.body, /^Whole-day leave: nothing is owed on it\./);
    assert.doesNotMatch(leave.body, /no signal/i);
  });

  void test('a day off to come offers no time to add', () => {
    const ahead = offEmpty({ holiday: { label: 'Heritage Day' }, leave: null }, true);
    assert.equal(ahead.body, 'A public holiday: nothing is owed on it.');
  });
});
