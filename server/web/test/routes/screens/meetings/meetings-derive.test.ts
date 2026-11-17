/**
 * What the Meetings page works out (LAI-1312). Every time is built with the
 * local `Date` constructor, so the day boundaries are the machine's own and
 * the suite holds in any time zone — the page groups by the reader's day.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MeetingSummary } from '../../../../src/api/meetings.ts';
import {
  attendanceChip,
  canAddToDay,
  drawnOrder,
  groupMeetings,
  groupOf,
  isUpcoming,
  organiserLabel,
  scheduleLine,
  searchTranscript,
  startOfLocalWeek,
  stepSelection,
  transcriptStamp,
} from '../../../../src/routes/screens/meetings/meetings-derive.ts';

/** A local time: 2026-11-18 is a Wednesday. */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(18, 12);

const meeting = (
  id: string,
  start: number,
  over: Partial<MeetingSummary> = {},
): MeetingSummary => ({
  id,
  title: `Meeting ${id}`,
  organiser_email: 'org@example.test',
  organiser_name: null,
  scheduled_start: start,
  scheduled_end: start + 30 * 60_000,
  actual_start: null,
  actual_end: null,
  is_online: true,
  join_url: null,
  has_transcript: false,
  project: null,
  my_attendance: { invited: true, joined_at: null, left_at: null, minutes: 0, time_entry_id: null },
  ...over,
});

void describe('day groups', () => {
  void test('each meeting goes under its reader’s day', () => {
    assert.equal(groupOf(meeting('a', at(18, 9)), NOW), 'today');
    assert.equal(groupOf(meeting('a', at(18, 23, 30)), NOW), 'today', 'later today is still today');
    assert.equal(groupOf(meeting('a', at(19, 0)), NOW), 'upcoming');
    assert.equal(groupOf(meeting('a', at(17, 23, 59)), NOW), 'yesterday');
    assert.equal(groupOf(meeting('a', at(16, 10)), NOW), 'week', 'Monday of this week');
    assert.equal(groupOf(meeting('a', at(15, 10)), NOW), 'earlier', 'last Sunday');
  });

  void test('a week starts on Monday', () => {
    assert.equal(startOfLocalWeek(NOW), at(16, 0));
    assert.equal(startOfLocalWeek(at(22, 20)), at(16, 0), 'Sunday is the end of the week');
    assert.equal(startOfLocalWeek(at(23, 1)), at(23, 0));
  });

  void test('on a Monday, yesterday is last week and nothing is earlier this week', () => {
    const monday = at(16, 9);
    assert.equal(groupOf(meeting('a', at(15, 10)), monday), 'yesterday');
    assert.equal(groupOf(meeting('a', at(14, 10)), monday), 'earlier');
  });

  void test('groups in the page’s order, empty ones left out, next-first today and ahead', () => {
    const groups = groupMeetings(
      [
        meeting('up2', at(21, 9)),
        meeting('up1', at(19, 9)),
        meeting('t2', at(18, 15)),
        meeting('t1', at(18, 9)),
        meeting('w2', at(16, 15)),
        meeting('w1', at(16, 9)),
        meeting('old', at(10, 9)),
      ],
      NOW,
    );
    assert.deepEqual(
      groups.map((g) => [g.label, g.meetings.map((m) => m.id)]),
      [
        ['Today', ['t1', 't2']],
        ['Earlier this week', ['w2', 'w1']],
        ['Upcoming', ['up1', 'up2']],
        ['Earlier', ['old']],
      ],
    );
    assert.deepEqual(drawnOrder(groups), ['t1', 't2', 'w2', 'w1', 'up1', 'up2', 'old']);
  });
});

void describe('the arrow keys', () => {
  const ids = ['a', 'b', 'c'];
  void test('step and stop at the ends', () => {
    assert.equal(stepSelection(ids, 'a', 1), 'b');
    assert.equal(stepSelection(ids, 'c', 1), 'c');
    assert.equal(stepSelection(ids, 'a', -1), 'a');
    assert.equal(stepSelection(ids, 'b', -1), 'a');
  });
  void test('from nowhere, down is the first and up the last; an empty list is nowhere', () => {
    assert.equal(stepSelection(ids, undefined, 1), 'a');
    assert.equal(stepSelection(ids, 'gone', -1), 'c');
    assert.equal(stepSelection([], 'a', 1), undefined);
  });
});

