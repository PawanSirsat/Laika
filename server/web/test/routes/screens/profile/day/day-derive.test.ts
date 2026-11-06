import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TimeDraft, TimeEntry } from '../../../../../src/api/time.ts';
import {
  clock24,
  dayPanel,
  dayTitle,
  hours,
} from '../../../../../src/routes/screens/profile/day/day-derive.ts';

/**
 * The profile's Day tab (LAI-1155, D-139 items 6–7): tiles and rows in hours,
 * a timeline from 08:00 to 18:00 stretched to fit, drafts with no kind, and
 * the agents beside the day, never in it. Every fixture is in UTC.
 */

const DAY = '2026-11-06';
const at = (hh: number, mm = 0, day = DAY): number =>
  Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);

function entry(id: string, from: number, to: number, extra: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id,
    day: DAY,
    tz: 'UTC',
    started_at: from,
    ended_at: to,
    minutes: Math.round((to - from) / 60_000),
    source: 'manual',
    task: null,
    project: null,
    note: null,
    kind: 'work',
    title: null,
    description: null,
    revision: 1,
    created_at: 1,
    updated_at: 1,
    ...extra,
  };
}

function draft(id: string, from: number, to: number, extra: Partial<TimeDraft> = {}): TimeDraft {
  return {
    id,
    source: 'collector',
    day: DAY,
    tz: 'UTC',
    started_at: from,
    ended_at: to,
    minutes: Math.round((to - from) / 60_000),
    task: null,
    task_key: null,
    project: null,
    general: false,
    signals: { prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 },
    note: null,
    ...extra,
  };
}

type View = Parameters<typeof dayPanel>[0];

function view(over: Partial<View> = {}): View {
  return {
    day: DAY,
    tz: 'UTC',
    today: DAY,
    breaks: [],
    entries: [
      entry('e2', at(9), at(10, 45), {
        task: { id: 't1', key: 'LAIKA-657', title: 'Settle the day summary' },
      }),
      entry('e1', at(8, 30), at(9), { kind: 'meeting', title: 'Stand-up' }),
    ],
    drafts: [
      draft('d1', at(13), at(14, 20), {
        task: { id: 't2', key: 'SKY-40', title: 'Decrypt test fails' },
      }),
    ],
    agent: {
      minutes: 50,
      keyboard_minutes: 0,
      by_task: [
        { task: { id: 't1', key: 'LAIKA-657', title: 'x' }, minutes: 30 },
        { task: { id: 't2', key: 'SKY-40', title: 'y' }, minutes: 82 },
      ],
      unattributed_minutes: 0,
      lane: [
        [at(9, 30), 300, 300],
        [at(9, 35), 300, 300],
        [at(12), 300, 0],
      ],
    },
    ...over,
  };
}

const H_MM = /\d:\d\d/;

