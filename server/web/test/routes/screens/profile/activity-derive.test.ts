/**
 * The activity heatmap's rules (D-079, LAI-751; LAI-1154): where a day sits,
 * how dark it is, the streaks, the busiest weekday, the share pushed, the
 * days before joining, and what a day says aloud. Each fixture is built so the wrong rule gives a different answer —
 * a Thursday start, a tie between weekdays, an empty today.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PeopleActivity } from '../../../../src/api/people-activity.ts';
import {
  activityStats,
  agentLabel,
  calendarLayout,
  combined,
  dayLines,
  dayText,
  designKey,
  emptyDays,
  heatDays,
  joinedDay,
  joinedNote,
  levelScale,
  moveIndex,
  openingRange,
  rangeDays,
  shortDate,
  singleBusiest,
  sourceTotals,
  spanLabel,
  storedDesign,
  totalLine,
  weekdayOf,
  type HeatDay,
} from '../../../../src/routes/screens/profile/activity-derive.ts';

/** A response over `start` with the given per-day values, the rest zero. */
function activity(
  start: string,
  length: number,
  over: Partial<Record<keyof PeopleActivity['series'], (number | null)[] | null>> = {},
  extra: Partial<PeopleActivity> = {},
): PeopleActivity {
  const zeros = () => new Array<number>(length).fill(0);
  const pad = (values: (number | null)[] | null | undefined) =>
    values === null
      ? null
      : values === undefined
        ? zeros()
        : [...values, ...zeros()].slice(0, length);
  return {
    range: '12w',
    start,
    end: start,
    tz: 'UTC',
    sharing: { org_enabled: true, enabled: true },
    series: {
      github: pad(over.github) as number[] | null,
      local_commits: pad(over.local_commits) as number[] | null,
      prompts: pad(over.prompts) as number[] | null,
      sessions: pad(over.sessions) as number[] | null,
      board_self: pad(over.board_self) as number[],
      board_agent: pad(over.board_agent) as number[],
    },
    prompts_by_agent: {},
    agents: [],
    ...extra,
  };
}

const day = (over: Partial<HeatDay>): HeatDay => ({
  index: 0,
  day: '2026-10-15',
  weekday: 3,
  github: 0,
  localCommits: 0,
  prompts: 0,
  sessions: 0,
  local: 0,
  pre: false,
  promptsByAgent: {},
  ...over,
});

void describe('days from the response', () => {
  void test('one per integer, dated from start, with Local the sum of its three counts', () => {
    const days = heatDays(
      activity('2026-10-12', 3, {
        github: [1, 0, 4],
        local_commits: [0, 2, 0],
        prompts: [5, 0, 0],
        sessions: [1, 0, 0],
        board_self: [0, 1, 0],
        board_agent: [2, 0, 0],
      }),
    );
    assert.deepEqual(
      days.map((d) => [d.day, d.weekday, d.github, d.local, d.pre]),
      [
        ['2026-10-12', 0, 1, 6, false],
        ['2026-10-13', 1, 0, 2, false],
        ['2026-10-14', 2, 4, 0, false],
      ],
    );
  });

  void test('a source not collected stays null — never read as zero', () => {
    const days = heatDays(
      activity('2026-10-12', 2, {
        github: null,
        local_commits: null,
        prompts: null,
        sessions: null,
      }),
    );
    assert.deepEqual(
      days.map((d) => [d.github, d.local]),
      [
        [null, null],
        [null, null],
      ],
    );
  });

  void test('the ranges are the server’s lengths', () => {
    assert.equal(rangeDays('12w'), 84);
    assert.equal(rangeDays('52w'), 364);
    const skeleton = emptyDays('2026-10-15', 84);
    assert.equal(skeleton.length, 84);
    assert.equal(skeleton.at(-1)?.day, '2026-10-15');
    assert.equal(skeleton[0]?.day, '2026-07-24');
  });
});