void describe('the chips', () => {
  void test('attended, with the times they were there', () => {
    const chip = attendanceChip(
      meeting('a', at(18, 10), {
        my_attendance: {
          invited: true,
          joined_at: at(18, 10, 4),
          left_at: at(18, 10, 41),
          minutes: 37,
          time_entry_id: null,
        },
      }),
      NOW,
    );
    assert.deepEqual(chip, { kind: 'attended', text: 'Attended 10:04–10:41 AM' });
  });

  void test('missed only once it is over, and only if invited', () => {
    assert.deepEqual(attendanceChip(meeting('a', at(18, 9)), NOW), {
      kind: 'missed',
      text: 'Missed',
    });
    assert.equal(attendanceChip(meeting('a', at(18, 15)), NOW), undefined, 'still to come');
    const uninvited = meeting('a', at(18, 9), {
      my_attendance: {
        invited: false,
        joined_at: null,
        left_at: null,
        minutes: 0,
        time_entry_id: null,
      },
    });
    assert.equal(attendanceChip(uninvited, NOW), undefined);
  });
});

void describe('the header’s lines', () => {
  void test('scheduled, and what ran once Teams said', () => {
    const planned = meeting('a', at(18, 10));
    assert.equal(scheduleLine(planned), 'Scheduled 10:00–10:30 AM');
    assert.equal(
      scheduleLine({ ...planned, actual_start: at(18, 10, 2), actual_end: at(18, 10, 41) }),
      'Scheduled 10:00–10:30 AM · ran 10:02–10:41 AM',
    );
  });

  void test('the organiser by name, else by address', () => {
    assert.equal(organiserLabel(meeting('a', 0)), 'org@example.test');
    assert.equal(organiserLabel(meeting('a', 0, { organiser_name: '  ' })), 'org@example.test');
    assert.equal(organiserLabel(meeting('a', 0, { organiser_name: 'Ada' })), 'Ada');
  });
});

void describe('the actions’ conditions', () => {
  const me = (over: Partial<MeetingSummary['my_attendance']>) =>
    meeting('a', at(18, 9), {
      my_attendance: {
        invited: true,
        joined_at: at(18, 9),
        left_at: at(18, 9, 30),
        minutes: 30,
        time_entry_id: null,
        ...over,
      },
    });

  void test('Add to My day: attended, for some minutes, not yet added', () => {
    assert.equal(canAddToDay(me({})), true);
    assert.equal(canAddToDay(me({ time_entry_id: 'e1' })), false, 'already added');
    assert.equal(canAddToDay(me({ joined_at: null })), false, 'did not join');
    assert.equal(canAddToDay(me({ minutes: 0 })), false, 'no minutes to add');
  });

  void test('Open in Teams: until it ends', () => {
    assert.equal(isUpcoming(meeting('a', at(18, 11, 50)), NOW), true, 'running now');
    assert.equal(isUpcoming(meeting('a', at(18, 9)), NOW), false);
  });
});

void describe('the transcript', () => {
  void test('stamps as Teams shows them', () => {
    assert.equal(transcriptStamp(0), '0:00');
    assert.equal(transcriptStamp(247_000), '4:07');
    assert.equal(transcriptStamp(3_847_900), '1:04:07');
    assert.equal(transcriptStamp(-5), '0:00');
  });

  void test('search matches words or speaker, case-blind; blank is everything', () => {
    const lines = [
      { at_ms: 0, speaker: 'Ada', text: 'Ship the Board' },
      { at_ms: 1, speaker: null, text: 'agreed' },
    ];
    assert.equal(searchTranscript(lines, '  ').length, 2);
    assert.deepEqual(searchTranscript(lines, 'board'), [lines[0]]);
    assert.deepEqual(searchTranscript(lines, 'ADA'), [lines[0]]);
    assert.deepEqual(searchTranscript(lines, 'nothing'), []);
  });
});
