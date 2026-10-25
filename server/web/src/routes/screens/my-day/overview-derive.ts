import type { MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { offScreen } from './summary-derive.ts';

/**
 * The Overview tab's figures (the owner's design, D-110 item 4, LAI-505):
 * the day's, from its drafts and entries; the week's, from the strip's
 * seven days. A share is a whole percent of what was tracked; nothing
 * tracked means no share, never a hundred of nothing.
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

/** Meetings: the entries of kind meeting. */
export function meetingMinutes(entries: readonly TimeEntry[]): number {
  return entries.filter((e) => e.kind === 'meeting').reduce((n, e) => n + e.minutes, 0);
}

export function dayStats(view: Pick<MyDay, 'drafts' | 'entries'>): readonly Stat[] {
  const confirmed = view.entries.reduce((n, e) => n + e.minutes, 0);
  const drafted = view.drafts.reduce((n, d) => n + d.minutes, 0);
  const tracked = confirmed + drafted;
  const meetings = meetingMinutes(view.entries);
  const off = offScreen(view.entries).reduce((n, e) => n + e.minutes, 0);
  return [
    { key: 'tracked', label: 'Tracked', value: tracked, sub: `${String(confirmed)} confirmed` },
    {
      key: 'review',
      label: 'To review',
      value: drafted,
      sub: drafted > 0 ? 'drafts waiting' : 'nothing waiting',
    },
    {
      key: 'meetings',
      label: 'Meetings',
      value: meetings,
      sub: `${String(share(meetings, tracked))}% of tracked`,
    },
    { key: 'off', label: 'Off-screen', value: off, sub: 'added by you' },
  ];
}

export interface WeekDayBar {
  readonly day: string;
  readonly confirmed: number;
  readonly drafted: number;
  /** Of the week's busiest day, 0–1. */
  readonly height: number;
}

export function weekStats(week: MyDay['week']): {
  readonly stats: readonly Stat[];
  readonly days: readonly WeekDayBar[];
} {
  const confirmed = week.reduce((n, d) => n + d.confirmed_minutes, 0);
  const drafted = week.reduce((n, d) => n + d.drafted_minutes, 0);
  const tracked = confirmed + drafted;
  const active = week.filter((d) => d.confirmed_minutes + d.drafted_minutes > 0).length;
  const busiest = Math.max(0, ...week.map((d) => d.confirmed_minutes + d.drafted_minutes));
  return {
    stats: [
      { key: 'tracked', label: 'Tracked', value: tracked, sub: `${String(confirmed)} confirmed` },
      {
        key: 'review',
        label: 'To review',
        value: drafted,
        sub: drafted > 0 ? 'drafts waiting' : 'nothing waiting',
      },
      {
        key: 'per-day',
        label: 'Per active day',
        value: active === 0 ? 0 : Math.round(tracked / active),
        sub: `${String(active)} of ${String(week.length)} days`,
      },
    ],
    days: week.map((d) => ({
      day: d.day,
      confirmed: d.confirmed_minutes,
      drafted: d.drafted_minutes,
      height: busiest === 0 ? 0 : (d.confirmed_minutes + d.drafted_minutes) / busiest,
    })),
  };
}

export interface TaskRow {
  /** The card's key, or `No task yet` for the blocks on none. */
  readonly key: string;
  readonly title: string;
  readonly minutes: number;
  /** Of the busiest task, 0–1, for the bar. */
  readonly width: number;
}

/** The rows *By task* shows: the design's six (LAI-510). */
export const TASK_ROWS = 6;

/**
 * Minutes by card, largest first, as the owner's My Day design ranks them
 * (LAI-510): a block on a space alone under the space's name, time typed on
 * no task as *No task* (logged by kind), and drafted time nobody has put
 * anywhere yet as *No task yet* — ranked with the rest, the busiest six.
 */
export function byTask(
  entries: readonly TimeEntry[],
  drafts: readonly TimeDraft[],
): readonly TaskRow[] {
  const rows = new Map<string, { title: string; minutes: number }>();
  const add = (key: string, title: string, minutes: number): void => {
    const row = rows.get(key);
    if (row === undefined) rows.set(key, { title, minutes });
    else row.minutes += minutes;
  };
  for (const e of entries) {
    if (e.task !== null) add(e.task.key, e.task.title, e.minutes);
    else if (e.project !== null) add(e.project.name, 'General', e.minutes);
    else add('No task', 'logged by kind', e.minutes);
  }
  for (const d of drafts) {
    if (d.task !== null) add(d.task.key, d.task.title, d.minutes);
    else if (d.project !== null) add(d.project.name, 'General', d.minutes);
    else if (d.general) add('No task', 'logged by kind', d.minutes);
    else add('No task yet', '', d.minutes);
  }
  const list = [...rows.entries()].map(([key, r]) => ({ key, ...r }));
  const busiest = Math.max(0, ...list.map((r) => r.minutes));
  return list
    .sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key))
    .slice(0, TASK_ROWS)
    .map((r) => ({ ...r, width: busiest === 0 ? 0 : r.minutes / busiest }));
}
