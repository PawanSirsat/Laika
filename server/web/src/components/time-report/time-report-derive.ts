import type {
  EntryKind,
  SpaceWeek,
  SummaryDay,
  TimeReport,
  TimeReportRow,
} from '../../api/time.ts';

/**
 * The Time report's figures (D-130, LAI-1138): one shape for My day's
 * Overview, a person's *Time report* tab and Insights → Time, all read from
 * `GET /time/report`. Everything here is pure — the stretch a control picks,
 * the summary strip, the bars, the grouping and the donut — so the component
 * draws and this decides.
 *
 * **People A–Z by default** (D-088 item 1, D-131 item 3): nothing is sorted
 * by how much a person logged unless the reader asks for *Most time* (D-141).
 * No utilisation figure and no money appear anywhere.
 */

// ------------------------------------------------------------------ days

const DAY_MS = 86_400_000;

/** `day` moved by `n` days. */
export const shiftDay = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** How many days from `from` to `to`, both counted. */
export const daysIn = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** 0 for Monday … 6 for Sunday. */
const weekday = (day: string): number => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The longest stretch one report covers, the server's 92 days. */
export const REPORT_MAX_DAYS = 92;

/** The four ways to pick a stretch, in the design's order. */
export const REPORT_RANGES = ['day', 'week', 'month', 'range'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export const RANGE_LABELS: Readonly<Record<ReportRange, string>> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  range: 'Range',
};

export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** Monday to Sunday of the week holding `day`. */
export function weekOf(day: string): DayRange {
  const from = shiftDay(day, -weekday(day));
  return { from, to: shiftDay(from, 6) };
}

