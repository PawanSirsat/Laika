import type { DayState, MyDayWeekDay } from '../../../api/time.ts';
import { duration } from './format.ts';
import { weekdayShort } from './my-day-derive.ts';

/**
 * The week strip (LAI-831, the owner's design): each day's name and date, its
 * total, a bar in two parts — confirmed solid, drafted striped — and a word
 * for where it stands: *Not yet*, *No signal*, *… to settle* or *Settled*.
 *
 * **No target, no score** (CHIEF's addition E; Organisation → Time: a
 * person's hours are not scored). The bars are shares of the shown week's own
 * busiest day — never of a working day's length, which would read as a goal.
 * A day nothing reached the board on is *No signal* and `—`, never zero hours.
 */

export interface WeekTile {
  readonly day: string;
  readonly name: string;
  readonly date: string;
  readonly isToday: boolean;
  readonly state: DayState;
  /** Confirmed and drafted together; `—` for no signal, nothing for a day to come. */
  readonly figure: string;
  readonly label: string;
  /** Shares of the week's busiest day, 0 to 1. */
  readonly confirmedShare: number;
  readonly draftedShare: number;
}

const LABELS: Readonly<Record<Exclude<DayState, 'drafted'>, string>> = {
  confirmed: 'Settled',
  no_signal: 'No signal',
  future: 'Not yet',
};

export function weekTiles(week: readonly MyDayWeekDay[], today: string): WeekTile[] {
  const busiest = Math.max(0, ...week.map((d) => d.confirmed_minutes + d.drafted_minutes));
  const share = (minutes: number): number => (busiest === 0 ? 0 : minutes / busiest);
  return week.map((d) => ({
    day: d.day,
    name: weekdayShort(d.day),
    date: String(Number(d.day.slice(8))),
    isToday: d.day === today,
    state: d.state,
    figure:
      d.state === 'future'
        ? ''
        : d.state === 'no_signal'
          ? '—'
          : duration(d.confirmed_minutes + d.drafted_minutes),
    label: d.state === 'drafted' ? `${duration(d.drafted_minutes)} to settle` : LABELS[d.state],
    confirmedShare: share(d.confirmed_minutes),
    draftedShare: share(d.drafted_minutes),
  }));
}

/** The week's minutes: confirmed, still drafted, and the two together. */
export function weekTotal(week: readonly MyDayWeekDay[]): {
  readonly confirmed: number;
  readonly drafted: number;
  readonly total: number;
} {
  const confirmed = week.reduce((n, d) => n + d.confirmed_minutes, 0);
  const drafted = week.reduce((n, d) => n + d.drafted_minutes, 0);
  return { confirmed, drafted, total: confirmed + drafted };
}

/** `Tuesday 20 October` — the day as the page's heading says it. */
export function dayLong(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** `Thu 22 Oct` — the day as the Timeline card's head says it (LAI-513). */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
