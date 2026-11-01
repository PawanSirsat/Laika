import {
  ENTRY_KINDS,
  SUMMARY_MAX_DAYS,
  type EntryKind,
  type MyDay,
  type ProjectRef,
  type SummaryKind,
  type SummaryProject,
  type SummaryTask,
  type TaskRef,
  type TimeSummary,
} from '../../../api/time.ts';
import { kindChartLabel } from './entry-kinds.ts';

/**
 * The Overview tab's figures (the owner's design, D-110 item 4, LAI-505;
 * LAI-526): one shape for every scope — the open day's, converted here from
 * its drafts and entries, and a week's or a picked range's, from
 * `GET /me/time/summary`. A share is a whole percent of what was tracked;
 * nothing tracked means no share, never a hundred of nothing.
 */

export interface Stat {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly sub: string;
}

/** A whole percent of `of`, or 0 when there is nothing to be a share of. */
export function share(part: number, of: number): number {
  return of <= 0 ? 0 : Math.round((part / of) * 100);
}

const DAY_MS = 86_400_000;

/** A calendar day `n` days from `day`. */
export const shiftDay = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Days `from` to `to`, both kept. */
export const daysIn = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

const total = (r: { confirmed_minutes: number; drafted_minutes: number }): number =>
  r.confirmed_minutes + r.drafted_minutes;

/**
 * The open day in a summary's shape — the server's grouping, so a day and a
 * week read the same: by project, by task (time on no task kept apart per
 * project), by kind (`null` for time nobody named), largest first.
 */
