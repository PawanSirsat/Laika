import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OffDay } from '../../../../src/api/off-days.ts';
import {
  barOf,
  boxDetail,
  busiest,
  cellKind,
  heatScale,
  offMark,
  offTones,
  periodFigure,
  weekBoxes,
  weekHours,
} from '../../../../src/routes/screens/my-day/span-derive.ts';

/**
 * What Week, Month and Year draw (LAI-1174): **no target** — a bar is a
 * share of the period's busiest day and the year's heat its own quartiles,
 * never a fixed length of day — and a day nothing reached is no signal.
 */

const day = (confirmed: number, drafted: number, state = 'confirmed') => ({
  confirmed_minutes: confirmed,
  drafted_minutes: drafted,
  state: state as 'confirmed' | 'drafted' | 'no_signal' | 'future',
});

void describe('bars', () => {
  void test('a share of the busiest day, never of eight hours', () => {
    const days = [day(120, 0), day(60, 60), day(0, 0, 'no_signal')];
    const top = busiest(days);
    assert.equal(top, 120);
    assert.deepEqual(barOf(days[0]!, top), { confirmed: 1, drafted: 0 });
    assert.deepEqual(barOf(days[1]!, top), { confirmed: 0.5, drafted: 0.5 });
    // A part-time week still fills its busiest bar: no 480-minute yardstick.
    assert.equal(barOf(day(120, 0), busiest([day(120, 0)])).confirmed, 1);
  });

  void test('an empty period does not divide by nothing', () => {
    assert.equal(busiest([day(0, 0, 'no_signal')]), 1);
    assert.equal(busiest([]), 1);
  });
});

void describe('heatScale', () => {
  void test('quartiles of the period’s own working days; nothing is 0', () => {
    const heat = heatScale([0, 60, 120, 180, 240, 300, 360, 420, 480]);
    assert.equal(heat(0), 0);
    assert.equal(heat(60), 1);
    assert.equal(heat(480), 4);
    const levels = [60, 120, 180, 240, 300, 360, 420, 480].map(heat);
    assert.deepEqual([...levels].sort(), levels, 'more time is never less heat');
  });

  void test('relative, not absolute: a short year’s busiest days are darkest too', () => {
    const short = heatScale([30, 40, 50, 60]);
    assert.equal(short(60), 4);
    const long = heatScale([300, 400, 500, 600]);
    assert.equal(long(60), 1);
  });

  void test('a year with nothing is all 0', () => {
    assert.equal(heatScale([0, 0])(0), 0);
  });
});

void describe('cells and figures', () => {
  void test('no signal and future are said as such, never as zero hours', () => {
    assert.equal(cellKind({ state: 'no_signal' }), 'no_signal');
    assert.equal(cellKind({ state: 'future' }), 'future');
    assert.equal(cellKind({ state: 'drafted' }), 'time');
  });

  void test('a period’s figure', () => {
    assert.deepEqual(periodFigure([day(60, 30), day(0, 0, 'no_signal')]), {
      total: 90,
      drafted: 30,
      confirmed: 60,
      kind: 'time',
    });
    assert.equal(periodFigure([day(0, 0, 'no_signal'), day(0, 0, 'future')]).kind, 'no_signal');
    assert.equal(periodFigure([day(0, 0, 'future')]).kind, 'future');
  });
});

/** A day off as the server sends it (LAI-1183's `OffDayView`). */
const HOLIDAY: OffDay = { holiday: { label: 'Heritage Day' }, leave: null };
const LEAVE: OffDay = {
  holiday: null,
  leave: { part: 'full', status: 'approved', type: 'Annual' },
};
const HALF: OffDay = {
  holiday: null,
  leave: { part: 'first_half', status: 'approved', type: null },
};
const REQUESTED: OffDay = {
  holiday: null,
  leave: { part: 'full', status: 'pending', type: null },
};

