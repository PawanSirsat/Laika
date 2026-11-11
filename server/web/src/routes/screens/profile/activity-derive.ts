import { AGENT_CLIENT_NAMES, type AgentClient } from '../../../api/agent-clients.ts';
import type { PeopleActivity } from '../../../api/people-activity.ts';

/**
 * How the profile's activity heatmap reads (D-079, LAI-751; D-139, LAI-1154).
 *
 * Pure: the server sends one integer per day per source, and everything the
 * card shows beyond that — which week a day falls in, how dark its square is,
 * the streaks, the busiest weekday, the share pushed — is worked out here, so
 * each rule is unit-tested without a browser. Nothing here is a score: every
 * figure is a count of days or commits, said as such (D-079 item 6).
 */

/**
 * The two sources the card draws. The board's actions are in the response and
 * no longer on the card (LAI-1154): the design draws GitHub and Local only.
 */
export type HeatSource = 'github' | 'local';

/** A colour step: 0 is nothing that day, 1–4 the source's own quartiles. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatDay {
  readonly index: number;
  /** `YYYY-MM-DD`. */
  readonly day: string;
  /** 0 Monday … 6 Sunday. */
  readonly weekday: number;
  /** Commits pushed; null while the source is not shown. */
  readonly github: number | null;
  readonly localCommits: number | null;
  readonly prompts: number | null;
  readonly sessions: number | null;
  /** Prompts + sessions + commits not pushed: the Local colour's measure. */
  readonly local: number | null;
  /**
   * A day before the person joined (LAI-1154): drawn apart, named so, and
   * left out of every stat — they could not have been active on it.
   */
  readonly pre: boolean;
  readonly promptsByAgent: Readonly<Partial<Record<AgentClient, number>>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const at = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const dayAfter = (day: string, n: number): string =>
  new Date(at(day) + n * DAY_MS).toISOString().slice(0, 10);

/** The day's weekday, Monday first — a calendar date, so UTC arithmetic. */
export function weekdayOf(day: string): number {
  return (new Date(at(day)).getUTCDay() + 6) % 7;
}

/** How many days a range covers: what the server sends for it. */
export function rangeDays(range: '12w' | '52w'): number {
  return range === '12w' ? 84 : 364;
}

/**
 * The day someone joined, `YYYY-MM-DD` in the series' time zone — the zone
 * the days are counted in. An unknown zone falls back to UTC.
 */
export function joinedDay(createdAt: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(createdAt));
  } catch {
    return new Date(createdAt).toISOString().slice(0, 10);
  }
}

/**
 * The response, one entry per day, oldest first. Days before `joined`
 * (`YYYY-MM-DD`) are marked; with none given, no day is.
 */
export function heatDays(activity: PeopleActivity, joined?: string): HeatDay[] {
  const { series } = activity;
  const length = series.board_self.length;
  return Array.from({ length }, (_, i) => {
    const day = dayAfter(activity.start, i);
    const localCommits = series.local_commits?.[i] ?? null;
    const prompts = series.prompts?.[i] ?? null;
    const sessions = series.sessions?.[i] ?? null;
    const local =
      localCommits === null || prompts === null || sessions === null
        ? null
        : localCommits + prompts + sessions;
    return {
      index: i,
      day,
      weekday: weekdayOf(day),
      github: series.github?.[i] ?? null,
      localCommits,
      prompts,
      sessions,
      local,
      pre: joined !== undefined && day < joined,
      promptsByAgent: activity.prompts_by_agent[day] ?? {},
    };
  });
}

/** Days for a range ending `end`, all empty — the skeleton's grid. */
export function emptyDays(end: string, length: number, joined?: string): HeatDay[] {
  const start = dayAfter(end, -(length - 1));
  return Array.from({ length }, (_, i) => {
    const day = dayAfter(start, i);
    return {
      index: i,
      day,
      weekday: weekdayOf(day),
      github: null,
      localCommits: null,
      prompts: null,
      sessions: null,
      local: null,
      pre: joined !== undefined && day < joined,
      promptsByAgent: {},
    };
  });
}

/** Where a day sits: its week column and weekday row, Monday on top. */
export interface Placed {
  readonly day: HeatDay;
  readonly column: number;
  readonly row: number;
}

export interface MonthSpan {
  readonly label: string;
  /** The first week column the month's label covers. */
  readonly column: number;
  /** How many week columns, until the next month's label. */
  readonly span: number;
}

