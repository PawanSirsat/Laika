import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MeetingSummary, MyAttendance } from '../../../../src/api/meetings.ts';
import { meetingHref } from '../../../../src/routes/screens/meetings/meetings-derive.ts';
import {
  attendedLine,
  meetingsToday,
} from '../../../../src/routes/screens/my-day/meetings-today-derive.ts';

/**
 * My day's *Meetings today* strip (LAI-1313): which attended meetings it
 * offers, and the line each row prints.
 */

const at = (day: number, h: number, m = 0): number => Date.UTC(2026, 10, day, h, m);
const TODAY = '2026-11-18';

function meeting(id: string, me: Partial<MyAttendance>): MeetingSummary {
  return {
    id,
    title: id,
    organiser_email: 'grace@example.com',
    organiser_name: null,
    scheduled_start: me.joined_at ?? at(18, 9),
    scheduled_end: (me.joined_at ?? at(18, 9)) + 30 * 60_000,
    actual_start: null,
    actual_end: null,
    is_online: true,
    join_url: null,
    has_transcript: false,
    project: null,
    my_attendance: {
      invited: true,
      joined_at: null,
      left_at: null,
      minutes: 0,
      time_entry_id: null,
      ...me,
    },
  };
}

void describe('which meetings the strip offers', () => {
  const attended = (id: string, joined: number, over: Partial<MyAttendance> = {}) =>
    meeting(id, { joined_at: joined, left_at: joined + 30 * 60_000, minutes: 30, ...over });

  void test('attended today and not added, soonest first', () => {
    const list = [
      attended('late', at(18, 14)),
      attended('early', at(18, 9)),
      attended('yesterday', at(17, 14)),
      attended('logged', at(18, 11), { time_entry_id: 'e1' }),
      attended('no-minutes', at(18, 12), { minutes: 0 }),
      meeting('missed', {}),
    ];
    assert.deepEqual(
      meetingsToday(list, TODAY, 'UTC').map((m) => m.id),
      ['early', 'late'],
    );
  });

  void test('today is counted in the page’s zone, not UTC', () => {
    // 20:00 UTC on the 17th is 01:30 on the 18th in Kolkata.
    const evening = attended('evening', at(17, 20));
    assert.deepEqual(
      meetingsToday([evening], TODAY, 'Asia/Kolkata').map((m) => m.id),
      ['evening'],
    );
    assert.deepEqual(meetingsToday([evening], TODAY, 'UTC'), []);
  });
});

void describe('each row’s line', () => {
  void test('the attended range and Teams’ own minutes', () => {
    const m = meeting('m', { joined_at: at(18, 10, 4), left_at: at(18, 10, 41), minutes: 37 });
    assert.equal(attendedLine(m, 'UTC'), '10:04–10:41 AM · 37 min');
  });

  void test('still in it: from the join', () => {
    const m = meeting('m', { joined_at: at(18, 10, 4), minutes: 12 });
    assert.equal(attendedLine(m, 'UTC'), 'from 10:04 AM · 12 min');
  });

  void test('opens the meeting on the Meetings page', () => {
    assert.equal(meetingHref('01H X'), '/meetings?meeting=01H%20X');
  });
});
