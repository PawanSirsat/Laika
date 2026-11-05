import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EntryKind, TimeReport, TimeReportRow } from '../../../src/api/time.ts';
import {
  axisFor,
  barKey,
  canSwap,
  childCount,
  dayBars,
  defaultGrouping,
  donutBackground,
  faceOf,
  firstFocus,
  firstGroupings,
  groupRows,
  hoursClock,
  hoursWords,
  monthOf,
  NO_KIND,
  NONE_COLOR,
  OTHER_COLOR,
  presetRange,
  rangeProblem,
  refusalReason,
  secondGroupings,
  shareLabel,
  shownFor,
  slicesOf,
  statsOf,
  stepped,
  stepUnit,
  stretchLabel,
  stretchOf,
  weekLines,
  weekOf,
  wholeWeeks,
  WITHHELD,
} from '../../../src/components/time-report/time-report-derive.ts';

const kindName = (k: EntryKind): string => k.toUpperCase();

let n = 0;
function row(over: Partial<TimeReportRow> & { user?: TimeReportRow['user'] }): TimeReportRow {
  n += 1;
  return {
    project: { id: 'p1', slug: 'atlas', name: 'Atlas' },
    user: { id: 'u1', name: 'Ada Byron', deactivated: false },
    task: { id: `t${String(n)}`, key: `AT-${String(n)}`, title: `Task ${String(n)}` },
    untied: false,
    kind: 'work',
    confirmed_minutes: 0,
    drafted_minutes: 0,
    ...over,
  };
}

function report(over: Partial<TimeReport> = {}): TimeReport {
  return {
    from: '2026-11-02',
    to: '2026-11-08',
    days: 7,
    scope: 'own',
    include_drafts: true,
    totals: {
      confirmed_minutes: 600,
      drafted_minutes: 60,
      meeting_minutes: 66,
      manual_minutes: 0,
      active_days: 2,
      people: 1,
    },
    agent_minutes: 42,
    by_day: [
      { day: '2026-11-02', confirmed_minutes: 300, drafted_minutes: 0 },
      { day: '2026-11-03', confirmed_minutes: 300, drafted_minutes: 60 },
      { day: '2026-11-04', confirmed_minutes: 0, drafted_minutes: 0 },
      { day: '2026-11-05', confirmed_minutes: 0, drafted_minutes: 0 },
      { day: '2026-11-06', confirmed_minutes: 0, drafted_minutes: 0 },
      { day: '2026-11-07', confirmed_minutes: 0, drafted_minutes: 0 },
      { day: '2026-11-08', confirmed_minutes: 0, drafted_minutes: 0 },
    ],
    rows: [],
    ...over,
  };
}