void describe('the calendar', () => {
  void test('weeks are columns, Monday on top; a Thursday start leaves the first column’s top empty', () => {
    // 2026-10-15 is a Thursday.
    assert.equal(weekdayOf('2026-10-15'), 3);
    const layout = calendarLayout(emptyDays('2026-10-25', 11));
    // Thu 15 → Sun 25: column 0 is Thu–Sun, column 1 Mon–Sun.
    assert.equal(layout.columns, 2);
    assert.deepEqual(
      layout.placed.map((p) => [p.day.day.slice(8), p.column, p.row]),
      [
        ['15', 0, 3],
        ['16', 0, 4],
        ['17', 0, 5],
        ['18', 0, 6],
        ['19', 1, 0],
        ['20', 1, 1],
        ['21', 1, 2],
        ['22', 1, 3],
        ['23', 1, 4],
        ['24', 1, 5],
        ['25', 1, 6],
      ],
    );
  });

  void test('a month is labelled at the column holding its 1st, and spans to the next', () => {
    const layout = calendarLayout(emptyDays('2026-12-31', 84));
    assert.deepEqual(
      layout.months.map((m) => m.label),
      ['Oct', 'Nov', 'Dec'],
    );
    const firsts: Readonly<Record<string, string>> = {
      Oct: '2026-10-01',
      Nov: '2026-11-01',
      Dec: '2026-12-01',
    };
    for (const m of layout.months) {
      const first = layout.placed.find((p) => p.day.day === firsts[m.label]);
      // October's 1st is before the range: its label sits on the first column.
      assert.equal(m.column, first?.column ?? 0, m.label);
    }
    const spans = layout.months.reduce((sum, m) => sum + m.span, 0);
    assert.equal(spans + (layout.months[0]?.column ?? 0), layout.columns);
  });

  void test('a sliver of a month at the start gets no label to collide with the next', () => {
    // Starts Sat 31 Oct 2026: October is one column at most before November.
    const layout = calendarLayout(emptyDays('2026-12-20', 51));
    assert.equal(layout.placed[0]?.day.day, '2026-10-31');
    assert.equal(layout.months[0]?.label, 'Nov');
  });

  void test('a month whose 1st is in the last column gets no label to run off the end (LAI-1017)', () => {
    // Sun 1 Nov 2026 closes the week of Mon 26 Oct: November is the last
    // column alone, and October runs to the end instead.
    const sliver = calendarLayout(emptyDays('2026-11-01', 364));
    assert.equal(sliver.placed.at(-1)?.column, sliver.columns - 1);
    assert.deepEqual(sliver.months.at(-1), { label: 'Oct', column: sliver.columns - 5, span: 5 });
    const spans = sliver.months.reduce((sum, m) => sum + m.span, 0);
    assert.equal(spans + (sliver.months[0]?.column ?? 0), sliver.columns);
    // A day later November has two columns, and its label.
    const room = calendarLayout(emptyDays('2026-11-02', 364));
    assert.deepEqual(room.months.at(-1), { label: 'Nov', column: room.columns - 2, span: 2 });
  });

  void test('a 1st on a Monday opens a column alone, and is named once the next week begins', () => {
    // Mon 1 Mar 2027: the newest column holds that one day.
    const alone = calendarLayout(emptyDays('2027-03-01', 364));
    assert.equal(weekdayOf('2027-03-01'), 0);
    assert.equal(alone.months.at(-1)?.label, 'Feb');
    assert.equal(alone.months.at(-1)?.column, alone.columns - 5);
    assert.equal(alone.months.at(-1)?.span, 5);
    // Mon 8 Mar 2027: March has two columns.
    const named = calendarLayout(emptyDays('2027-03-08', 364));
    assert.deepEqual(named.months.at(-1), { label: 'Mar', column: named.columns - 2, span: 2 });
  });

  void test('across the new year: January waits for its room like any month', () => {
    // Fri 1 Jan 2027 closes nothing — it shares the week of Mon 28 Dec.
    const eve = calendarLayout(emptyDays('2027-01-01', 364));
    assert.equal(eve.months.at(-1)?.label, 'Dec');
    assert.equal(eve.months.at(-1)?.column, eve.columns - 5);
    assert.equal(eve.months.at(-1)?.span, 5);
    const spans = eve.months.reduce((sum, m) => sum + m.span, 0);
    assert.equal(spans + (eve.months[0]?.column ?? 0), eve.columns);
    // Mon 4 Jan 2027: January has two columns.
    const after = calendarLayout(emptyDays('2027-01-04', 364));
    assert.deepEqual(after.months.at(-1), { label: 'Jan', column: after.columns - 2, span: 2 });
  });
});

