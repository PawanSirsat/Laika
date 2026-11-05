import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AvailabilityRow, AvailabilitySeen } from '../../../src/api/availability.ts';
import {
  addTag,
  canTake,
  dayShort,
  daysLine,
  hoursMinutes,
  pillOf,
  pillSentence,
  rangeShort,
  tagsOf,
  updatedAgo,
  workWeekLine,
} from '../../../src/components/availability/availability-derive.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 12);

const seen = (over: Partial<AvailabilitySeen> = {}): AvailabilitySeen => ({
  status: null,
  note: null,
  tags: [],
  away: null,
  ...over,
});

void describe('the pill (D-131, frames 2a/2d/2g)', () => {
  void test('nothing said is no pill, not a guess', () => {
    assert.equal(pillOf(null), null);
    assert.equal(pillOf(undefined), null);
    assert.equal(pillOf(seen()), null);
  });

  void test('each status has its own glyph as well as its words', () => {
    const open = pillOf(seen({ status: 'open' }));
    const capacity = pillOf(seen({ status: 'capacity' }));
    assert.deepEqual(
      [open?.glyph, open?.label, capacity?.glyph, capacity?.label],
      ['●', 'Open to more work', '■', 'At capacity'],
    );
    assert.notEqual(open?.glyph, capacity?.glyph);
  });

  void test('a current away period wins over the status, and names the day back', () => {
    const pill = pillOf(seen({ status: 'open', hours_per_week: 6, away: { until: '2026-11-16' } }));
    assert.deepEqual(pill, {
      tone: 'away',
      glyph: '◐',
      label: 'Away until Mon 16 Nov',
      hours: '',
    });
  });

  void test('hours show only when open and only when the server sent them', () => {
    assert.equal(pillOf(seen({ status: 'open', hours_per_week: 6 }))?.hours, '~6 h/wk');
    // A co-worker's view carries no hours at all (D-137 item 1).
    assert.equal(pillOf(seen({ status: 'open' }))?.hours, '');
    assert.equal(pillOf(seen({ status: 'capacity', hours_per_week: 6 }))?.hours, '');
  });

  void test('the sentence a screen reader hears carries the hours in words', () => {
    const pill = pillOf(seen({ status: 'open', hours_per_week: 8 }));
    assert.ok(pill !== null);
    assert.equal(pillSentence(pill, 8), 'Open to more work, can take about 8 hours a week');
    assert.equal(pillSentence(pill, null), 'Open to more work');
  });

  void test('Can take is a dash when no number was given, never a zero', () => {
    assert.equal(canTake(seen({ hours_per_week: 10 })), '~10 h/wk');
    assert.equal(canTake(seen({ hours_per_week: null })), '—');
    assert.equal(canTake(seen()), '—');
    assert.equal(canTake(null), '—');
  });
});

void describe('dates in words', () => {
  void test('one day, a range in one month, a range across two', () => {
    assert.equal(dayShort('2026-11-16'), 'Mon 16 Nov');
    assert.equal(rangeShort('2026-11-20', '2026-11-23'), 'Fri 20 – Mon 23 Nov');
    assert.equal(rangeShort('2026-12-24', '2027-01-01'), 'Thu 24 Dec – Fri 1 Jan');
    assert.equal(rangeShort('2026-11-16', '2026-11-16'), 'Mon 16 Nov');
  });

  void test('a date it cannot read is shown as sent', () => {
    assert.equal(dayShort('soon'), 'soon');
  });
});

void describe('updated N ago (the staleness rule)', () => {
  void test('never set is no line', () => {
    assert.equal(updatedAgo(null, NOW), null);
  });

  void test('days, then weeks, then months', () => {
    assert.equal(updatedAgo(NOW - 2 * 3_600_000, NOW)?.text, 'updated today');
    assert.equal(updatedAgo(NOW - DAY, NOW)?.text, 'updated yesterday');
    assert.equal(updatedAgo(NOW - 3 * DAY, NOW)?.text, 'updated 3 days ago');
    assert.equal(updatedAgo(NOW - 15 * DAY, NOW)?.text, 'updated 2 weeks ago');
    assert.equal(updatedAgo(NOW - 90 * DAY, NOW)?.text, 'updated 3 months ago');
  });

  void test('over thirty days is stale; thirty is not', () => {
    assert.equal(updatedAgo(NOW - 30 * DAY, NOW)?.stale, false);
    assert.equal(updatedAgo(NOW - 31 * DAY, NOW)?.stale, true);
  });
});

void describe('the working week', () => {
  void test('weekdays as runs', () => {
    assert.equal(daysLine([1, 2, 3, 4, 5]), 'Mon–Fri');
    assert.equal(daysLine([1, 3, 4]), 'Mon, Wed–Thu');
    assert.equal(daysLine([7, 6]), 'Sat–Sun');
    assert.equal(daysLine([]), '');
  });

  void test('with hours, without, and not set', () => {
    assert.equal(
      workWeekLine({ days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00', minutes: 2400 }),
      'Mon–Fri, 08:00–16:00',
    );
    assert.equal(workWeekLine({ days: [2], start: null, end: null, minutes: null }), 'Tue');
    assert.equal(workWeekLine(null), null);
    assert.equal(workWeekLine({ days: [], start: null, end: null, minutes: null }), null);
  });

  void test('the short figure', () => {
    assert.deepEqual(
      [hoursMinutes(1265), hoursMinutes(2400), hoursMinutes(45), hoursMinutes(0)],
      ['21h 5m', '40h', '45m', '0m'],
    );
  });
});

void describe('tags', () => {
  void test('a typed tag is trimmed and added', () => {
    assert.deepEqual(addTag(['Front-end'], '  Maps '), { tags: ['Front-end', 'Maps'] });
  });

  void test('a duplicate in another case is refused', () => {
    assert.ok('problem' in addTag(['Maps'], 'maps'));
  });

  void test('too long, and too many', () => {
    assert.ok('problem' in addTag([], 'x'.repeat(33)));
    assert.ok('tags' in addTag([], 'x'.repeat(32)));
    assert.ok('problem' in addTag(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'i'));
  });

  void test('an empty entry changes nothing', () => {
    assert.deepEqual(addTag(['a'], '   '), { tags: ['a'] });
  });

  void test('the filter offers each tag once, whatever its case, A–Z', () => {
    const row = (tags: string[]): AvailabilityRow => ({
      user: { id: tags.join(), name: 'x' },
      availability: seen({ tags }),
      spaces: [],
    });
    assert.deepEqual(tagsOf([row(['QA', 'Maps']), row(['maps', 'Back-end'])]), [
      'Back-end',
      'Maps',
      'QA',
    ]);
  });
});