void describe('the stretch a control picks', () => {
  void test('Week is Monday to Sunday, Month the calendar month, Day the day', () => {
    assert.deepEqual(weekOf('2026-11-05'), { from: '2026-11-02', to: '2026-11-08' });
    assert.deepEqual(weekOf('2026-11-08'), { from: '2026-11-02', to: '2026-11-08' });
    assert.deepEqual(monthOf('2026-02-14'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthOf('2026-12-31'), { from: '2026-12-01', to: '2026-12-31' });
    const picked = { from: '2026-10-01', to: '2026-10-10' };
    assert.deepEqual(stretchOf('day', '2026-11-05', picked), {
      from: '2026-11-05',
      to: '2026-11-05',
    });
    assert.deepEqual(stretchOf('range', '2026-11-05', picked), picked);
  });

  void test('‹ and › move a day, a week, a month, or a range by its own length', () => {
    const picked = { from: '2026-10-01', to: '2026-10-10' };
    assert.equal(stepped('day', '2026-11-01', picked, -1).anchor, '2026-10-31');
    assert.equal(stepped('week', '2026-11-05', picked, 1).anchor, '2026-11-12');
    assert.equal(stepped('month', '2026-01-31', picked, 1).anchor, '2026-02-01');
    assert.equal(stepped('month', '2026-03-15', picked, -1).anchor, '2026-02-01');
    assert.deepEqual(stepped('range', '2026-11-05', picked, -1).picked, {
      from: '2026-09-21',
      to: '2026-09-30',
    });
    assert.equal(stepUnit('range', picked), '10 days');
    assert.equal(stepUnit('week', picked), 'week');
  });

  void test('quick picks count back from today', () => {
    assert.deepEqual(presetRange('last7', '2026-11-05'), { from: '2026-10-30', to: '2026-11-05' });
    assert.deepEqual(presetRange('last30', '2026-11-05'), {
      from: '2026-10-07',
      to: '2026-11-05',
    });
    assert.deepEqual(presetRange('thisMonth', '2026-11-05'), {
      from: '2026-11-01',
      to: '2026-11-05',
    });
    assert.deepEqual(presetRange('lastMonth', '2026-11-05'), {
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  void test('a backward, half-picked or too-long range is said, not read', () => {
    assert.equal(rangeProblem({ from: '', to: '2026-11-05' }), 'Pick both days.');
    assert.equal(
      rangeProblem({ from: '2026-11-05', to: '2026-11-01' }),
      'The last day is before the first.',
    );
    assert.equal(rangeProblem({ from: '2026-01-01', to: '2026-11-05' }), 'Pick 92 days or fewer.');
    assert.equal(rangeProblem({ from: '2026-08-06', to: '2026-11-05' }), undefined);
  });

  void test('the stepper says a month, a day, a week and a span across months', () => {
    assert.equal(stretchLabel('month', monthOf('2026-11-05')), 'November 2026');
    assert.equal(
      stretchLabel('day', { from: '2026-11-02', to: '2026-11-02' }),
      'Monday 2 November 2026',
    );
    assert.equal(stretchLabel('week', weekOf('2026-11-05')), 'Mon 2 – Sun 8 Nov 2026');
    assert.equal(stretchLabel('week', weekOf('2026-10-28')), 'Mon 26 Oct – Sun 1 Nov 2026');
  });

  void test('a space admin reads whole ISO weeks, the latest thirteen at most (D-136)', () => {
    assert.deepEqual(wholeWeeks(monthOf('2026-11-05')), { from: '2026-10-26', to: '2026-12-06' });
    const long = wholeWeeks({ from: '2026-08-01', to: '2026-11-05' });
    assert.equal(long.to, '2026-11-08');
    assert.equal(new Date(`${long.from}T00:00:00Z`).getUTCDay(), 1, 'starts on a Monday');
    const days = (Date.parse(long.to) - Date.parse(long.from)) / 86_400_000 + 1;
    assert.equal(days, 91);
  });
});

void describe('the figures', () => {
  void test('durations are words, short and clock — never a utilisation figure', () => {
    assert.equal(hoursWords(0), '0 min');
    assert.equal(hoursWords(45), '45 min');
    assert.equal(hoursWords(120), '2 h');
    assert.equal(hoursWords(425), '7 h 5 min');
    assert.equal(hoursClock(425), '7:05');
    assert.equal(shareLabel(1, 400), '<1%');
    assert.equal(shareLabel(0, 0), '0%');
  });

  void test('the strip: six figures, drafts in or out, days so far only', () => {
    const s = statsOf(report(), true, 'me', '2026-11-05', '');
    assert.deepEqual(
      s.map((x) => x.key),
      ['tracked', 'confirmed', 'drafts', 'meetings', 'active', 'per-day'],
    );
    assert.equal(s[0]?.value, '11 h');
    assert.equal(s[0]?.sub, 'confirmed and drafted');
    assert.equal(s[1]?.sub, 'settled by you');
    assert.equal(s[3]?.sub, '10% of tracked');
    assert.equal(s[4]?.value, '2');
    assert.equal(s[4]?.sub, 'of 4 days so far');
    assert.equal(s[5]?.value, '5 h 30 min');

    const confirmedOnly = statsOf(report(), false, 'person', '2026-11-05', 'Ada');
    assert.equal(confirmedOnly[0]?.value, '10 h');
    assert.equal(confirmedOnly[0]?.sub, 'confirmed only');
    assert.equal(confirmedOnly[1]?.sub, 'settled by Ada');
    assert.equal(confirmedOnly[2]?.sub, 'not confirmed yet');
  });

  void test('somebody else’s drafts not asked for: no drafted figure, not even a zero (D-088)', () => {
    const unread = report({
      scope: 'people',
      include_drafts: false,
      totals: { ...report().totals, drafted_minutes: 0 },
    });
    const drafts = statsOf(unread, false, 'org', '2026-11-05', '').find((x) => x.key === 'drafts');
    assert.equal(drafts?.value, '—');
    assert.equal(drafts?.minutes, undefined);
    assert.match(drafts?.sub ?? '', /Include drafts/);
    const read = statsOf(report({ scope: 'people' }), true, 'org', '2026-11-05', '');
    assert.equal(read.find((x) => x.key === 'drafts')?.value, '1 h');
  });

  void test('bars: drafted is its own share, hatched and named; a future day is not yet', () => {
    const { bars, axis } = dayBars(report().by_day, true, '2026-11-05');
    assert.equal(bars.length, 7);
    const tue = bars[1];
    assert.ok(tue !== undefined);
    assert.equal(tue.total, 360);
    assert.equal(Math.round(tue.draftedPct), 17);
    assert.match(tue.aria, /6 h tracked, 5 h confirmed, 1 h drafted/);
    assert.equal(tue.top, 'Tue');
    assert.equal(bars[3]?.today, true);
    assert.equal(bars[5]?.future, true);
    assert.match(bars[5]?.aria ?? '', /not yet/);
    assert.equal(axis.top, 6);

    const noDrafts = dayBars(report().by_day, false, '2026-11-05');
    assert.equal(noDrafts.bars[1]?.draftedPct, 0);
    assert.doesNotMatch(noDrafts.bars[1]?.aria ?? '', /drafted/);
  });

  void test('an empty stretch still has an axis', () => {
    assert.equal(axisFor(0).top, 8);
    assert.deepEqual(
      axisFor(0).lines.map((l) => l.label),
      ['0', '2h', '4h', '6h', '8h'],
    );
  });

  void test('keyboard: arrows, Home and End stay inside the bars; focus opens on today', () => {
    assert.equal(barKey('ArrowLeft', 0, 7), 0);
    assert.equal(barKey('ArrowRight', 3, 7), 4);
    assert.equal(barKey('End', 0, 7), 6);
    assert.equal(barKey('Home', 5, 7), 0);
    assert.equal(barKey('Enter', 5, 7), undefined);
    const { bars } = dayBars(report().by_day, true, '2026-11-05');
    assert.equal(firstFocus(bars), 3);
    assert.equal(firstFocus(dayBars(report().by_day, true, '2026-12-01').bars), 6);
  });
});

void describe('grouping on the client', () => {
  const zed = { id: 'uz', name: 'Zed Most', deactivated: false };
  const amy = { id: 'ua', name: 'Amy Least', deactivated: false };
  const rows = [
    row({ user: zed, confirmed_minutes: 900 }),
    row({ user: amy, confirmed_minutes: 10 }),
    row({ user: amy, project: null, task: null, confirmed_minutes: 5 }),
    row({
      user: amy,
      project: { id: 'p2', slug: 'beacon', name: 'Beacon' },
      kind: 'meeting',
      confirmed_minutes: 60,
      drafted_minutes: 30,
    }),
  ];

  void test('people are A–Z, never by hours (D-088 item 1)', () => {
    const g = groupRows(rows, 'member', 'none', true, kindName);
    assert.deepEqual(
      g.map((x) => x.face.label),
      ['Amy Least', 'Zed Most'],
    );
    const inside = groupRows(rows, 'space', 'member', true, kindName)[0];
    assert.deepEqual(
      inside?.children.map((c) => c.face.label),
      ['Amy Least', 'Zed Most'],
    );
  });

  void test('everything else is largest first, with time on nothing last and grey', () => {
    const g = groupRows(rows, 'space', 'task', true, kindName);
    assert.deepEqual(
      g.map((x) => x.face.label),
      ['Atlas', 'Beacon', 'No space'],
    );
    assert.equal(g.at(-1)?.color, NONE_COLOR);
    assert.equal(g[0]?.color, 'var(--accent)');
    assert.equal(childCount('task', g[0]?.children.length ?? 0), '2 tasks');
  });

  void test('Confirmed only drops drafted time from every total', () => {
    const on = groupRows(rows, 'kind', 'none', true, kindName);
    const off = groupRows(rows, 'kind', 'none', false, kindName);
    assert.equal(on.find((x) => x.face.key === 'meeting')?.total, 90);
    assert.equal(off.find((x) => x.face.key === 'meeting')?.total, 60);
    assert.equal(off.find((x) => x.face.key === 'meeting')?.drafted, 0);
    assert.equal(on.find((x) => x.face.key === 'meeting')?.color, 'var(--kind-meeting)');
  });

  void test('a task-less row is No task yet, a space’s general time, or No task', () => {
    assert.equal(faceOf(row({ task: null, untied: true }), 'task', kindName).label, 'No task yet');
    assert.equal(faceOf(row({ task: null }), 'task', kindName).label, 'Atlas · general');
    assert.equal(faceOf(row({ task: null, project: null }), 'task', kindName).label, 'No task');
    assert.deepEqual(faceOf(row({ kind: null }), 'kind', kindName), {
      key: NO_KIND,
      label: 'No kind yet',
      none: true,
      sort: '\uffff',
    });
    assert.equal(
      faceOf(row({ user: { id: 'x', name: 'Gone', deactivated: true } }), 'member', kindName).label,
      'Gone (deactivated)',
    );
  });

  void test('groupings by scope, and when Swap may run', () => {
    assert.deepEqual(defaultGrouping('org'), ['space', 'member']);
    assert.deepEqual(defaultGrouping('me'), ['space', 'task']);
    assert.ok(!firstGroupings('me').includes('member'), 'no Member for one person');
    assert.ok(!secondGroupings('org', 'space').includes('space'));
    assert.equal(canSwap('org', 'member'), true);
    assert.equal(canSwap('me', 'none'), false);
  });

  void test('the donut folds the sixth colour on into Other, and says each share', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      row({
        project: { id: `s${String(i)}`, slug: `s${String(i)}`, name: `Space ${String(i)}` },
        confirmed_minutes: 100 - i,
      }),
    );
    const groups = groupRows(many, 'space', 'none', true, kindName);
    assert.equal(groups.filter((g) => g.other).length, 2);
    const slices = slicesOf(groups);
    assert.equal(slices.length, 6);
    assert.equal(slices.at(-1)?.label, 'Other');
    assert.equal(slices.at(-1)?.color, OTHER_COLOR);
    assert.equal(slices.at(-1)?.minutes, 94 + 95);
    assert.equal(Math.round(slices.at(-1)?.end ?? 0), 100);
    const bg = donutBackground(slices, 's0');
    assert.match(bg, /^conic-gradient\(/);
    assert.match(bg, /color-mix\(in srgb, var\(--chip-blue\) 26%/);
    assert.doesNotMatch(bg, /#[0-9a-f]{3,6}/i, 'tokens only');
    assert.equal(donutBackground([]), 'var(--bg-column)');
  });
});

void describe('the states a read report shows', () => {
  const zero = { ...report().totals, confirmed_minutes: 0, drafted_minutes: 0 };
  void test('nothing at all, nothing matching, nothing confirmed, drafts only, figures', () => {
    assert.deepEqual(shownFor(report({ totals: zero }), true, false), { kind: 'empty' });
    assert.deepEqual(shownFor(report({ totals: zero }), true, true), { kind: 'filtered-empty' });
    const draftsOnly = report({ totals: { ...zero, drafted_minutes: 40 } });
    assert.deepEqual(shownFor(draftsOnly, false, false), { kind: 'unconfirmed', drafted: 40 });
    assert.deepEqual(shownFor(draftsOnly, true, false), { kind: 'figures', draftsOnly: true });
    assert.deepEqual(shownFor(report(), true, false), { kind: 'figures', draftsOnly: false });
    // Unasked-for drafts are never offered as *N of drafts are waiting*.
    const unread = report({ include_drafts: false, totals: { ...zero, drafted_minutes: 40 } });
    assert.deepEqual(shownFor(unread, false, false), { kind: 'empty' });
  });

  void test('a space admin’s withheld week is said, never drawn as zero (D-136, D-138)', () => {
    const lines = weekLines([
      { from: '2026-10-26', to: '2026-11-01', confirmed_minutes: null, people: 2 },
      { from: '2026-11-02', to: '2026-11-08', confirmed_minutes: 600, people: 4 },
      { from: '2026-11-09', to: '2026-11-15', confirmed_minutes: 300, people: 4 },
    ]);
    assert.equal(lines[0]?.minutes, null);
    assert.equal(lines[0]?.width, 0);
    assert.equal(lines[1]?.width, 100);
    assert.equal(lines[2]?.width, 50);
    assert.equal(lines[0]?.label, 'Mon 26 Oct – Sun 1 Nov');
    assert.equal(WITHHELD, 'withheld — fewer than 3 others');
  });

  void test('the server’s refusal reason is read from its details', () => {
    assert.equal(refusalReason({ reason: 'report_too_large', max_rows: 5000 }), 'report_too_large');
    assert.equal(refusalReason(null), undefined);
    assert.equal(refusalReason({ reason: 3 }), undefined);
  });
});