void describe('how dark a day is', () => {
  void test('zero is empty, and the rest split into four by the source’s own quartiles', () => {
    const level = levelScale([0, 1, 2, 3, 4, 5, 6, 7, 8, null]);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, null].map(level), [0, 1, 1, 2, 2, 3, 3, 4, 4, 0]);
  });

  void test('the busiest day is the darkest, even with two days to go on', () => {
    const level = levelScale([0, 1, 0, 4]);
    assert.equal(level(4), 4);
    assert.equal(level(1), 1);
  });

  void test('a source with nothing is all empty, whatever it is asked', () => {
    const level = levelScale([0, 0, null]);
    assert.equal(level(5), 0);
  });

  void test('each source on its own scale: a big prompt day and a small push day can both be dark', () => {
    const local = levelScale([10, 200, 400, 800]);
    const github = levelScale([1, 1, 2, 3]);
    assert.equal(local(800), 4);
    assert.equal(github(3), 4);
  });
});

void describe('the stats row', () => {
  const run = (activeFlags: readonly boolean[], start = '2026-10-05') =>
    heatDays(
      activity(start, activeFlags.length, {
        github: activeFlags.map((on) => (on ? 1 : 0)),
      }),
    );

  void test('counts active days, and the longest run with its span', () => {
    // Mon 5 Oct …: on, on, off, on, on, on, off
    const stats = activityStats(run([true, true, false, true, true, true, false]));
    assert.equal(stats.activeDays, 5);
    assert.equal(stats.totalDays, 7);
    assert.deepEqual(stats.longestStreak, { days: 3, from: '2026-10-08', to: '2026-10-10' });
  });

  void test('a streak still standing at yesterday is current; an empty day before that ends it', () => {
    assert.equal(activityStats(run([true, true, false, true, true, false])).currentStreak, 2);
    assert.equal(activityStats(run([true, true, false, true, true, true])).currentStreak, 3);
    assert.equal(activityStats(run([true, true, false, false])).currentStreak, 0);
  });

  void test('the busiest weekday is the one active most often; a tie names every one (LAI-751)', () => {
    // Two weeks from Monday: Mondays both active, Wednesdays both, Friday once.
    const flags = [
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
    ];
    const stats = activityStats(run(flags));
    assert.deepEqual(stats.busiestWeekday, { weekdays: [0, 2], active: 2, of: 2 });
    assert.equal(activityStats(run([false, false])).busiestWeekday, null);
    // One clear winner: just that one.
    const friday = [...flags];
    friday[11] = true;
    assert.deepEqual(activityStats(run(friday)).busiestWeekday, {
      weekdays: [0, 2, 4],
      active: 2,
      of: 2,
    });
    const monday = [...flags];
    monday[0] = true;
    monday[7] = true;
    monday[2] = false;
    assert.deepEqual(activityStats(run(monday)).busiestWeekday, {
      weekdays: [0],
      active: 2,
      of: 2,
    });
  });

  void test('pushed vs local is the share of commits already pushed, and says nothing when it cannot', () => {
    const shared = heatDays(
      activity('2026-10-05', 3, { github: [3, 1, 0], local_commits: [0, 0, 1] }),
    );
    assert.equal(activityStats(shared).pushedPercent, 80);

    const noCommits = heatDays(activity('2026-10-05', 3, { prompts: [4, 0, 0] }));
    assert.equal(activityStats(noCommits).pushedPercent, null);

    const notShared = heatDays(
      activity('2026-10-05', 3, {
        github: null,
        local_commits: null,
        prompts: null,
        sessions: null,
      }),
    );
    assert.equal(activityStats(notShared).pushedPercent, null);
  });
});

