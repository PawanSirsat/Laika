/**
 * `src/api/time-label.ts` — relative for a day, then a date (LAI-486, D-065).
 *
 * Every moment here is built from **local** components (`new Date(y, m, d, …)`),
 * so the expected strings hold in any timezone the suite runs in. The labels
 * use a fixed table of names rather than `Intl`, so no locale can change them
 * either — `27 Sep`, never `27 Sept`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clockRange,
  clockTime,
  dateTime,
  hourLabel,
  minuteClock,
  parseClock,
  startTicker,
  timeLabel,
  type Timers,
} from '../../src/api/time-label.ts';

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number =>
  new Date(y, mo - 1, d, h, mi, s).getTime();

const NOW = at(2026, 9, 28, 15, 30, 0);
const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

void describe('timeLabel — the text', () => {
  void test('under a minute is just now; the minute boundary is exact', () => {
    assert.equal(timeLabel(NOW, NOW).text, 'just now');
    assert.equal(timeLabel(NOW - 59 * SEC, NOW).text, 'just now');
    assert.equal(timeLabel(NOW - 60 * SEC, NOW).text, '1 min ago');
  });

  void test('minutes up to the hour, then hours', () => {
    assert.equal(timeLabel(NOW - 4 * MIN, NOW).text, '4 min ago');
    assert.equal(timeLabel(NOW - 59 * MIN, NOW).text, '59 min ago');
    assert.equal(timeLabel(NOW - 60 * MIN, NOW).text, '1 h ago');
    assert.equal(timeLabel(NOW - (23 * HOUR + 59 * MIN), NOW).text, '23 h ago');
  });

  void test('a day or more is a date and a 12-hour time with AM/PM, day before month', () => {
    assert.equal(timeLabel(NOW - 24 * HOUR, NOW).text, '27 Sep, 3:30 PM');
    assert.equal(timeLabel(at(2026, 9, 3, 9, 5), NOW).text, '3 Sep, 9:05 AM');
    assert.equal(timeLabel(at(2026, 1, 14, 21, 45), NOW).text, '14 Jan, 9:45 PM');
  });

  void test('another year says the year', () => {
    assert.equal(timeLabel(at(2025, 3, 14, 9, 12), NOW).text, '14 Mar 2025, 9:12 AM');
  });

  void test('across New Year: forty minutes is still relative, two days is a dated year', () => {
    const newYear = at(2026, 1, 1, 0, 30);
    assert.equal(timeLabel(at(2025, 12, 31, 23, 50), newYear).text, '40 min ago');
    assert.equal(timeLabel(at(2025, 12, 30, 12, 0), newYear).text, '30 Dec 2025, 12:00 PM');
  });

  void test('a future stamp reads just now, never a negative age', () => {
    const label = timeLabel(NOW + 3 * MIN, NOW);
    assert.equal(label.text, 'just now');
    assert.equal(label.fresh, true);
  });
});

void describe('timeLabel — the rest of the label', () => {
  void test('full is the whole moment, weekday first', () => {
    assert.equal(timeLabel(at(2026, 9, 27, 14, 5, 31), NOW).full, 'Sun 27 Sep 2026, 2:05:31 PM');
  });

  void test('iso is the instant, for <time dateTime>', () => {
    const moment = at(2026, 9, 27, 14, 5, 31);
    assert.equal(timeLabel(moment, NOW).iso, new Date(moment).toISOString());
  });

  void test('fresh is under an hour, and the boundary is exact', () => {
    assert.equal(timeLabel(NOW - 59 * MIN, NOW).fresh, true);
    assert.equal(timeLabel(NOW - 60 * MIN, NOW).fresh, false);
  });
});

/*
 * The 12-hour clock (LAI-830). The owner: *"a 12-hour clock everywhere in the
 * web app, also show AM/PM"* — whatever the reader's locale, so every
 * expectation below is an exact string with an ordinary space before AM/PM.
 */
void describe('clockTime — one time of day, 12-hour with AM/PM', () => {
  void test('midnight is 12 AM and noon is 12 PM, never 0 or 00', () => {
    assert.equal(clockTime(at(2026, 10, 20, 0, 0)), '12:00 AM');
    assert.equal(clockTime(at(2026, 10, 20, 0, 5)), '12:05 AM');
    assert.equal(clockTime(at(2026, 10, 20, 12, 0)), '12:00 PM');
    assert.equal(clockTime(at(2026, 10, 20, 12, 59)), '12:59 PM');
  });

  void test('no leading zero on the hour, always two digits for the minute', () => {
    assert.equal(clockTime(at(2026, 10, 20, 9, 5)), '9:05 AM');
    assert.equal(clockTime(at(2026, 10, 20, 14, 29)), '2:29 PM');
    assert.equal(clockTime(at(2026, 10, 20, 23, 59)), '11:59 PM');
  });

  void test('seconds when asked for', () => {
    assert.equal(clockTime(at(2026, 9, 27, 14, 5, 31), { seconds: true }), '2:05:31 PM');
    assert.equal(clockTime(at(2026, 9, 27, 0, 0, 7), { seconds: true }), '12:00:07 AM');
  });

  void test('in a named zone when given one — My day draws a block in its own zone', () => {
    const utc = Date.UTC(2026, 9, 20, 14, 29);
    assert.equal(clockTime(utc, { timeZone: 'UTC' }), '2:29 PM');
    assert.equal(clockTime(utc, { timeZone: 'Asia/Kolkata' }), '7:59 PM');
    assert.equal(clockTime(utc, { timeZone: 'America/New_York' }), '10:29 AM');
  });
});

