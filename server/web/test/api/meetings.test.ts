/**
 * `api/meetings.ts` (LAI-1312): the query the list is asked with, the filter
 * the address carries, the refusal reasons the page branches on, and the
 * once-per-load read behind the sidebar's Meetings entry.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import {
  MEETING_FILTERS,
  meetingListQuery,
  meetingsEnabled,
  parseMeetingFilter,
  refusalReason,
  resetMeetingsEnabled,
  type MeetingList,
} from '../../src/api/meetings.ts';

void describe('parseMeetingFilter', () => {
  void test('the three filters read as themselves', () => {
    assert.deepEqual([...MEETING_FILTERS], ['all', 'attended', 'transcript']);
    for (const f of MEETING_FILTERS) assert.equal(parseMeetingFilter(f), f);
  });

  void test('anything else is all, never a request the server would refuse', () => {
    for (const odd of [null, undefined, '', 'ALL', 'missed', 'transcripts']) {
      assert.equal(parseMeetingFilter(odd), 'all', String(odd));
    }
  });
});

void describe('meetingListQuery', () => {
  void test('the defaults send nothing', () => {
    assert.equal(meetingListQuery({}), '');
    assert.equal(meetingListQuery({ filter: 'all', q: '   ' }), '');
  });

  void test('a filter, a trimmed search, a cursor and a limit are sent', () => {
    const query = new URLSearchParams(
      meetingListQuery({ filter: 'attended', q: ' stand-up ', cursor: 'abc', limit: 1 }).slice(1),
    );
    assert.equal(query.get('filter'), 'attended');
    assert.equal(query.get('q'), 'stand-up');
    assert.equal(query.get('cursor'), 'abc');
    assert.equal(query.get('limit'), '1');
  });

  void test('a search is encoded, not spliced', () => {
    assert.equal(meetingListQuery({ q: 'a&b=c' }), '?q=a%26b%3Dc');
  });
});

void describe('refusalReason', () => {
  void test('reads the server’s reason out of the details', () => {
    const error = new ApiError('forbidden', 'Only people…', 403, { reason: 'not_attended' });
    assert.equal(refusalReason(error), 'not_attended');
    const conflict = new ApiError('conflict', 'Already', 409, {
      reason: 'already_logged',
      entry_id: 'e1',
    });
    assert.equal(refusalReason(conflict), 'already_logged');
  });

  void test('no reason is undefined — a bare error, odd details, or not an ApiError', () => {
    assert.equal(refusalReason(new ApiError('internal', 'x', 500)), undefined);
    assert.equal(refusalReason(new ApiError('internal', 'x', 500, { reason: 7 })), undefined);
    assert.equal(refusalReason(new Error('x')), undefined);
    assert.equal(refusalReason('not_attended'), undefined);
  });
});

void describe('meetingsEnabled — once per page load', () => {
  beforeEach(() => {
    resetMeetingsEnabled();
  });

  const list = (enabled: boolean): MeetingList => ({ enabled, data: [], next_cursor: null });

  void test('answers the list’s own enabled, asking once however many ask', async () => {
    let asked = 0;
    const read = () => {
      asked += 1;
      return Promise.resolve(list(true));
    };
    const answers = await Promise.all([meetingsEnabled(read), meetingsEnabled(read)]);
    assert.deepEqual(answers, [true, true]);
    assert.equal(await meetingsEnabled(read), true);
    assert.equal(asked, 1);
  });

  void test('sync off is false', async () => {
    assert.equal(await meetingsEnabled(() => Promise.resolve(list(false))), false);
  });

  void test('a failed read is false: no entry for a page that cannot be read', async () => {
    assert.equal(await meetingsEnabled(() => Promise.reject(new Error('down'))), false);
  });
});
