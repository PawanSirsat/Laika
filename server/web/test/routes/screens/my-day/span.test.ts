import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  anchorIn,
  chunks,
  isoWeek,
  mondayOf,
  monthBounds,
  monthWeeks,
  parseSpan,
  periodLabel,
  periodOf,
  startsAfter,
  stepPeriod,
  zoomSpan,
} from '../../../../src/routes/screens/my-day/span.ts';

/**
 * My day's View (LAI-1174): which days Week, Month and Year cover, a step
 * one period on or back, and where opening a part of a period lands — all on
 * calendar-day strings, so nothing moves at a clock change.
 */

void describe('parseSpan and zoomSpan', () => {
  void test('an address names a view; anything else is Day, the page as it was', () => {
    assert.equal(parseSpan('week'), 'week');
    assert.equal(parseSpan('year'), 'year');
    assert.equal(parseSpan('decade'), 'day');
    assert.equal(parseSpan(null), 'day');
    assert.equal(parseSpan(undefined), 'day');
  });

  void test('in is towards Day and out towards Year, and stops at each end', () => {
    assert.equal(zoomSpan('year', 'in'), 'month');
    assert.equal(zoomSpan('week', 'in'), 'day');
    assert.equal(zoomSpan('day', 'in'), undefined);
    assert.equal(zoomSpan('month', 'out'), 'year');
    assert.equal(zoomSpan('year', 'out'), undefined);
  });
});

void describe('weeks', () => {
  void test('a week starts on Monday, whatever day it is asked from', () => {
    assert.equal(mondayOf('2026-11-12'), '2026-11-09');
    assert.equal(mondayOf('2026-11-09'), '2026-11-09');
    assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  });

  void test('ISO week numbers, across the turn of a year and in a 53-week year', () => {
    assert.equal(isoWeek('2026-11-12'), 46);
    assert.equal(isoWeek('2026-01-01'), 1);
    // 2026 ends on a Thursday, so it has a week 53; 1 January 2027 is in it.
    assert.equal(isoWeek('2026-12-31'), 53);
    assert.equal(isoWeek('2027-01-01'), 53);
    assert.equal(isoWeek('2027-01-04'), 1);
    // 29 December 2025 is a Monday in week 1 of 2026.
    assert.equal(isoWeek('2025-12-29'), 1);
  });
});

void describe('months', () => {
  void test('bounds, a leap February included', () => {
    assert.deepEqual(monthBounds('2026-11-12'), { first: '2026-11-01', last: '2026-11-30' });
    assert.deepEqual(monthBounds('2028-02-10'), { first: '2028-02-01', last: '2028-02-29' });
  });

  void test('Monday-first rows that cover the month, spill-over days included', () => {
    const weeks = monthWeeks('2026-11-12');
    // 1 November 2026 is a Sunday: the first row starts on 26 October.
    assert.equal(weeks[0]?.[0], '2026-10-26');
    assert.equal(weeks.at(-1)?.[6], '2026-12-06');
    assert.equal(weeks.length, 6);
    for (const w of weeks) assert.equal(w.length, 7);
    // February 2021 starts on a Monday and has 28 days: exactly four rows.
    assert.equal(monthWeeks('2021-02-15').length, 4);
  });
});

void describe('periodOf', () => {
  void test('the days each view reads', () => {
    assert.deepEqual(periodOf('day', '2026-11-12'), { from: '2026-11-12', to: '2026-11-12' });
    assert.deepEqual(periodOf('week', '2026-11-12'), { from: '2026-11-09', to: '2026-11-15' });
    assert.deepEqual(periodOf('month', '2026-11-12'), { from: '2026-10-26', to: '2026-12-06' });
    assert.deepEqual(periodOf('year', '2026-11-12'), { from: '2026-01-01', to: '2026-12-31' });
  });

  void test('a month is one read and a year four, each within the server’s 92 days', () => {
    const month = periodOf('month', '2026-11-12');
    assert.equal(chunks(month.from, month.to).length, 1);
    const year = periodOf('year', '2028-06-01');
    const parts = chunks(year.from, year.to);
    assert.equal(parts.length, 4);
    assert.equal(parts[0]?.from, '2028-01-01');
    assert.equal(parts.at(-1)?.to, '2028-12-31');
    // No day lost or read twice between the parts.
    for (let i = 1; i < parts.length; i += 1) {
      const end = new Date(`${parts[i - 1]?.to ?? ''}T00:00:00Z`).getTime();
      const start = new Date(`${parts[i]?.from ?? ''}T00:00:00Z`).getTime();
      assert.equal(start - end, 86_400_000);
    }
    const days = parts.reduce(
      (n, p) =>
        n + (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000 + 1,
      0,
    );
    assert.equal(days, 366);
    for (const p of parts) {
      const length =
        (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000 + 1;
      assert.ok(length <= 92, `${p.from}–${p.to} is ${String(length)} days`);
    }
  });
});

void describe('stepPeriod', () => {
  void test('a week is seven days, a month keeps the date where it can', () => {
    assert.equal(stepPeriod('week', '2026-11-12', 1), '2026-11-19');
    assert.equal(stepPeriod('month', '2026-11-12', -1), '2026-10-12');
    assert.equal(stepPeriod('month', '2026-01-31', 1), '2026-02-28');
    assert.equal(stepPeriod('month', '2026-12-15', 1), '2027-01-15');
    assert.equal(stepPeriod('year', '2028-02-29', 1), '2029-02-28');
    assert.equal(stepPeriod('day', '2026-11-30', 1), '2026-12-01');
  });

  void test('a period that has not begun is after today; this one is not', () => {
    const today = '2026-11-12';
    assert.equal(startsAfter('week', '2026-11-19', today), true);
    assert.equal(startsAfter('week', '2026-11-15', today), false);
    // December's grid starts on 30 November, but December itself has not begun.
    assert.equal(startsAfter('month', '2026-12-01', today), true);
    assert.equal(startsAfter('month', '2026-11-30', today), false);
    assert.equal(startsAfter('year', '2027-01-01', today), true);
  });
});

void describe('anchorIn', () => {
  void test('the day already open if inside, else today if inside, else the first day', () => {
    assert.equal(anchorIn('2026-11-09', '2026-11-15', '2026-11-11', '2026-11-12'), '2026-11-11');
    assert.equal(anchorIn('2026-11-09', '2026-11-15', '2026-10-02', '2026-11-12'), '2026-11-12');
    assert.equal(anchorIn('2026-03-01', '2026-03-31', '2026-11-11', '2026-11-12'), '2026-03-01');
  });
});

void describe('periodLabel', () => {
  void test('what each view is called above it', () => {
    assert.equal(periodLabel('year', '2026-11-12'), '2026');
    assert.equal(periodLabel('month', '2026-11-12'), 'November 2026');
    assert.equal(periodLabel('week', '2026-11-12'), 'Week 46 · 9 – 15 November');
    // A week across two months names both.
    assert.equal(periodLabel('week', '2026-10-28'), 'Week 44 · 26 Oct – 1 Nov');
  });
});
