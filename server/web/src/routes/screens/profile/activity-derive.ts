import { AGENT_CLIENT_NAMES, type AgentClient } from '../../../api/agent-clients.ts';
import type { PeopleActivity } from '../../../api/people-activity.ts';

/**
 * How the profile's activity heatmap reads (D-079, LAI-751).
 *
 * Pure: the server sends one integer per day per source, and everything the
 * card shows beyond that — which week a day falls in, how dark its square is,
 * the streaks, the busiest weekday, the share pushed — is worked out here, so
 * each rule is unit-tested without a browser. Nothing here is a score: every
 * figure is a count of days or commits, said as such (D-079 item 6).
 */

export type HeatSource = 'github' | 'local' | 'board';

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
  readonly boardSelf: number;
  readonly boardAgent: number;
  readonly board: number;
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

/** The response, one entry per day, oldest first. */
export function heatDays(activity: PeopleActivity): HeatDay[] {
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
    const boardSelf = series.board_self[i] ?? 0;
    const boardAgent = series.board_agent[i] ?? 0;
    return {
      index: i,
      day,
      weekday: weekdayOf(day),
      github: series.github?.[i] ?? null,
      localCommits,
      prompts,
      sessions,
      local,
      boardSelf,
      boardAgent,
      board: boardSelf + boardAgent,
      promptsByAgent: activity.prompts_by_agent[day] ?? {},
    };
  });
}

/** Days for a range ending `end`, all empty — the skeleton's grid. */
export function emptyDays(end: string, length: number): HeatDay[] {
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
      boardSelf: 0,
      boardAgent: 0,
      board: 0,
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
 * — and runs to the next month's; a label for a sliver at the very start that
 * the next would crowd is dropped rather than overlapped.
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
  readonly totalDays: number;
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

/** A day with anything recorded in a source on show. */
export function isActive(day: HeatDay): boolean {
  return (day.github ?? 0) + (day.local ?? 0) + day.board > 0;
}

export function activityStats(days: readonly HeatDay[]): ActivityStats {
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
    currentStreak: current,
    longestStreak: longest,
    busiestWeekday: busiest,
    pushedPercent:
      !shown || pushed + unpushed === 0 ? null : Math.round((pushed * 100) / (pushed + unpushed)),
    pushed,
    unpushed,
  };
}

// ---------------------------------------------------------------------- text

/** `Wed 7 Oct` — the tooltip's heading. */
export function shortDate(day: string): string {
  const date = new Date(at(day));
  return `${WEEKDAYS[weekdayOf(day)] ?? ''} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

/** `2–20 Mar`, `28 Feb – 3 Mar` — a streak's span. */
export function spanLabel(from: string, to: string): string {
  const a = new Date(at(from));
  const b = new Date(at(to));
  if (from === to) return `${String(a.getUTCDate())} ${MONTHS[a.getUTCMonth()] ?? ''}`;
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${String(a.getUTCDate())}–${String(b.getUTCDate())} ${MONTHS[b.getUTCMonth()] ?? ''}`;
  }
  return `${String(a.getUTCDate())} ${MONTHS[a.getUTCMonth()] ?? ''} – ${String(b.getUTCDate())} ${MONTHS[b.getUTCMonth()] ?? ''}`;
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

  lines.push({
    source: 'board',
    n: day.boardSelf,
    text: day.boardSelf === 1 ? 'board action by them' : 'board actions by them',
  });
  lines.push({
    source: 'board',
    n: day.boardAgent,
    text: day.boardAgent === 1 ? 'board action by their agents' : 'board actions by their agents',
  });
  return lines;
}

/** The day as one sentence: what a screen reader hears when it lands there. */
export function dayText(day: HeatDay): string {
  const date = new Date(at(day.day));
  const heading = `${weekdayName(day.weekday)} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''} ${String(date.getUTCFullYear())}`;
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
  boardSelf: number;
  boardAgent: number;
} {
  return days.reduce(
    (sum, d) => ({
      pushed: sum.pushed + (d.github ?? 0),
      prompts: sum.prompts + (d.prompts ?? 0),
      sessions: sum.sessions + (d.sessions ?? 0),
      unpushed: sum.unpushed + (d.localCommits ?? 0),
      boardSelf: sum.boardSelf + d.boardSelf,
      boardAgent: sum.boardAgent + d.boardAgent,
    }),
    { pushed: 0, prompts: 0, sessions: 0, unpushed: 0, boardSelf: 0, boardAgent: 0 },
  );
}

// ------------------------------------------------------------- the viewer's

export type HeatDesign = 'split' | 'stacked';
export const HEAT_DESIGNS: readonly HeatDesign[] = ['split', 'stacked'];

/** Per viewer, not per person viewed: it is how *they* like to read it. */
export function designKey(viewerId: string): string {
  return `laika.profile.activity-design.${viewerId}`;
}

/** The viewer's remembered design, or B — stacked grids — by default. */
export function storedDesign(value: string | null): HeatDesign {
  return value === 'split' ? 'split' : 'stacked';
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