void describe('clockRange — from and to, with one AM/PM when they share it', () => {
  const utc = (h: number, m = 0): number => Date.UTC(2026, 9, 20, h, m);
  const z = { timeZone: 'UTC' };

  void test('the owner’s row: 14:29–14:48 reads 2:29–2:48 PM', () => {
    assert.equal(clockRange(utc(14, 29), utc(14, 48), z), '2:29–2:48 PM');
  });

  void test('a morning range says AM once', () => {
    assert.equal(clockRange(utc(8, 40), utc(10, 15), z), '8:40–10:15 AM');
  });

  void test('across noon each end says its own', () => {
    assert.equal(clockRange(utc(11, 40), utc(12, 10), z), '11:40 AM–12:10 PM');
  });

  void test('across midnight each end says its own', () => {
    assert.equal(clockRange(utc(23, 30), Date.UTC(2026, 9, 21, 0, 15), z), '11:30 PM–12:15 AM');
  });

  void test('in the reader’s zone when none is named', () => {
    assert.equal(clockRange(at(2026, 10, 20, 14, 29), at(2026, 10, 20, 14, 48)), '2:29–2:48 PM');
  });
});

void describe('dateTime — a date with a time', () => {
  const now = at(2026, 10, 21, 9, 0);

  void test('this year: day, month, then the 12-hour time', () => {
    assert.equal(dateTime(at(2026, 10, 20, 14, 29), now), '20 Oct, 2:29 PM');
    assert.equal(dateTime(at(2026, 1, 3, 0, 5), now), '3 Jan, 12:05 AM');
  });

  void test('another year says the year', () => {
    assert.equal(dateTime(at(2025, 10, 20, 14, 29), now), '20 Oct 2025, 2:29 PM');
  });
});

void describe('hourLabel — an hour on an axis', () => {
  void test('12 AM, 8 AM, 12 PM, 1 PM, 6 PM, and 24 is midnight again', () => {
    assert.equal(hourLabel(0), '12 AM');
    assert.equal(hourLabel(8), '8 AM');
    assert.equal(hourLabel(12), '12 PM');
    assert.equal(hourLabel(13), '1 PM');
    assert.equal(hourLabel(18), '6 PM');
    assert.equal(hourLabel(24), '12 AM');
  });
});

void describe('minuteClock — a minute after midnight, as a setting stores it', () => {
  void test('9:00 AM, midnight, noon and the last minute', () => {
    assert.equal(minuteClock(540), '9:00 AM');
    assert.equal(minuteClock(570), '9:30 AM');
    assert.equal(minuteClock(0), '12:00 AM');
    assert.equal(minuteClock(720), '12:00 PM');
    assert.equal(minuteClock(1439), '11:59 PM');
  });

  void test('reads back through parseClock as itself, every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      assert.equal(parseClock(minuteClock(minute))?.minute, minute, minuteClock(minute));
    }
  });
});

void describe('parseClock — a time of day as a person types it', () => {
  void test('with AM/PM, in the forms people type', () => {
    for (const text of ['2:35 PM', '2:35pm', '2:35 p.m.', '2:35 P.M.', ' 2:35 PM ']) {
      assert.deepEqual(parseClock(text), { minute: 14 * 60 + 35, ambiguous: false }, text);
    }
    assert.deepEqual(parseClock('2pm'), { minute: 14 * 60, ambiguous: false });
    assert.deepEqual(parseClock('12:10 AM'), { minute: 10, ambiguous: false });
    assert.deepEqual(parseClock('12:10 PM'), { minute: 12 * 60 + 10, ambiguous: false });
  });

  void test('a 24-hour time is still read, and is not ambiguous past 12', () => {
    assert.deepEqual(parseClock('14:35'), { minute: 14 * 60 + 35, ambiguous: false });
    assert.deepEqual(parseClock('0:15'), { minute: 15, ambiguous: false });
    assert.deepEqual(parseClock('09:30'), { minute: 9 * 60 + 30, ambiguous: true });
  });

  void test('1:00 to 12:59 with no AM/PM is read on the 24-hour clock and marked ambiguous', () => {
    assert.deepEqual(parseClock('2:35'), { minute: 2 * 60 + 35, ambiguous: true });
    assert.deepEqual(parseClock('12:30'), { minute: 12 * 60 + 30, ambiguous: true });
  });

  void test('anything else is undefined', () => {
    for (const text of ['', 'soon', '14', '13:00 PM', '0:30 AM', '2:60', '25:00', '2:3', '2:35 xm']) {
      assert.equal(parseClock(text), undefined, text);
    }
  });
});

void describe('startTicker — a table left open keeps moving', () => {
  void test('ticks at the interval asked for, and the stop clears that same interval', () => {
    const started: { ms: number; id: symbol }[] = [];
    const cleared: unknown[] = [];
    const id = Symbol('interval');
    const timers: Timers = {
      setInterval: (_run, ms) => {
        started.push({ ms, id });
        return id;
      },
      clearInterval: (x) => {
        cleared.push(x);
      },
    };
    const stop = startTicker(() => undefined, 60_000, timers);
    assert.deepEqual(started, [{ ms: 60_000, id }]);
    assert.deepEqual(cleared, [], 'cleared before anyone asked');
    stop();
    assert.deepEqual(cleared, [id], 'the stop did not clear the interval it started');
  });
});