export interface CalendarLayout {
  readonly columns: number;
  readonly placed: readonly Placed[];
  readonly months: readonly MonthSpan[];
}

/**
 * The days as week columns, Monday first: the first column is the week
 * holding the first day, padded above it. A month's label starts at the first
 * column whose Monday-week holds its 1st — the column a reader looks for it in
 * — and runs to the next month's; a label for a sliver at either end, one
 * column too narrow to hold it, is dropped rather than overlapped or overhung.
 */
export function calendarLayout(days: readonly HeatDay[]): CalendarLayout {
  const lead = days[0]?.weekday ?? 0;
  const placed = days.map((day) => ({
    day,
    column: Math.floor((day.index + lead) / 7),
    row: day.weekday,
  }));
  const columns = placed.length === 0 ? 0 : (placed.at(-1)?.column ?? 0) + 1;

  const starts: { label: string; column: number }[] = [];
  for (const p of placed) {
    const date = new Date(at(p.day.day));
    if (date.getUTCDate() === 1 || p.day.index === 0) {
      const label = MONTHS[date.getUTCMonth()] ?? '';
      const last = starts.at(-1);
      if (last?.column === p.column) {
        // Two months begin in one column: the later one names it.
        starts[starts.length - 1] = { label, column: p.column };
      } else {
        starts.push({ label, column: p.column });
      }
    }
  }
  // The opening month gets its own label only with room for one (two columns).
  if (starts.length > 1 && (starts[1]?.column ?? 0) - (starts[0]?.column ?? 0) < 2) {
    starts.shift();
  }
  // So does the closing one. A label wider than its one column runs past the
  // canvas, the scroller grows by the overhang, and scrolled to the newest
  // week each source's sticky heading is left behind out of view (LAI-1017).
  if (starts.length > 1 && columns - (starts.at(-1)?.column ?? 0) < 2) {
    starts.pop();
  }

  const months = starts.map((start, i) => ({
    label: start.label,
    column: start.column,
    span: (starts[i + 1]?.column ?? columns) - start.column,
  }));
  return { columns, placed, months };
}

/**
 * The quartile cut points of a source's non-zero days, so each source is
 * shaded on its own scale — a busy prompt day and a busy push day are both
 * dark. Like GitHub's graph: zero is empty, the rest split into four, and the
 * busiest day is the darkest.
 */
export function levelScale(
  values: readonly (number | null)[],
): (value: number | null) => HeatLevel {
  const positive = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return () => 0;
  // Nearest rank, as the profile's percentiles are taken (`metrics.ts`).
  const cut = (q: number) => positive[Math.max(0, Math.ceil(q * positive.length) - 1)]!;
  const [q1, q2, q3] = [cut(0.25), cut(0.5), cut(0.75)];
  const most = positive.at(-1)!;
  return (value) => {
    if (value === null || value <= 0) return 0;
    // The busiest day is always the darkest, however few days there are: with
    // two days of pushes, the quartiles alone would leave the larger at 3.
    if (value >= most) return 4;
    if (value <= q1) return 1;
    if (value <= q2) return 2;
    if (value <= q3) return 3;
    return 4;
  };
}

// --------------------------------------------------------------------- stats

export interface Streak {
  readonly days: number;
  readonly from: string | null;
  readonly to: string | null;
}

export interface ActivityStats {
  readonly activeDays: number;
  /** The days counted: the range's, less any before they joined. */
  readonly totalDays: number;
  /** Some of the range is before they joined, so the counts are "since joining". */
  readonly sinceJoining: boolean;
  /** Ending today — or yesterday, when today has nothing yet. */
  readonly currentStreak: number;
  readonly longestStreak: Streak;
  /**
   * The weekdays with the most active days — **every one of them when they
   * tie** (LAI-751), never the first quietly — and how many of its days were.
   */
  readonly busiestWeekday: {
    readonly weekdays: readonly number[];
    readonly active: number;
    readonly of: number;
  } | null;
  /**
   * Of the commits counted, the share already pushed, 0–100; null when local
   * activity is not shown, or there were no commits to share out.
   */
  readonly pushedPercent: number | null;
  readonly pushed: number;
  readonly unpushed: number;
}

/** GitHub and Local together — Stacked's measure; null when neither is shown. */
export function combined(day: HeatDay): number | null {
  return day.github === null && day.local === null ? null : (day.github ?? 0) + (day.local ?? 0);
}