/** The first to the last day of the month holding `day`. */
export function monthOf(day: string): DayRange {
  const from = `${day.slice(0, 7)}-01`;
  const next = new Date(Date.parse(`${from}T00:00:00Z`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: shiftDay(next.toISOString().slice(0, 10), -1) };
}

export type RangePreset = 'last7' | 'last30' | 'thisMonth' | 'lastMonth';

/** The quick picks a range offers, in order, with their words. */
export const RANGE_PRESETS: readonly (readonly [RangePreset, string])[] = [
  ['last7', 'Last 7 days'],
  ['last30', 'Last 30 days'],
  ['thisMonth', 'This month'],
  ['lastMonth', 'Last month'],
];

/** A quick pick's days, counted back from `today`. */
export function presetRange(preset: RangePreset, today: string): DayRange {
  switch (preset) {
    case 'last7':
      return { from: shiftDay(today, -6), to: today };
    case 'last30':
      return { from: shiftDay(today, -29), to: today };
    case 'thisMonth':
      return { from: monthOf(today).from, to: today };
    case 'lastMonth':
      return monthOf(shiftDay(monthOf(today).from, -1));
  }
}

/**
 * The days a control shows: Day is the anchor, Week its Monday to Sunday,
 * Month its calendar month, Range the picked days.
 */
export function stretchOf(range: ReportRange, anchor: string, picked: DayRange): DayRange {
  switch (range) {
    case 'day':
      return { from: anchor, to: anchor };
    case 'week':
      return weekOf(anchor);
    case 'month':
      return monthOf(anchor);
    case 'range':
      return picked;
  }
}

/**
 * One step of ‹ or › — a day, a week, a month, or a picked range's own length
 * — as the new anchor and picked range.
 */
export function stepped(
  range: ReportRange,
  anchor: string,
  picked: DayRange,
  direction: -1 | 1,
): { readonly anchor: string; readonly picked: DayRange } {
  switch (range) {
    case 'day':
      return { anchor: shiftDay(anchor, direction), picked };
    case 'week':
      return { anchor: shiftDay(anchor, 7 * direction), picked };
    case 'month': {
      const first = monthOf(anchor).from;
      const moved = direction === 1 ? shiftDay(monthOf(anchor).to, 1) : shiftDay(first, -1);
      return { anchor: monthOf(moved).from, picked };
    }
    case 'range': {
      const length = daysIn(picked.from, picked.to);
      return {
        anchor,
        picked: {
          from: shiftDay(picked.from, length * direction),
          to: shiftDay(picked.to, length * direction),
        },
      };
    }
  }
}

/** What one step is called, for ‹ and ›'s names: *Previous week*, *Next 30 days*. */
export function stepUnit(range: ReportRange, stretch: DayRange): string {
  if (range === 'range') return `${String(daysIn(stretch.from, stretch.to))} days`;
  return range;
}

/** Why a picked range cannot be read, in words, or undefined when it can. */
export function rangeProblem(stretch: DayRange): string | undefined {
  if (stretch.from === '' || stretch.to === '') return 'Pick both days.';
  if (stretch.to < stretch.from) return 'The last day is before the first.';
  if (daysIn(stretch.from, stretch.to) > REPORT_MAX_DAYS) {
    return `Pick ${String(REPORT_MAX_DAYS)} days or fewer.`;
  }
  return undefined;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const parts = (day: string) => ({
  year: day.slice(0, 4),
  month: Number(day.slice(5, 7)) - 1,
  date: Number(day.slice(8, 10)),
  wd: weekday(day),
});

/** `Mon 2 Nov` */
export function dayShort(day: string): string {
  const p = parts(day);
  return `${WEEKDAYS[p.wd] ?? ''} ${String(p.date)} ${MONTHS[p.month] ?? ''}`;
}

/** `Monday 2 November` */
export function dayLong(day: string): string {
  const p = parts(day);
  return `${WEEKDAYS_LONG[p.wd] ?? ''} ${String(p.date)} ${MONTHS_LONG[p.month] ?? ''}`;
}

/**
 * The stretch as the stepper says it: `November 2026` for a month,
 * `Monday 2 November 2026` for a day, `Mon 2 – Sun 8 Nov 2026` within a
 * month, `Mon 26 Oct – Sun 1 Nov 2026` across two.
 */
export function stretchLabel(range: ReportRange, stretch: DayRange): string {
  const a = parts(stretch.from);
  const b = parts(stretch.to);
  if (range === 'month' && stretch.from.slice(0, 7) === stretch.to.slice(0, 7)) {
    return `${MONTHS_LONG[a.month] ?? ''} ${a.year}`;
  }
  if (stretch.from === stretch.to) return `${dayLong(stretch.from)} ${a.year}`;
  if (a.month === b.month && a.year === b.year) {
    return `${WEEKDAYS[a.wd] ?? ''} ${String(a.date)} – ${dayShort(stretch.to)} ${b.year}`;
  }
  return `${dayShort(stretch.from)} – ${dayShort(stretch.to)} ${b.year}`;
}

/**
 * A space admin's stretch (D-136): whole ISO weeks covering the days picked,
 * the latest thirteen when that would pass 92 days — the server reads whole
 * weeks only, and refuses anything else `422 range_not_whole_weeks`.
 */
export function wholeWeeks(stretch: DayRange): DayRange {
  const from = weekOf(stretch.from).from;
  const to = weekOf(stretch.to).to;
  const weeks = Math.floor(REPORT_MAX_DAYS / 7);
  if (daysIn(from, to) <= weeks * 7) return { from, to };
  return { from: shiftDay(to, -(weeks * 7) + 1), to };
}

// ------------------------------------------------------------ durations

/** `0 min`, `45 min`, `2 h`, `7 h 5 min` — the design's words for a figure. */
export function hoursWords(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${String(r)} min`;
  return r === 0 ? `${String(h)} h` : `${String(h)} h ${String(r)} min`;
}

/** `45m`, `2h 5m` — the short figure a phone's strip prints. */
export function hoursShort(minutes: number): string {
  return hoursCompact(minutes);
}

/**
 * `7h 5m`, `20h`, `37m` — a table cell or the donut's figure, hours and
 * minutes. Never `7:05`: a clock reads as a time of day, not hours worked
 * (LAI-1147). The same short form My day's timeline prints.
 */
export function hoursCompact(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${String(r)}m`;
  return r === 0 ? `${String(h)}h` : `${String(h)}h ${String(r)}m`;
}

/** A whole percent of `of`, `<1%` for a sliver, or 0 when there is nothing. */
export function shareLabel(part: number, of: number): string {
  if (of <= 0) return '0%';
  const pct = (part / of) * 100;
  if (part > 0 && pct < 1) return '<1%';
  return `${String(Math.round(pct))}%`;
}

// --------------------------------------------------------------- scopes

/**
 * Where the report is drawn, which decides its words and its groupings:
 * the reader's own (`me`), one person (`person`), or everyone (`org`).
 */
export type ReportScope = 'me' | 'person' | 'org';

/** Counted toward a figure: confirmed always, drafted only when drafts are included. */
export const counted = (
  r: { readonly confirmed_minutes: number; readonly drafted_minutes: number },
  drafts: boolean,
): number => r.confirmed_minutes + (drafts ? r.drafted_minutes : 0);

// ---------------------------------------------------------------- stats

export interface Stat {
  readonly key: string;
  readonly label: string;
  readonly minutes?: number;
  readonly value: string;
  readonly sub: string;
}

/**
 * The six figures of the strip: Tracked, Confirmed, Drafts waiting, Meetings,
 * Active days and Per active day. *Of N days so far* counts the days up to
 * `today`, so a week still running is not read as empty days.
 */
export function statsOf(
  report: TimeReport,
  drafts: boolean,
  scope: ReportScope,
  today: string,
  firstName: string,
  short = false,
): readonly Stat[] {
  const words = short ? hoursShort : hoursWords;
  const t = report.totals;
  const tracked = counted(t, drafts);
  const elapsed = report.by_day.filter((d) => d.day <= today).length;
  const active = report.by_day.filter((d) => counted(d, drafts) > 0).length;
  const who = scope === 'me' ? 'you' : scope === 'person' ? firstName : 'each person';
  return [
    {
      key: 'tracked',
      label: 'Tracked',
      minutes: tracked,
      value: words(tracked),
      sub: drafts ? 'confirmed and drafted' : 'confirmed only',
    },
    {
      key: 'confirmed',
      label: 'Confirmed',
      minutes: t.confirmed_minutes,
      value: words(t.confirmed_minutes),
      sub: t.confirmed_minutes > 0 ? `settled by ${who}` : 'nothing confirmed yet',
    },
    {
      key: 'drafts',
      label: 'Drafts waiting',
      // Somebody else's drafts are read only on request (D-088 items 2–3):
      // not asked for, nothing is said about them — not even a zero.
      ...(report.include_drafts
        ? {
            minutes: t.drafted_minutes,
            value: words(t.drafted_minutes),
            sub:
              t.drafted_minutes === 0
                ? 'nothing waiting'
                : scope === 'me'
                  ? 'to review and confirm'
                  : 'not confirmed yet',
          }
        : { value: '—', sub: 'not read — Include drafts shows them' }),
    },
    {
      key: 'meetings',
      label: 'Meetings',
      minutes: t.meeting_minutes,
      value: words(t.meeting_minutes),
      sub: tracked > 0 ? `${shareLabel(t.meeting_minutes, tracked)} of tracked` : '—',
    },
    {
      key: 'active',
      label: 'Active days',
      value: String(active),
      sub: `of ${String(elapsed)} ${elapsed === 1 ? 'day' : 'days'} so far`,
    },
    {
      key: 'per-day',
      label: 'Per active day',
      ...(active > 0 ? { minutes: Math.round(tracked / active) } : {}),
      value: active > 0 ? words(Math.round(tracked / active)) : '—',
      sub: 'average, active days only',
    },
  ];
}

/** Whose hours the agent line sits beside. */
export function agentTail(scope: ReportScope, firstName: string): string {
  if (scope === 'me') return 'beside your hours, never added to them';
  if (scope === 'person') return `beside ${firstName}’s hours, never added to them`;
  return 'beside people’s hours, never added to them';
}

// ---------------------------------------------------------------- bars

export interface DayBar {
  readonly day: string;
  readonly confirmed: number;
  readonly drafted: number;
  readonly total: number;
  readonly future: boolean;
  readonly today: boolean;
  readonly weekend: boolean;
  /** Of the axis top, 0–100. */
  readonly height: number;
  /** Of the bar, 0–100. */
  readonly confirmedPct: number;
  readonly draftedPct: number;
  /** The two lines under the bar; either may be empty on a crowded axis. */
  readonly top: string;
  readonly bottom: string;
  /** Said for the bar to a screen reader, and in its title. */
  readonly aria: string;
}

export interface Axis {
  /** The axis top, in hours. */
  readonly top: number;
  /** Gridlines, bottom up: their height of the axis and their label. */
  readonly lines: readonly { readonly pct: number; readonly label: string }[];
}

/** A round axis for the busiest day: 1, 2, 4, 10 or 20 hours a step. */
export function axisFor(busiestMinutes: number): Axis {
  const hours = busiestMinutes / 60;
  let step: number;
  let top: number;
  if (busiestMinutes <= 0) {
    step = 2;
    top = 8;
  } else {
    step = hours <= 4 ? 1 : hours <= 10 ? 2 : hours <= 16 ? 4 : hours <= 40 ? 10 : 20;
    top = Math.max(step * 2, Math.ceil(hours / step) * step);
  }
  const lines = [{ pct: 0, label: '0' }];
  for (let v = step; v <= top + 1e-9; v += step) {
    lines.push({ pct: (v / top) * 100, label: `${String(v)}h` });
  }
  return { top, lines };
}

/** The bars of *Hours per day*, one per day of the stretch, and their axis. */
export function dayBars(
  byDay: readonly SummaryDay[],
  drafts: boolean,
  today: string,
  compact = false,
): { readonly bars: readonly DayBar[]; readonly axis: Axis } {
  const n = byDay.length;
  const axis = axisFor(Math.max(0, ...byDay.map((d) => counted(d, drafts))));
  const bars = byDay.map((d, i): DayBar => {
    const total = counted(d, drafts);
    const drafted = drafts ? d.drafted_minutes : 0;
    const future = d.day > today;
    const p = parts(d.day);
    let top = '';
    let bottom = '';
    if (n <= 7) {
      top = WEEKDAYS[p.wd] ?? '';
      bottom = String(p.date);
    } else if (n <= 31 && !compact) {
      bottom = String(p.date);
      top = p.date === 1 || i === 0 ? (MONTHS[p.month] ?? '') : (WEEKDAYS[p.wd] ?? '').charAt(0);
    } else if ((n - 1 - i) % 7 === 0) {
      bottom = String(p.date);
      top = i < 7 || p.date <= 7 ? (MONTHS[p.month] ?? '') : '';
    }
    const when = dayLong(d.day);
    const aria = future
      ? `${when}: not yet`
      : total === 0
        ? `${when}: no time`
        : `${when}: ${hoursWords(total)} tracked, ${hoursWords(d.confirmed_minutes)} confirmed${
            drafts ? `, ${hoursWords(drafted)} drafted` : ''
          }`;
    return {
      day: d.day,
      confirmed: d.confirmed_minutes,
      drafted,
      total,
      future,
      today: d.day === today,
      weekend: p.wd >= 5,
      height: (total / (axis.top * 60)) * 100,
      confirmedPct: total > 0 ? (d.confirmed_minutes / total) * 100 : 0,
      draftedPct: total > 0 ? (drafted / total) * 100 : 0,
      top,
      bottom,
      aria,
    };
  });
  return { bars, axis };
}

/** The bar a keyboard lands on first: today's when shown, else the last. */
export function firstFocus(bars: readonly DayBar[]): number {
  const today = bars.findIndex((b) => b.today);
  return today >= 0 ? today : Math.max(0, bars.length - 1);
}

/** Where an arrow key, Home or End moves focus among `n` bars, or undefined for another key. */
export function barKey(key: string, at: number, n: number): number | undefined {
  const moves: Readonly<Record<string, number>> = {
    ArrowLeft: at - 1,
    ArrowRight: at + 1,
    Home: 0,
    End: n - 1,
  };
  const to = moves[key];
  if (to === undefined) return undefined;
  return Math.max(0, Math.min(n - 1, to));
}

// ------------------------------------------------------------- grouping

/** What a row may be grouped by: the design's Project is a Laika space (D-130 item 4). */
export type Dimension = 'space' | 'member' | 'task' | 'kind';
export type Grouping = Dimension | 'none';

export const DIMENSION_LABELS: Readonly<Record<Grouping, string>> = {
  space: 'Space',
  member: 'Member',
  task: 'Task',
  kind: 'Kind',
  none: 'Nothing',
};

const PLURALS: Readonly<Record<Dimension, readonly [string, string]>> = {
  space: ['space', 'spaces'],
  member: ['person', 'people'],
  task: ['task', 'tasks'],
  kind: ['kind', 'kinds'],
};

/** The first grouping's choices: Member only where people are listed. */
export function firstGroupings(scope: ReportScope): readonly Dimension[] {
  return scope === 'org' ? ['space', 'member', 'kind', 'task'] : ['space', 'kind', 'task'];
}

/** The second grouping's choices, never the first one again. */
export function secondGroupings(scope: ReportScope, first: Dimension): readonly Grouping[] {
  const all: readonly Grouping[] =
    scope === 'org'
      ? ['member', 'task', 'kind', 'space', 'none']
      : ['task', 'kind', 'space', 'none'];
  return all.filter((d) => d !== first);
}

/** The groupings a report opens on: Space → Member for everyone, Space → Task otherwise. */
export function defaultGrouping(scope: ReportScope): readonly [Dimension, Grouping] {
  return scope === 'org' ? ['space', 'member'] : ['space', 'task'];
}

/** Whether Swap may run: the second grouping must be one the first offers. */
export function canSwap(scope: ReportScope, second: Grouping): boolean {
  return second !== 'none' && firstGroupings(scope).includes(second);
}

/** A draft has no kind until somebody names it: its own face, never Work's. */
export const NO_KIND = 'no-kind';

/** How a row is drawn under one dimension: its words and its mark. */
export interface Face {
  readonly key: string;
  readonly label: string;
  /** A card's key, beside its title. */
  readonly code?: string;
  /** A space's slug, for its badge. */
  readonly space?: { readonly slug: string; readonly name: string };
  /** A person, for an avatar. */
  readonly person?: { readonly id: string; readonly name: string };
  readonly kind?: EntryKind;
  /** Time on no space or no task: a dashed mark, never a colour of its own. */
  readonly none?: boolean;
  /** For the A–Z order of people. */
  readonly sort: string;
}

/** A row under one dimension. `kindName` names a kind in the reader's words. */
export function faceOf(
  row: TimeReportRow,
  dim: Dimension,
  kindName: (kind: EntryKind) => string,
): Face {
  switch (dim) {
    case 'space':
      return row.project === null
        ? { key: 'none', label: 'No space', none: true, sort: '￿' }
        : {
            key: row.project.id,
            label: row.project.name,
            space: { slug: row.project.slug, name: row.project.name },
            sort: row.project.name,
          };
    case 'member':
      return {
        key: row.user.id,
        label: row.user.deactivated ? `${row.user.name} (deactivated)` : row.user.name,
        person: { id: row.user.id, name: row.user.name },
        sort: row.user.name,
      };
    case 'task':
      if (row.task !== null) {
        return { key: row.task.id, code: row.task.key, label: row.task.title, sort: row.task.key };
      }
      if (row.untied) return { key: 'untied', label: 'No task yet', none: true, sort: '￿' };
      return row.project === null
        ? { key: 'none', label: 'No task', none: true, sort: '￿' }
        : {
            key: `general:${row.project.id}`,
            label: `${row.project.name} · general`,
            none: true,
            sort: row.project.name,
          };
    case 'kind': {
      if (row.kind === null) {
        return { key: NO_KIND, label: 'No kind yet', none: true, sort: '\uffff' };
      }
      return { key: row.kind, label: kindName(row.kind), kind: row.kind, sort: row.kind };
    }
  }
}

export interface GroupChild {
  readonly face: Face;
  readonly confirmed: number;
  readonly drafted: number;
  readonly total: number;
}

export interface Group extends GroupChild {
  /** A token, `var(--…)`: the row's mark and its donut slice. */
  readonly color: string;
  /** Folded into the donut's *Other*. */
  readonly other: boolean;
  readonly children: readonly GroupChild[];
}

/** The colours a group takes in turn; past the fifth, *Other*. Tokens only. */
export const SLOT_COLORS = [
  'var(--accent)',
  'var(--chip-blue)',
  'var(--chip-green)',
  'var(--chip-orange)',
  'var(--chip-pink)',
] as const;
export const OTHER_COLOR = 'var(--heat-all-3)';
export const NONE_COLOR = 'var(--chip-neutral)';

/** How people are listed: A–Z, or by the reader's choice the most time first (D-141). */
export type PeopleOrder = 'az' | 'time';

/**
 * **People A–Z unless the reader picks *Most time*** (D-088 item 1, D-141).
 * Everything else largest first, with time on nothing last.
 */
function ordered<T extends GroupChild>(dim: Grouping, list: T[], people: PeopleOrder): T[] {
  if (dim === 'member' && people === 'az') {
    return list.sort((a, b) => a.face.sort.localeCompare(b.face.sort));
  }
  return list.sort(
    (a, b) =>
      Number(a.face.none === true) - Number(b.face.none === true) ||
      b.total - a.total ||
      a.face.sort.localeCompare(b.face.sort),
  );
}

/**
 * The table: `rows` grouped by `first`, then by `second`, on the client
 * (plan T5). A group with nothing counted is left out.
 */
export function groupRows(
  rows: readonly TimeReportRow[],
  first: Dimension,
  second: Grouping,
  drafts: boolean,
  kindName: (kind: EntryKind) => string,
  people: PeopleOrder = 'az',
): readonly Group[] {
  interface Acc {
    face: Face;
    confirmed: number;
    drafted: number;
    kids: Map<string, { face: Face; confirmed: number; drafted: number }>;
  }
  const groups = new Map<string, Acc>();
  for (const row of rows) {
    const face = faceOf(row, first, kindName);
    const g: Acc = groups.get(face.key) ?? {
      face,
      confirmed: 0,
      drafted: 0,
      kids: new Map<string, { face: Face; confirmed: number; drafted: number }>(),
    };
    g.confirmed += row.confirmed_minutes;
    g.drafted += row.drafted_minutes;
    if (second !== 'none') {
      const kidFace = faceOf(row, second, kindName);
      const kid = g.kids.get(kidFace.key) ?? { face: kidFace, confirmed: 0, drafted: 0 };
      kid.confirmed += row.confirmed_minutes;
      kid.drafted += row.drafted_minutes;
      g.kids.set(kidFace.key, kid);
    }
    groups.set(face.key, g);
  }
  const total = (c: number, d: number): number => c + (drafts ? d : 0);
  const list = ordered(
    first,
    [...groups.values()]
      .map((g) => ({ ...g, total: total(g.confirmed, g.drafted) }))
      .filter((g) => g.total > 0),
    people,
  );
  let slot = 0;
  return list.map((g) => {
    let color: string;
    let other = false;
    if (g.face.kind !== undefined) color = `var(--kind-${g.face.kind})`;
    else if (g.face.none === true) color = NONE_COLOR;
    else if (slot < SLOT_COLORS.length) color = SLOT_COLORS[slot++] ?? OTHER_COLOR;
    else {
      color = OTHER_COLOR;
      other = true;
    }
    const children = ordered(
      second,
      [...g.kids.values()]
        .map((k) => ({ ...k, total: total(k.confirmed, k.drafted) }))
        .filter((k) => k.total > 0),
      people,
    ).map((k) => ({ face: k.face, confirmed: k.confirmed, drafted: k.drafted, total: k.total }));
    return {
      face: g.face,
      confirmed: g.confirmed,
      drafted: drafts ? g.drafted : 0,
      total: g.total,
      color,
      other,
      children: children.map((k) => ({ ...k, drafted: drafts ? k.drafted : 0 })),
    };
  });
}

/**
 * How many of a group's rows show when it is opened (LAI-1162): a space can
 * hold hundreds of tasks, so the largest ten first and *Show N more* adds up
 * to 25 at a time; never the whole list at once.
 */
export const CHILD_STEP = 10;
/** What *Show N more* adds each time. */
export const MORE_STEP = 25;

/** The rows to draw of `n`, `shown` asked for so far; and how many the next step adds. */
export function childWindow(
  n: number,
  shown: number = CHILD_STEP,
): { readonly draw: number; readonly more: number } {
  const draw = Math.min(n, Math.max(CHILD_STEP, shown));
  return { draw, more: Math.min(MORE_STEP, n - draw) };
}

/** `3 tasks` — how many rows a group opens to. */
export function childCount(second: Grouping, n: number): string {
  if (second === 'none') return '';
  const [one, many] = PLURALS[second];
  return `${String(n)} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- donut

export interface Slice {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly minutes: number;
  readonly pct: string;
  /** Where the slice starts and ends on the ring, 0–100. */
  readonly start: number;
  readonly end: number;
}

/** The donut beside the table: a slice a group, the sixth on folded into *Other*. */
export function slicesOf(groups: readonly Group[]): readonly Slice[] {
  const src: { key: string; label: string; color: string; minutes: number }[] = [];
  for (const g of groups) {
    if (g.other) {
      const o = src.find((s) => s.key === '__other');
      if (o === undefined) {
        src.push({ key: '__other', label: 'Other', color: OTHER_COLOR, minutes: g.total });
      } else o.minutes += g.total;
    } else {
      src.push({
        key: g.face.key,
        label: g.face.code === undefined ? g.face.label : `${g.face.code} ${g.face.label}`,
        color: g.color,
        minutes: g.total,
      });
    }
  }
  const all = src.reduce((n, s) => n + s.minutes, 0);
  let at = 0;
  return src.map((s) => {
    const start = all === 0 ? 0 : (at / all) * 100;
    at += s.minutes;
    const end = all === 0 ? 0 : (at / all) * 100;
    return { ...s, pct: shareLabel(s.minutes, all), start, end };
  });
}

/**
 * The ring as a `conic-gradient` of tokens, a hairline of card between
 * slices; a dimmed slice is mixed toward the card, never a literal colour.
 */
export function donutBackground(slices: readonly Slice[], active?: string): string {
  if (slices.length === 0) return 'var(--bg-column)';
  const gap = slices.length > 1 ? 0.6 : 0;
  const stops: string[] = [];
  for (const s of slices) {
    const colour =
      active !== undefined && active !== s.key
        ? `color-mix(in srgb, ${s.color} 26%, var(--bg-card))`
        : s.color;
    const cut = Math.max(s.start, s.end - gap);
    stops.push(`${colour} ${String(s.start)}% ${String(cut)}%`);
    if (gap > 0) stops.push(`var(--bg-card) ${String(cut)}% ${String(s.end)}%`);
  }
  return `conic-gradient(${stops.join(', ')})`;
}

// --------------------------------------------------------------- states

/** What the body draws once the report is read. */
export type Shown =
  | { readonly kind: 'empty' }
  | { readonly kind: 'filtered-empty' }
  | { readonly kind: 'unconfirmed'; readonly drafted: number }
  | { readonly kind: 'figures'; readonly draftsOnly: boolean };

/**
 * Which body a read report gets: nothing at all (frame 1k), nothing matching
 * the filters, nothing confirmed with drafts waiting and drafts left out, or
 * the figures — *drafts only* when nothing is confirmed (frame 1m).
 */
export function shownFor(report: TimeReport, drafts: boolean, filtered: boolean): Shown {
  const { confirmed_minutes: c, drafted_minutes: d } = report.totals;
  if (c + d === 0) return filtered ? { kind: 'filtered-empty' } : { kind: 'empty' };
  // Drafted time is named only when it was asked for (D-088 items 2–3).
  if (!drafts && c === 0) {
    return report.include_drafts ? { kind: 'unconfirmed', drafted: d } : { kind: 'empty' };
  }
  return { kind: 'figures', draftsOnly: drafts && c === 0 };
}

// ------------------------------------------------------- a space's weeks

export interface WeekLine {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  /** Null when withheld (D-136 item 2). */
  readonly minutes: number | null;
  readonly people: number;
  /** Of the busiest shown week, 0–100. */
  readonly width: number;
}

/** A space admin's weeks as lines: a withheld week is said, never drawn as zero. */
export function weekLines(weeks: readonly SpaceWeek[]): readonly WeekLine[] {
  const busiest = Math.max(0, ...weeks.map((w) => w.confirmed_minutes ?? 0));
  return weeks.map((w) => ({
    from: w.from,
    to: w.to,
    label: `${dayShort(w.from)} – ${dayShort(w.to)}`,
    minutes: w.confirmed_minutes,
    people: w.people,
    width:
      w.confirmed_minutes === null || busiest === 0 ? 0 : (w.confirmed_minutes / busiest) * 100,
  }));
}

/** The words a withheld week reads (D-138: the floor does not count the reader). */
export const WITHHELD = 'withheld — fewer than 3 others';

/** A week line for a screen reader and its title. */
export function weekAria(line: WeekLine): string {
  return line.minutes === null
    ? `${line.label}: ${WITHHELD}`
    : `${line.label}: ${hoursWords(line.minutes)} confirmed, ${String(line.people)} ${
        line.people === 1 ? 'person' : 'people'
      }`;
}

// ------------------------------------------------------------- the error

/** The server's reason a report was refused, when its details carry one. */
export function refusalReason(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const reason = (details as { readonly reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}