void describe('the Day tab’s figures (LAI-1155)', () => {
  void test('tiles: tracked is confirmed plus drafts, meetings are confirmed meetings — in hours', () => {
    const panel = dayPanel(view(), at(15));
    assert.deepEqual(
      panel.tiles.map((t) => [t.id, t.value]),
      [
        ['tracked', '3h 35m'],
        ['confirmed', '2h 15m'],
        ['drafts', '1h 20m'],
        ['meetings', '30m'],
      ],
    );
    for (const tile of panel.tiles) assert.doesNotMatch(tile.value, H_MM);
  });

  void test('rows in the order they happened, 24-hour, durations in hours; a draft has no kind', () => {
    const rows = dayPanel(view(), at(15)).rows;
    assert.deepEqual(
      rows.map((r) => [r.when, r.key, r.title, r.kind, r.duration, r.status]),
      [
        ['08:30–09:00', null, 'Stand-up', 'meeting', '30m', 'confirmed'],
        ['09:00–10:45', 'LAIKA-657', 'Settle the day summary', 'work', '1h 45m', 'confirmed'],
        ['13:00–14:20', 'SKY-40', 'Decrypt test fails', null, '1h 20m', 'draft'],
      ],
    );
    for (const row of rows) assert.doesNotMatch(row.duration, H_MM);
  });

  void test('an entry with no times lists last, its when a dash', () => {
    const v = view({
      entries: [{ ...entry('e9', at(7), at(8)), started_at: null, ended_at: null, minutes: 20 }],
      drafts: [draft('d1', at(13), at(14))],
    });
    const rows = dayPanel(v, at(15)).rows;
    assert.deepEqual(
      rows.map((r) => [r.id, r.when]),
      [
        ['d1', '13:00–14:00'],
        ['e9', '—'],
      ],
    );
  });

  void test('the axis is 08:00 to 18:00, stretched to hold an entry outside it', () => {
    const plain = dayPanel(view(), at(15));
    assert.deepEqual([plain.from, plain.to], [8, 18]);
    assert.equal(plain.ticks[0]?.label, '08:00');
    assert.equal(plain.ticks.at(-1)?.label, '18:00');
    const wide = dayPanel(
      view({ entries: [entry('e1', at(6, 30), at(7)), entry('e2', at(18, 15), at(19, 10))] }),
      at(15),
    );
    assert.deepEqual([wide.from, wide.to], [6, 20]);
  });

  void test('blocks sit where they happened; a draft is drawn as a draft with no kind', () => {
    const panel = dayPanel(view(), at(15));
    const meeting = panel.blocks.find((b) => b.id === 'e1');
    assert.ok(meeting !== undefined);
    // 08:30 on an axis of ten hours is 5% along; half an hour is 5% wide.
    assert.ok(Math.abs(meeting.left - 5) < 1e-9);
    assert.ok(Math.abs(meeting.width - 5) < 1e-9);
    assert.equal(meeting.label, 'Meeting');
    const d = panel.blocks.find((b) => b.id === 'd1');
    assert.deepEqual(
      [d?.status, d?.kind, d?.label, d?.sub],
      ['draft', null, 'SKY-40', 'Decrypt test fails'],
    );
  });

  void test('the now line is drawn on today, inside the axis, and on no other day', () => {
    assert.ok(Math.abs((dayPanel(view(), at(15)).now ?? -1) - 70) < 1e-9);
    assert.equal(dayPanel(view({ today: '2026-11-07' }), at(15, 0, '2026-11-07')).now, undefined);
    assert.equal(dayPanel(view(), at(22)).now, undefined);
  });

  void test('agents: the buckets as bars, unnamed; on cards is the by-task sum, beside the day', () => {
    const panel = dayPanel(view(), at(15));
    assert.equal(panel.agents.length, 2);
    assert.deepEqual(
      panel.agents.map((a) => a.onCard),
      [true, false],
    );
    assert.equal(panel.agentOnCards, 112);
    assert.equal(hours(panel.agentOnCards), '1h 52m');
    // Never added to the person's hours.
    assert.equal(panel.tiles[0]?.value, '3h 35m');
  });

  void test('a phone labels every third hour', () => {
    const shown = dayPanel(view(), at(15))
      .ticks.filter((t) => !t.minor)
      .map((t) => t.label);
    assert.deepEqual(shown, ['08:00', '11:00', '14:00', '17:00']);
  });

  void test('a day with no entries and no drafts is empty, whatever the agents did', () => {
    assert.equal(dayPanel(view({ entries: [], drafts: [] }), at(15)).empty, true);
    assert.equal(dayPanel(view({ entries: [] }), at(15)).empty, false);
  });
});

void describe('the Day tab’s words', () => {
  void test('the date, and today said so', () => {
    assert.equal(dayTitle(DAY, DAY), 'Friday 6 November · today');
    assert.equal(dayTitle('2026-11-05', DAY), 'Thursday 5 November');
  });

  void test('the clock is 24-hour in the entry’s zone', () => {
    assert.equal(clock24(at(14, 20), 'UTC'), '14:20');
    assert.equal(clock24(at(14, 20), 'Asia/Kolkata'), '19:50');
  });
});