/** A day with a commit, a prompt, a session or a local commit — the board is not on the card. */
export function isActive(day: HeatDay): boolean {
  return !day.pre && (combined(day) ?? 0) > 0;
}

/**
 * Every stat is over the days since they joined (LAI-1154): a day before it
 * is not an inactive day, so it neither counts against them nor breaks a run.
 */
export function activityStats(all: readonly HeatDay[]): ActivityStats {
  const days = all.filter((day) => !day.pre);
  const active = days.map(isActive);

  let longest: Streak = { days: 0, from: null, to: null };
  let run = 0;
  days.forEach((day, i) => {
    run = active[i] ? run + 1 : 0;
    if (run > longest.days) {
      longest = { days: run, from: days[i - run + 1]?.day ?? null, to: day.day };
    }
  });

  // Today may simply not have happened yet: a streak still standing at
  // yesterday is current, and today extends it once it has something.
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && !active[i]) i -= 1;
  while (i >= 0 && active[i]) {
    current += 1;
    i -= 1;
  }

  const byWeekday = Array.from({ length: 7 }, () => ({ active: 0, of: 0 }));
  days.forEach((day, k) => {
    const slot = byWeekday[day.weekday]!;
    slot.of += 1;
    if (active[k]) slot.active += 1;
  });
  const most = Math.max(...byWeekday.map((slot) => slot.active));
  const tied = byWeekday.flatMap((slot, weekday) =>
    most > 0 && slot.active === most ? [weekday] : [],
  );
  const busiest: ActivityStats['busiestWeekday'] =
    tied.length === 0 ? null : { weekdays: tied, active: most, of: byWeekday[tied[0]!]?.of ?? 0 };

  const shown = days.some((d) => d.github !== null && d.localCommits !== null);
  const pushed = days.reduce((sum, d) => sum + (d.github ?? 0), 0);
  const unpushed = days.reduce((sum, d) => sum + (d.localCommits ?? 0), 0);

  return {
    activeDays: active.filter(Boolean).length,
    totalDays: days.length,
    sinceJoining: days.length < all.length,
    currentStreak: current,
    longestStreak: longest,
    busiestWeekday: busiest,
    pushedPercent:
      !shown || pushed + unpushed === 0 ? null : Math.round((pushed * 100) / (pushed + unpushed)),
    pushed,
    unpushed,
  };
}

/**
 * The busiest weekday the tile names, or null for *no single day yet*: one
 * weekday ahead of every other, on at least three of its days — fewer is too
 * little to call a habit (the design's rule, LAI-1154).
 */
export function singleBusiest(stats: ActivityStats): number | null {
  const busiest = stats.busiestWeekday;
  if (busiest?.weekdays.length !== 1 || busiest.active < 3) return null;
  return busiest.weekdays[0] ?? null;
}

// ---------------------------------------------------------------------- text

/** `Wed 7 Oct` — the tooltip's heading. */
export function shortDate(day: string): string {
  const date = new Date(at(day));
  return `${WEEKDAYS[weekdayOf(day)] ?? ''} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

/** `11 Jan – 16 Jan`, `28 Feb – 3 Mar`, `7 Oct` — a streak's span, as the design writes it. */
export function spanLabel(from: string, to: string): string {
  const a = new Date(at(from));
  const b = new Date(at(to));
  const one = (d: Date) => `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''}`;
  return from === to ? one(a) : `${one(a)} – ${one(b)}`;
}

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? '';
}

/** An agent's name as the heatmap says it: `other` is *Other agent*. */
export function agentLabel(kind: AgentClient): string {
  return kind === 'other' ? 'Other agent' : AGENT_CLIENT_NAMES[kind];
}

/** `1 prompt`, `3,507 prompts`. */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

export interface TipLine {
  readonly source: HeatSource;
  readonly n: number | null;
  readonly text: string;
}

/**
 * A day's whole breakdown, source by source — the tooltip, and (joined) what a
 * screen reader hears on the day. A source not on show says why in a word
 * rather than reading as zero.
 */
export function dayLines(day: HeatDay): TipLine[] {
  const lines: TipLine[] = [];
  if (day.github === null) {
    lines.push({ source: 'github', n: null, text: 'pushed commits not collected' });
  } else {
    lines.push({
      source: 'github',
      n: day.github,
      text: day.github === 1 ? 'commit pushed' : 'commits pushed',
    });
  }

  if (day.local === null) {
    lines.push({ source: 'local', n: null, text: 'local activity not collected' });
  } else {
    lines.push({
      source: 'local',
      n: day.localCommits,
      text: day.localCommits === 1 ? 'local commit not pushed' : 'local commits not pushed',
    });
    const agents = (Object.entries(day.promptsByAgent) as [AgentClient, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${agentLabel(kind)} ${n.toLocaleString('en-GB')}`);
    lines.push({
      source: 'local',
      n: day.prompts,
      text: `${day.prompts === 1 ? 'prompt' : 'prompts'}${agents.length > 0 ? ` (${agents.join(', ')})` : ''}`,
    });
    lines.push({
      source: 'local',
      n: day.sessions,
      text: day.sessions === 1 ? 'agent session' : 'agent sessions',
    });
  }
  return lines;
}

