/**
 * My day's derivations (LAI-787, D-088): the person's own time in h:mm, an
 * agent's in minutes and **never hours**, a day nothing reached the board on
 * said as *No signal* rather than zero, and the week, the evidence and the
 * times a person types.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import type { MyDayWeekDay, TimeDraft, TimeEntry, TimeSignals } from '../../../../src/api/time.ts';
import {
  addDays,
  agentMinutes,
  atClock,
  canAddTime,
  canChange,
  dayIn,
  dayLabel,
  dayTotals,
  draftTarget,
  entryTarget,
  evidenceLine,
  isDay,
  minutesUnderstood,
  MODE_NOTES,
  parseMinutes,
  rangeLabel,
  splitAt,
  splitUnderstood,
  weekCell,
  weekDays,
} from '../../../../src/routes/screens/my-day/my-day-derive.ts';
import { formatDuration } from '../../../../src/api/duration.ts';
import { clockTime } from '../../../../src/api/time-label.ts';
import { code } from '../../../helpers/code.ts';

const SIGNALS: TimeSignals = { prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 };

const draft = (over: Partial<TimeDraft> = {}): TimeDraft => ({
  id: 'd1',
  source: 'collector',
  day: '2026-10-20',
  tz: 'Asia/Kolkata',
  // 09:40–11:05 IST on 20 October 2026.
  started_at: Date.UTC(2026, 9, 20, 4, 10),
  ended_at: Date.UTC(2026, 9, 20, 5, 35),
  minutes: 85,
  task: null,
  task_key: null,
  project: null,
  general: false,
  signals: SIGNALS,
  note: null,
  ...over,
});

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 'e1',
  day: '2026-10-20',
  tz: 'UTC',
  started_at: null,
  ended_at: null,
  minutes: 30,
  source: 'manual',
  task: null,
  project: null,
  note: null,
  revision: 1,
  created_at: 0,
  updated_at: 0,
  ...over,
});

void describe('two units: the person’s time in words, and an agent’s minutes', () => {
  void test('the person’s own time says its units, never h:mm (LAI-830)', async () => {
    const dir = new URL('../../../../src/routes/screens/my-day/', import.meta.url);
    for (const file of await readdir(dir)) {
      if (!/\.tsx?$/.test(file)) continue;
      const src = code(await readFile(new URL(file, dir), 'utf8'));
      // `hm` printed `0:19`; nothing on the screen may print a duration that way.
      assert.doesNotMatch(src, /\bhm\(/, `${file} still prints h:mm`);
    }
  });

  void test('an agent’s time is minutes, and never hours, however large (D-088 item 8)', () => {
    for (const n of [0, 1, 59, 60, 61, 142, 600, 1440, 5000]) {
      const label = agentMinutes(n);
      assert.equal(label, `${String(n)} min`);
      // Not `2 h`, not `2:22`, not `2.4 hours`: an hour figure beside the
      // person's own would read as theirs.
      assert.doesNotMatch(label, /\bh\b|hour|:/);
    }
  });

  void test('the agent strip draws every agent figure through agentMinutes, never hm', async () => {
    const src = code(
      await readFile(
        new URL('../../../../src/routes/screens/my-day/AgentStrip.tsx', import.meta.url),
        'utf8',
      ),
    );
    // The positive control: the strip does draw minutes, so the absence below
    // is not a file that draws nothing.
    assert.match(src, /agentMinutes\(agent\.minutes\)/);
    assert.match(src, /agentMinutes\(row\.minutes\)/);
    assert.doesNotMatch(src, /\bhm\(|formatDuration\(/, 'an agent figure drawn as hours');
    // And it says so to the reader, beside the figure.
    assert.match(src, /minutes, never hours/);
  });
});

void describe('what a person types', () => {
  void test('minutes in the shapes people write them', () => {
    assert.equal(parseMinutes('90'), 90);
    assert.equal(parseMinutes(' 45m '), 45);
    assert.equal(parseMinutes('45min'), 45);
    assert.equal(parseMinutes('1:30'), 90);
    assert.equal(parseMinutes('1h30'), 90);
    assert.equal(parseMinutes('1h'), 60);
    assert.equal(parseMinutes('1.5h'), 90);
  });

  void test('the forms the owner listed, and every duration the page prints (LAI-830)', () => {
    assert.equal(parseMinutes('45'), 45);
    assert.equal(parseMinutes('45m'), 45);
    assert.equal(parseMinutes('1h 30m'), 90);
    assert.equal(parseMinutes('1:30'), 90);
    assert.equal(parseMinutes('1 h 30 min'), 90);
    assert.equal(parseMinutes('45 mins'), 45);
    assert.equal(parseMinutes('2 hours'), 120);
    // Minutes… and Edit open prefilled with the row's own words, so each one
    // must read back as itself, all the way to a whole day.
    for (let n = 1; n <= 1440; n += 1) {
      assert.equal(parseMinutes(formatDuration(n)), n, formatDuration(n));
    }
  });

  void test('a How long field says what it understood, and nothing for nonsense', () => {
    assert.equal(minutesUnderstood('45'), 'Reads as 45 min');
    assert.equal(minutesUnderstood('1h 30m'), 'Reads as 1 h 30 min');
    assert.equal(minutesUnderstood('1:30'), 'Reads as 1 h 30 min');
    assert.equal(minutesUnderstood(''), undefined);
    assert.equal(minutesUnderstood('soon'), undefined);
  });

  void test('nothing, nonsense, zero and more than a day are refused', () => {
    for (const bad of ['', 'abc', '0', '1:75', '25h', '1441', '-5', '1h75']) {
      assert.equal(parseMinutes(bad), undefined, bad);
    }
    assert.equal(parseMinutes('1440'), 1440);
  });

  void test('a split time is the wall clock on that day in the block’s zone', () => {
    // 10:15 in Kolkata (UTC+5:30) is 04:45 UTC.
    assert.equal(atClock('2026-10-20', '10:15', 'Asia/Kolkata'), Date.UTC(2026, 9, 20, 4, 45));
    // Across a clock change: 09:00 in New York on 2 November 2026 is EST.
    assert.equal(atClock('2026-11-02', '09:00', 'America/New_York'), Date.UTC(2026, 10, 2, 14));
    assert.equal(atClock('2026-10-20', '25:00', 'UTC'), undefined);
    assert.equal(atClock('2026-10-20', 'ten', 'UTC'), undefined);
    assert.equal(atClock('nope', '10:00', 'UTC'), undefined);
    // The 12-hour form is read too.
    assert.equal(atClock('2026-10-20', '2:35 PM', 'UTC'), Date.UTC(2026, 9, 20, 14, 35));
  });

  void test('Split… takes the reading inside the block, and nothing outside it (LAI-830)', () => {
    const utc = (h: number, m = 0): number => Date.UTC(2026, 9, 20, h, m);
    const block = (from: number, to: number) => ({
      day: '2026-10-20',
      tz: 'UTC',
      started_at: from,
      ended_at: to,
    });
    const morning = block(utc(8, 40), utc(10, 15));
    assert.equal(splitAt(morning, '9:30'), utc(9, 30));
    assert.equal(splitAt(morning, '9:30 AM'), utc(9, 30));
    assert.equal(splitAt(morning, '9:30 PM'), undefined);
    assert.equal(splitAt(morning, '21:30'), undefined);
    // The ends are not inside: a split there would leave an empty half.
    assert.equal(splitAt(morning, '8:40'), undefined);
    assert.equal(splitAt(morning, '10:15'), undefined);

    // The owner's afternoon block: a bare 2:35 can only be 2:35 PM.
    const afternoon = block(utc(14, 29), utc(14, 48));
    assert.equal(splitAt(afternoon, '2:35'), utc(14, 35));
    assert.equal(splitAt(afternoon, '2:35 pm'), utc(14, 35));
    assert.equal(splitAt(afternoon, '14:35'), utc(14, 35));
    assert.equal(splitAt(afternoon, '2:35 AM'), undefined);

    // Across noon, 12:05 is noon, not midnight.
    assert.equal(splitAt(block(utc(11, 40), utc(12, 10)), '12:05'), utc(12, 5));

    // And in the block's own zone: 10:15 in Kolkata.
    assert.equal(splitAt(draft(), '10:15'), Date.UTC(2026, 9, 20, 4, 45));
    assert.equal(splitAt(draft({ started_at: null, ended_at: null }), '10:15'), undefined);

    assert.equal(splitUnderstood(afternoon, '2:35'), 'Splits at 2:35 PM');
    assert.equal(splitUnderstood(draft(), '10:15'), 'Splits at 10:15 AM');
    assert.equal(splitUnderstood(morning, '9:30 PM'), undefined);
  });
});

void describe('days and the week', () => {
  void test('a day is the person’s calendar day, in their zone', () => {
    const at = Date.UTC(2026, 9, 19, 20, 0); // 01:30 on the 20th in Kolkata
    assert.equal(dayIn('Asia/Kolkata', at), '2026-10-20');
    assert.equal(dayIn('UTC', at), '2026-10-19');
    assert.equal(clockTime(at, { timeZone: 'Asia/Kolkata' }), '1:30 AM');
  });

  void test('the week runs Monday to Sunday around any of its days', () => {
    const week = weekDays('2026-10-22'); // a Thursday
    assert.equal(week.length, 7);
    assert.equal(week[0], '2026-10-19');
    assert.equal(week[6], '2026-10-25');
    assert.deepEqual(weekDays('2026-10-19'), week);
    assert.deepEqual(weekDays('2026-10-25'), week);
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(dayLabel('2026-10-20'), 'Tue 20 Oct');
    assert.ok(isDay('2026-10-20'));
    assert.ok(!isDay('2026-13-40'));
    assert.ok(!isDay(undefined));
  });

  void test('a no-signal day is said so, and never drawn as zero hours', () => {
    const cell = (state: MyDayWeekDay['state'], confirmed = 0, drafted = 0): MyDayWeekDay => ({
      day: '2026-10-20',
      confirmed_minutes: confirmed,
      drafted_minutes: drafted,
      state,
    });
    assert.deepEqual(weekCell(cell('no_signal')), { label: 'No signal', figure: '—' });
    assert.doesNotMatch(weekCell(cell('no_signal')).figure, /0:00|^0/);
    assert.deepEqual(weekCell(cell('confirmed', 220)), {
      label: 'Confirmed',
      figure: '3 h 40 min',
    });
    assert.deepEqual(weekCell(cell('drafted', 60, 30)), { label: 'Drafted', figure: '1 h 30 min' });
    assert.deepEqual(weekCell(cell('future')), { label: '', figure: '' });
  });
});

void describe('a block in words', () => {
  void test('its evidence is counts, zeros left out, singular where one', () => {
    assert.equal(
      evidenceLine({ prompts: 12, replies: 34, sessions: 2, commits: 1, marks: 1 }, 'collector'),
      '12 prompts · 34 replies · 2 sessions · 1 commit · 1 task claimed',
    );
    assert.equal(
      evidenceLine({ ...SIGNALS, prompts: 1, replies: 1, sessions: 1 }, 'collector'),
      '1 prompt · 1 reply · 1 session',
    );
    assert.equal(evidenceLine(SIGNALS, 'collector'), 'No signals counted');
    assert.equal(evidenceLine(SIGNALS, 'agent'), 'Proposed by one of your agents');
  });

  void test('its time range is in its own zone, and absent when it has none', () => {
    assert.equal(rangeLabel(draft()), '9:40–11:05 AM');
    assert.equal(rangeLabel(draft({ started_at: null, ended_at: null })), '');
  });

  void test('what it is on — a card, a space, General, or still to pick', () => {
    const task = { id: 't', key: 'LAI-42', title: 'Fix the thing' };
    assert.deepEqual(draftTarget(draft({ task })), {
      label: 'LAI-42 Fix the thing',
      untied: false,
    });
    assert.deepEqual(draftTarget(draft({ project: { id: 'p', slug: 'core', name: 'Core' } })), {
      label: 'Core',
      untied: false,
    });
    assert.deepEqual(draftTarget(draft({ general: true })), { label: 'General', untied: false });
    assert.deepEqual(draftTarget(draft()), {
      label: 'No task — pick a card or General',
      untied: true,
    });
    assert.match(
      draftTarget(draft({ task_key: 'ONR-7' })).label,
      /ONR-7 is not a card you can see/,
    );
    assert.equal(entryTarget(entry()), 'General');
    assert.equal(entryTarget(entry({ task })), 'LAI-42 Fix the thing');
  });

  void test('the day’s totals keep confirmed and drafted apart', () => {
    assert.deepEqual(
      dayTotals({ drafts: [draft({ minutes: 20 }), draft({ minutes: 10 })], entries: [entry()] }),
      { confirmed: 30, drafted: 30 },
    );
  });
});

void describe('the organisation’s setting', () => {
  const settings = (org_mode: 'off' | 'manual' | 'drafts') => ({
    org_mode,
    draft_my_time: true,
    drafting: org_mode === 'drafts',
    min_sync_interval_s: 600,
  });

  void test('time may be added by hand unless Time is off', () => {
    assert.equal(canAddTime(settings('off')), false);
    assert.equal(canAddTime(settings('manual')), true);
    assert.equal(canAddTime(settings('drafts')), true);
    assert.match(MODE_NOTES.off, /nothing can be added/);
    assert.match(MODE_NOTES.manual, /Nothing is drafted/);
  });
});

void describe('My day is wired to the API and nothing else', () => {
  void test('no file of the screen imports a demo module or holds a fixture', async () => {
    const dir = new URL('../../../../src/routes/screens/my-day/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => /\.(ts|tsx)$/.test(f));
    // The positive control: the walk reached the screen itself.
    assert.ok(files.includes('MyDayScreen.tsx'), 'the walk missed MyDayScreen.tsx');
    for (const file of files) {
      const src = await readFile(new URL(file, dir), 'utf8');
      assert.doesNotMatch(src, /from '[^']*\/demo\//, `${file} imports a demo module`);
      assert.doesNotMatch(src, /Mira Kellner|kvelld\.internal|13\/34/, `${file} holds a fixture`);
    }
  });

  void test('the screen reads its day from GET /me/time', async () => {
    const src = code(
      await readFile(
        new URL('../../../../src/routes/screens/my-day/MyDayScreen.tsx', import.meta.url),
        'utf8',
      ),
    );
    assert.match(src, /getMyDay\(selected, tz, controller\.signal\)/);
  });
});

void describe('an entry from Solidtime is read-only here (LAI-788 review round 1)', () => {
  void test('the person changes their own entries, never one Solidtime holds', () => {
    assert.equal(canChange(entry()), true);
    assert.equal(canChange(entry({ source: 'draft' })), true);
    assert.equal(canChange(entry({ source: 'import' })), false);
  });

  void test('the row offers Edit and Delete only where it may, and says where to change an import', async () => {
    const src = code(
      await readFile(
        new URL('../../../../src/routes/screens/my-day/EntryRow.tsx', import.meta.url),
        'utf8',
      ),
    );
    assert.match(src, /canChange\(entry\)/);
    assert.match(src, /Change it in Solidtime/);
  });
});