void describe('a day off (D-149, LAI-1184)', () => {
  void test('a holiday or approved whole-day leave with no time is off, never no signal', () => {
    assert.equal(cellKind({ state: 'no_signal', off: HOLIDAY }), 'off');
    assert.equal(cellKind({ state: 'no_signal', off: LEAVE }), 'off');
    // Still to come, it is off already: the day owes nothing either way.
    assert.equal(cellKind({ state: 'future', off: HOLIDAY }), 'off');
  });

  void test('time wins: a day off with time keeps its figure', () => {
    assert.equal(cellKind({ state: 'confirmed', off: HOLIDAY }), 'time');
    assert.equal(cellKind({ state: 'drafted', off: LEAVE }), 'time');
  });

  void test('half-day leave still owes half, and pending leave owes all: neither is off', () => {
    assert.equal(cellKind({ state: 'no_signal', off: HALF }), 'no_signal');
    assert.equal(cellKind({ state: 'no_signal', off: REQUESTED }), 'no_signal');
    assert.equal(cellKind({ state: 'future', off: REQUESTED }), 'future');
    // A row without the field — an older fixture — is read as no day off.
    assert.equal(cellKind({ state: 'no_signal' }), 'no_signal');
    assert.equal(cellKind({ state: 'no_signal', off: null }), 'no_signal');
  });

  void test('how a tile carries it: tinted, dotted, half filled or only dashed', () => {
    assert.equal(offMark({ state: 'no_signal', off: HOLIDAY }), 'tint');
    assert.equal(offMark({ state: 'future', off: LEAVE }), 'tint');
    assert.equal(offMark({ state: 'confirmed', off: HOLIDAY }), 'dot');
    assert.equal(offMark({ state: 'drafted', off: LEAVE }), 'dot');
    assert.equal(offMark({ state: 'no_signal', off: HALF }), 'half');
    // Pending leave is an outline whether or not the day has time — never the fill.
    assert.equal(offMark({ state: 'no_signal', off: REQUESTED }), 'dash');
    assert.equal(offMark({ state: 'confirmed', off: REQUESTED }), 'dash');
    assert.equal(offMark({ state: 'no_signal', off: null }), null);
    assert.equal(offMark({ state: 'confirmed' }), null);
  });

  void test('a holiday wins over leave on the same day', () => {
    const both: OffDay = { holiday: HOLIDAY.holiday, leave: REQUESTED.leave };
    assert.equal(offMark({ state: 'no_signal', off: both }), 'tint');
  });

  void test('the legend names the tones the period holds, in one order', () => {
    assert.deepEqual(offTones([{ off: REQUESTED }, { off: null }, { off: HOLIDAY }, {}]), [
      'holiday',
      'requested',
    ]);
    assert.deepEqual(offTones([{ off: LEAVE }, { off: HALF }, { off: HOLIDAY }]), [
      'holiday',
      'leave',
    ]);
    assert.deepEqual(offTones([{ off: null }, {}]), []);
  });
});

void describe('the week grid', () => {
  void test('the hours fit the blocks — an early start is shown, never clamped away', () => {
    assert.deepEqual(
      weekHours([
        { start: 5 * 60 + 30, end: 9 * 60 },
        { start: 13 * 60, end: 21 * 60 + 10 },
      ]),
      {
        from: 5,
        to: 22,
      },
    );
    assert.deepEqual(weekHours([]), { from: 8, to: 18 });
  });

  void test('two blocks at once sit side by side, a lone one has the column', () => {
    const boxes = weekBoxes(
      [
        { id: 'a', start: 600, end: 660 },
        { id: 'b', start: 630, end: 690 },
        { id: 'c', start: 780, end: 840 },
      ],
      { from: 9, to: 15 },
    );
    assert.deepEqual(
      boxes.map((b) => [b.id, b.row, b.rows]),
      [
        ['a', 0, 2],
        ['b', 1, 2],
        ['c', 0, 1],
      ],
    );
    assert.equal(boxes[0]?.top, (600 - 540) / 360);
    assert.equal(boxes[0]?.height, 60 / 360);
  });

  void test('how much a block says, by its length', () => {
    assert.equal(boxDetail(20), 'none');
    assert.equal(boxDetail(25), 'key');
    assert.equal(boxDetail(55), 'length');
    assert.equal(boxDetail(85), 'title');
  });
});