void describe('Stacked and the legends (LAI-1154)', () => {
  void test('Stacked is GitHub and Local together, on one scale; nothing shown is null', () => {
    assert.equal(combined(day({ github: 3, local: 4 })), 7);
    assert.equal(combined(day({ github: null, local: 2 })), 2);
    assert.equal(combined(day({ github: null, local: null })), null);
  });

  void test('a board action alone is not an active day — the board is not on the card', () => {
    const days = heatDays(
      activity('2026-10-05', 3, { board_self: [5, 5, 5], board_agent: [2, 2, 2] }),
    );
    assert.equal(activityStats(days).activeDays, 0);
  });

  void test('each source’s line: commits pushed; prompts · sessions · not pushed, or none yet', () => {
    const days = heatDays(
      activity('2026-10-05', 3, {
        github: [6000, 6, 0],
        prompts: [80, 5, 0],
        sessions: [83, 0, 0],
        local_commits: [0, 0, 9],
      }),
    );
    const totals = sourceTotals(days);
    assert.equal(totalLine('github', totals), '6,006 commits pushed');
    assert.equal(totalLine('local', totals), '85 prompts · 83 sessions · 9 not pushed');
    const quiet = sourceTotals(heatDays(activity('2026-10-05', 3, { github: [3, 0, 0] })));
    assert.equal(totalLine('github', quiet), '3 commits pushed');
    assert.equal(totalLine('local', quiet), 'No local activity yet');
  });

  void test('the busiest weekday is named only when one is ahead on three days or more', () => {
    // Three weeks from Monday 5 Oct.
    const weeks = (on: (i: number) => boolean) =>
      activityStats(
        heatDays(
          activity('2026-10-05', 21, {
            github: Array.from({ length: 21 }, (_, i) => (on(i) ? 1 : 0)),
          }),
        ),
      );
    // Every Friday: three of three.
    const fridays = weeks((i) => i % 7 === 4);
    assert.equal(singleBusiest(fridays), 4);
    assert.deepEqual(fridays.busiestWeekday, { weekdays: [4], active: 3, of: 3 });
    // Fridays and Mondays tie: no single day.
    assert.equal(singleBusiest(weeks((i) => i % 7 === 4 || i % 7 === 0)), null);
    // Two Fridays only: too few to call.
    assert.equal(singleBusiest(weeks((i) => i === 4 || i === 11)), null);
  });
});

void describe('before joining (LAI-1154)', () => {
  void test('the joining day is the series’ zone’s date, not UTC’s', () => {
    // 22:30 UTC on 1 Nov is 2 Nov in Johannesburg, still 1 Nov in UTC.
    const at = Date.parse('2026-11-01T22:30:00Z');
    assert.equal(joinedDay(at, 'Africa/Johannesburg'), '2026-11-02');
    assert.equal(joinedDay(at, 'UTC'), '2026-11-01');
    assert.equal(joinedDay(at, 'Not/AZone'), '2026-11-01');
  });

  void test('days before it are marked, say so aloud, and count in no stat', () => {
    // Mon 26 Oct … Fri 6 Nov; joined Mon 2 Nov, active every day since.
    const days = heatDays(
      activity('2026-10-26', 12, {
        github: [9, 9, 9, 9, 9, 9, 1, 1, 1, 1, 1, 0],
        prompts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
      }),
      '2026-11-02',
    );
    assert.deepEqual(
      days.map((d) => d.pre),
      [true, true, true, true, true, true, true, false, false, false, false, false],
    );
    assert.equal(dayText(days[0]!), 'Monday 26 Oct 2026 · before joining');
    const stats = activityStats(days);
    assert.equal(stats.activeDays, 5);
    assert.equal(stats.totalDays, 5);
    assert.equal(stats.sinceJoining, true);
    assert.equal(stats.currentStreak, 5);
    assert.deepEqual(stats.longestStreak, { days: 5, from: '2026-11-02', to: '2026-11-06' });
    // 9s before joining are not their commits on the card.
    assert.equal(stats.pushed, 4);
    // The skeleton marks the same days.
    assert.equal(emptyDays('2026-11-06', 12, '2026-11-02').filter((d) => d.pre).length, 7);
  });

  void test('with no day before it, nothing is “since joining”', () => {
    const stats = activityStats(heatDays(activity('2026-10-26', 7), '2026-01-01'));
    assert.equal(stats.sinceJoining, false);
    assert.equal(stats.totalDays, 7);
  });

  void test('the caption names the joining day only when it is inside the range', () => {
    const days = emptyDays('2026-11-06', 84);
    assert.equal(joinedNote(days, '2026-11-02'), 'joined Mon 2 Nov');
    assert.equal(joinedNote(days, '2025-01-01'), null);
  });
});