export function summaryOfDay(view: Pick<MyDay, 'day' | 'drafts' | 'entries'>): TimeSummary {
  interface Row {
    confirmed_minutes: number;
    drafted_minutes: number;
  }
  const projects = new Map<string, Row & { project: ProjectRef | null }>();
  const tasks = new Map<
    string,
    Row & { task: TaskRef | null; project: ProjectRef | null; untied: boolean }
  >();
  const kinds = new Map<EntryKind | null, number>();
  const add = (
    task: TaskRef | null,
    project: ProjectRef | null,
    minutes: number,
    confirmed: boolean,
    untied = false,
  ): void => {
    const pKey = project?.id ?? '';
    const p = projects.get(pKey) ?? { project, confirmed_minutes: 0, drafted_minutes: 0 };
    const tKey = task?.id ?? `${untied ? 'untied' : 'none'}:${pKey}`;
    const t = tasks.get(tKey) ?? {
      task,
      project,
      untied,
      confirmed_minutes: 0,
      drafted_minutes: 0,
    };
    if (confirmed) {
      p.confirmed_minutes += minutes;
      t.confirmed_minutes += minutes;
    } else {
      p.drafted_minutes += minutes;
      t.drafted_minutes += minutes;
    }
    projects.set(pKey, p);
    tasks.set(tKey, t);
  };
  let confirmed = 0;
  let drafted = 0;
  let meeting = 0;
  let manual = 0;
  for (const e of view.entries) {
    confirmed += e.minutes;
    add(e.task, e.project, e.minutes, true);
    const kind = e.kind ?? null;
    kinds.set(kind, (kinds.get(kind) ?? 0) + e.minutes);
    if (e.kind === 'meeting') meeting += e.minutes;
    if (e.source === 'manual') manual += e.minutes;
  }
  for (const d of view.drafts) {
    drafted += d.minutes;
    add(d.task, d.project, d.minutes, false, d.task === null && !d.general);
    kinds.set(null, (kinds.get(null) ?? 0) + d.minutes);
  }
  const byTotal = <T extends Row>(a: T, b: T): number => total(b) - total(a);
  return {
    from: view.day,
    to: view.day,
    days: 1,
    active_days: confirmed + drafted > 0 ? 1 : 0,
    confirmed_minutes: confirmed,
    drafted_minutes: drafted,
    meeting_minutes: meeting,
    manual_minutes: manual,
    by_day: [{ day: view.day, confirmed_minutes: confirmed, drafted_minutes: drafted }],
    by_project: [...projects.values()].sort(byTotal),
    by_task: [...tasks.values()].sort(byTotal),
    by_kind: [...kinds.entries()]
      .map(([kind, minutes]) => ({ kind, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

/** Tracked, To review, Meetings, Off-screen — and Per active day over more than one. */
export function statsOf(s: TimeSummary): readonly Stat[] {
  const tracked = total(s);
  const stats: Stat[] = [
    {
      key: 'tracked',
      label: 'Tracked',
      value: tracked,
      sub: `${String(s.confirmed_minutes)} confirmed`,
    },
    {
      key: 'review',
      label: 'To review',
      value: s.drafted_minutes,
      sub: s.drafted_minutes > 0 ? 'drafts waiting' : 'nothing waiting',
    },
    {
      key: 'meetings',
      label: 'Meetings',
      value: s.meeting_minutes,
      sub: `${String(share(s.meeting_minutes, tracked))}% of tracked`,
    },
    { key: 'off', label: 'Off-screen', value: s.manual_minutes, sub: 'added by you' },
  ];
  if (s.days > 1) {
    stats.push({
      key: 'per-day',
      label: 'Per active day',
      value: s.active_days === 0 ? 0 : Math.round(tracked / s.active_days),
      sub: `${String(s.active_days)} of ${String(s.days)} days`,
    });
  }
  return stats;
}

export interface KindRow {
  readonly key: EntryKind;
  readonly label: string;
  readonly minutes: number;
  /** Of what was tracked, 0–100. */
  readonly pct: number;
}

/** By kind, in the design's order and words: time nobody named is Building's (LAI-510). */
export function kindRows(byKind: readonly SummaryKind[]): readonly KindRow[] {
  const minutes = new Map<EntryKind, number>();
  for (const k of byKind) {
    const key = k.kind ?? 'work';
    minutes.set(key, (minutes.get(key) ?? 0) + k.minutes);
  }
  const all = [...minutes.values()].reduce((n, m) => n + m, 0);
  return ENTRY_KINDS.filter((key) => (minutes.get(key) ?? 0) > 0).map((key) => {
    const m = minutes.get(key) ?? 0;
    return { key, label: kindChartLabel(key), minutes: m, pct: share(m, all) };
  });
}

export interface ProjectRow {
  /** The project's id, or `none` for time on no project. */
  readonly key: string;
  readonly project: ProjectRef | null;
  readonly label: string;
  readonly minutes: number;
  readonly confirmed: number;
  /** Of what was tracked, 0–100. */
  readonly pct: number;
  /** Of the busiest project, 0–1, for the bar. */
  readonly width: number;
}

/** By project, largest first; *No project* for time on none (LAI-526). */
export function projectRows(byProject: readonly SummaryProject[]): readonly ProjectRow[] {
  const all = byProject.reduce((n, p) => n + total(p), 0);
  const busiest = Math.max(0, ...byProject.map(total));
  return [...byProject]
    .sort((a, b) => total(b) - total(a))
    .map((p) => ({
      key: p.project?.id ?? 'none',
      project: p.project,
      label: p.project?.name ?? 'No project',
      minutes: total(p),
      confirmed: p.confirmed_minutes,
      pct: share(total(p), all),
      width: busiest === 0 ? 0 : total(p) / busiest,
    }));
}

export interface TaskRow {
  /** The card's key; a project's name for time on it alone; *No task* or *No task yet*. */
  readonly key: string;
  readonly title: string;
  readonly minutes: number;
  /** Of the busiest task, 0–1, for the bar. */
  readonly width: number;
}

/** The rows *By task* shows: the design's six (LAI-510). */
export const TASK_ROWS = 6;

/**
 * Minutes by card, largest first, the busiest six (the design, LAI-510): a
 * block on a project alone under the project's name, time typed on no task
 * as *No task* (logged by kind), and drafted time nobody has put anywhere yet
 * as *No task yet*.
 */
export function taskRows(byTask: readonly SummaryTask[]): readonly TaskRow[] {
  const rows = new Map<string, { title: string; minutes: number }>();
  for (const t of byTask) {
    const key = t.task?.key ?? t.project?.name ?? (t.untied ? 'No task yet' : 'No task');
    const title =
      t.task?.title ?? (t.project !== null ? 'General' : t.untied ? '' : 'logged by kind');
    const row = rows.get(key) ?? { title, minutes: 0 };
    row.minutes += total(t);
    rows.set(key, row);
  }
  const list = [...rows.entries()].map(([key, r]) => ({ key, title: r.title, minutes: r.minutes }));
  const busiest = Math.max(0, ...list.map((r) => r.minutes));
  return list
    .sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key))
    .slice(0, TASK_ROWS)
    .map((r) => ({ ...r, width: busiest === 0 ? 0 : r.minutes / busiest }));
}

export interface DayBar {
  readonly day: string;
  readonly confirmed: number;
  readonly drafted: number;
  /** Of the busiest day, 0–1. */
  readonly height: number;
}

/** By day over a stretch: each day's confirmed and drafted, of the busiest. */
export function dayBars(s: TimeSummary): readonly DayBar[] {
  const busiest = Math.max(0, ...s.by_day.map(total));
  return s.by_day.map((d) => ({
    day: d.day,
    confirmed: d.confirmed_minutes,
    drafted: d.drafted_minutes,
    height: busiest === 0 ? 0 : total(d) / busiest,
  }));
}

export interface DayRange {
  readonly from: string;
  readonly to: string;
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
  const first = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case 'last7':
      return { from: shiftDay(today, -6), to: today };
    case 'last30':
      return { from: shiftDay(today, -29), to: today };
    case 'thisMonth':
      return { from: first, to: today };
    case 'lastMonth': {
      const end = shiftDay(first, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
  }
}

/** Monday to Sunday of the week holding `day`. */
export function weekOf(day: string): DayRange {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const from = shiftDay(day, -((weekday + 6) % 7));
  return { from, to: shiftDay(from, 6) };
}

/** Why a picked range cannot be read, in words, or undefined when it can. */
export function rangeProblem(range: DayRange): string | undefined {
  if (range.from === '' || range.to === '') return 'Pick both days.';
  if (range.to < range.from) return 'The last day is before the first.';
  if (daysIn(range.from, range.to) > SUMMARY_MAX_DAYS) {
    return `Pick ${String(SUMMARY_MAX_DAYS)} days or fewer.`;
  }
  return undefined;
}