/** The day as one sentence: what a screen reader hears when it lands there. */
export function dayText(day: HeatDay): string {
  const date = new Date(at(day.day));
  const heading = `${weekdayName(day.weekday)} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''} ${String(date.getUTCFullYear())}`;
  if (day.pre) return `${heading} · before joining`;
  const body = dayLines(day)
    .map((line) => (line.n === null ? line.text : `${line.n.toLocaleString('en-GB')} ${line.text}`))
    .join(', ');
  return `${heading}: ${body}`;
}

/** A source's totals over the range, for its legend. */
export function sourceTotals(days: readonly HeatDay[]): {
  pushed: number;
  prompts: number;
  sessions: number;
  unpushed: number;
} {
  return days.reduce(
    (sum, d) => ({
      pushed: sum.pushed + (d.github ?? 0),
      prompts: sum.prompts + (d.prompts ?? 0),
      sessions: sum.sessions + (d.sessions ?? 0),
      unpushed: sum.unpushed + (d.localCommits ?? 0),
    }),
    { pushed: 0, prompts: 0, sessions: 0, unpushed: 0 },
  );
}

/**
 * A source's line in the legend: `6,006 commits pushed`; `85 prompts · 83
 * sessions · 9 not pushed`, or *No local activity yet* when Local has nothing.
 */
export function totalLine(source: HeatSource, totals: ReturnType<typeof sourceTotals>): string {
  if (source === 'github') return plural(totals.pushed, 'commit pushed', 'commits pushed');
  if (totals.prompts + totals.sessions + totals.unpushed === 0) return 'No local activity yet';
  return [
    plural(totals.prompts, 'prompt', 'prompts'),
    plural(totals.sessions, 'session', 'sessions'),
    `${totals.unpushed.toLocaleString('en-GB')} not pushed`,
  ].join(' · ');
}

/**
 * The card's range, before the viewer picks one (LAI-1154): 12 weeks on a
 * phone, or for someone who joined under 12 weeks ago — a year of their
 * squares would be almost all before they joined — else a year.
 */
export function openingRange(phone: boolean, joinedAt: number, now: number): '12w' | '52w' {
  return phone || now - joinedAt < rangeDays('12w') * DAY_MS ? '12w' : '52w';
}

/** `joined Mon 2 Nov` when they joined inside the range shown, else nothing. */
export function joinedNote(days: readonly HeatDay[], joined: string): string | null {
  const first = days[0]?.day;
  const last = days.at(-1)?.day;
  if (first === undefined || last === undefined || joined < first || joined > last) return null;
  return `joined ${shortDate(joined)}`;
}

// ------------------------------------------------------------- the viewer's

export type HeatDesign = 'split' | 'stacked';
export const HEAT_DESIGNS: readonly HeatDesign[] = ['split', 'stacked'];

/** Per viewer, not per person viewed: it is how *they* like to read it. */
export function designKey(viewerId: string): string {
  return `laika.profile.activity-design.${viewerId}`;
}

/** The viewer's remembered design, or Split — the design's opening view — by default (LAI-1154). */
export function storedDesign(value: string | null): HeatDesign {
  return value === 'stacked' ? 'stacked' : 'split';
}

/**
 * Where a key press moves within the grid: a column is a week, a row a
 * weekday. Clamped to the days there are, so the edges hold.
 */
export function moveIndex(index: number, key: string, length: number): number | null {
  const step =
    key === 'ArrowLeft'
      ? -7
      : key === 'ArrowRight'
        ? 7
        : key === 'ArrowUp'
          ? -1
          : key === 'ArrowDown'
            ? 1
            : key === 'Home'
              ? -index
              : key === 'End'
                ? length - 1 - index
                : null;
  if (step === null) return null;
  return Math.min(length - 1, Math.max(0, index + step));
}