void describe('what a day says', () => {
  void test('every source, the agents by name — Gemini CLI, and other as Other agent', () => {
    const d = day({
      github: 4,
      localCommits: 2,
      prompts: 23,
      sessions: 3,
      local: 28,
      promptsByAgent: { 'gemini-cli': 5, 'claude-code': 18, other: 1 },
    });
    assert.equal(
      dayText(d),
      'Thursday 15 Oct 2026: 4 commits pushed, 2 local commits not pushed, 23 prompts (Claude Code 18, Gemini CLI 5, Other agent 1), 3 agent sessions',
    );
    assert.equal(agentLabel('other'), 'Other agent');
    assert.equal(agentLabel('gemini-cli'), 'Gemini CLI');
  });

  void test('a source not collected says so instead of a zero', () => {
    const lines = dayLines(
      day({ github: null, localCommits: null, prompts: null, sessions: null, local: null }),
    );
    assert.deepEqual(
      lines.map((l) => [l.n, l.text]),
      [
        [null, 'pushed commits not collected'],
        [null, 'local activity not collected'],
      ],
    );
  });

  void test('dates read as a person writes them', () => {
    assert.equal(shortDate('2026-10-07'), 'Wed 7 Oct');
    // The design writes a streak's span with the month on both ends.
    assert.equal(spanLabel('2026-01-11', '2026-01-16'), '11 Jan – 16 Jan');
    assert.equal(spanLabel('2026-02-28', '2026-03-03'), '28 Feb – 3 Mar');
    assert.equal(spanLabel('2026-10-07', '2026-10-07'), '7 Oct');
  });
});

void describe('the viewer’s choices', () => {
  void test('the design is remembered per viewer, and Split by default, as the design opens', () => {
    assert.equal(designKey('u1'), 'laika.profile.activity-design.u1');
    assert.notEqual(designKey('u1'), designKey('u2'));
    assert.equal(storedDesign(null), 'split');
    assert.equal(storedDesign('rubbish'), 'split');
    assert.equal(storedDesign('stacked'), 'stacked');
  });

  void test('opens on 12 weeks on a phone or for a member of under 12 weeks, else a year', () => {
    const now = Date.parse('2026-11-06T09:00:00Z');
    const days = (n: number) => now - n * 86_400_000;
    assert.equal(openingRange(false, days(400), now), '52w');
    assert.equal(openingRange(true, days(400), now), '12w');
    assert.equal(openingRange(false, days(4), now), '12w');
    // Twelve weeks to the day is no longer under twelve weeks.
    assert.equal(openingRange(false, days(84), now), '52w');
    assert.equal(openingRange(false, days(83), now), '12w');
  });

  void test('arrow keys move a week sideways and a day up and down, held at the edges', () => {
    assert.equal(moveIndex(10, 'ArrowRight', 84), 17);
    assert.equal(moveIndex(10, 'ArrowLeft', 84), 3);
    assert.equal(moveIndex(10, 'ArrowDown', 84), 11);
    assert.equal(moveIndex(10, 'ArrowUp', 84), 9);
    assert.equal(moveIndex(80, 'ArrowRight', 84), 83);
    assert.equal(moveIndex(2, 'ArrowLeft', 84), 0);
    assert.equal(moveIndex(40, 'Home', 84), 0);
    assert.equal(moveIndex(40, 'End', 84), 83);
    assert.equal(moveIndex(40, 'Enter', 84), null);
  });
});
