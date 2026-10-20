import type {
  DayState,
  MyDay,
  TimeDraft,
  TimeEntry,
  TimeMode,
  TimeSettings,
  TimeSignals,
} from '../../../api/time.ts';

/**
 * Everything My day works out before it draws (LAI-787, D-088): days in the
 * person's own zone, the week strip, the words for a block's evidence, and the
 * two units the page uses — **h:mm for the person's own time, and minutes for
 * an agent's, never hours** (D-088 item 8).
 *
 * Pure: no clock is read here unless one is passed in, so every answer is the
 * same on a slow machine and a fast one.
 */

const DAY_MS = 86_400_000;

export const isDay = (text: string | null | undefined): text is string =>
  typeof text === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(text) &&
  !Number.isNaN(Date.parse(`${text}T00:00:00Z`));

interface Wall {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
}

function wallOf(tz: string, ms: number): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The calendar day `ms` falls on in `tz`. */
export function dayIn(tz: string, ms: number): string {
  const w = wallOf(tz, ms);
  return `${String(w.y)}-${pad(w.m)}-${pad(w.d)}`;
}

/** `09:40` in `tz`. */
export function clockIn(tz: string, ms: number): string {
  const w = wallOf(tz, ms);
  return `${pad(w.h)}:${pad(w.mi)}`;
}

/** `2026-10-20` + 3 → `2026-10-23`, on the calendar, whatever the zone. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday to Sunday of the week holding `day`. */
export function weekDays(day: string): string[] {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const monday = addDays(day, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** `Tue 20 Oct`. */
export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** `Tue`. */
export function weekdayShort(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
  });
}

/**
 * The instant a wall-clock time on `day` names in `tz` — for *split at 10:15*.
 * The later one when a clock change folds the hour; `undefined` for a time
 * that is not `HH:MM`.
 */
export function atClock(day: string, clock: string, tz: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (match === null || !isDay(day)) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hours, minutes);
  const offsetAt = (at: number): number => {
    const w = wallOf(tz, at);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(at / 60_000) * 60_000;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** The person's own time: `2:05`, `0:45`. */
export function hm(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(whole / 60))}:${pad(whole % 60)}`;
}

/**
 * An agent's time: `142 min` — **always minutes, never hours** (D-088 item 8).
 * Agent time is not a person's time, and an hour figure beside the person's
 * own would read as one: 600 minutes stays `600 min`.
 */
export function agentMinutes(minutes: number): string {
  return `${String(Math.max(0, Math.round(minutes)))} min`;
}

/**
 * How long, as a person types it: `90`, `1:30`, `1h30`, `1h`, `45m`, `1.5h`.
 * `undefined` for anything else or for nothing at all; 1 to 1440 minutes.
 */
export function parseMinutes(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  let minutes: number | undefined;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,4})m?(?:in)?$/.exec(t)) !== null) minutes = Number(m[1]);
  else if ((m = /^(\d{1,2}):(\d{2})$/.exec(t)) !== null) {
    if (Number(m[2]) < 60) minutes = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = /^(\d{1,2})h(?:(\d{1,2})m?)?$/.exec(t)) !== null) {
    const extra = Number(m[2] ?? '0');
    if (extra < 60) minutes = Number(m[1]) * 60 + extra;
  } else if ((m = /^(\d{1,2}(?:\.\d{1,2})?)h$/.exec(t)) !== null) {
    minutes = Math.round(Number(m[1]) * 60);
  }
  return minutes !== undefined && minutes >= 1 && minutes <= 1440 ? minutes : undefined;
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * A block's evidence in one line — `12 prompts · 34 replies · 2 sessions ·
 * 1 commit · 1 task claimed`. Counts only, zeros left out, and said plainly
 * when there are none.
 */
export function evidenceLine(signals: TimeSignals, source: TimeDraft['source']): string {
  const parts = [
    signals.prompts > 0 ? plural(signals.prompts, 'prompt', 'prompts') : '',
    signals.replies > 0 ? plural(signals.replies, 'reply', 'replies') : '',
    signals.sessions > 0 ? plural(signals.sessions, 'session', 'sessions') : '',
    signals.commits > 0 ? plural(signals.commits, 'commit', 'commits') : '',
    signals.marks > 0 ? plural(signals.marks, 'task claimed', 'tasks claimed') : '',
  ].filter((p) => p !== '');
  if (parts.length > 0) return parts.join(' · ');
  return source === 'agent' ? 'Proposed by one of your agents' : 'No signals counted';
}

/** `09:40–11:05` in the block's own zone, or `''` when it has no times. */
export function rangeLabel(item: Pick<TimeDraft | TimeEntry, 'started_at' | 'ended_at' | 'tz'>) {
  if (item.started_at === null || item.ended_at === null) return '';
  return `${clockIn(item.tz, item.started_at)}–${clockIn(item.tz, item.ended_at)}`;
}

/** What a draft is on, in words, and whether it still needs a card or General. */
export function draftTarget(draft: TimeDraft): {
  readonly label: string;
  readonly untied: boolean;
} {
  if (draft.task !== null) return { label: `${draft.task.key} ${draft.task.title}`, untied: false };
  if (draft.project !== null) return { label: draft.project.name, untied: false };
  if (draft.general) return { label: 'General', untied: false };
  const unknown = draft.task_key === null ? '' : ` (${draft.task_key} is not a card you can see)`;
  return { label: `No task — pick a card or General${unknown}`, untied: true };
}

/**
 * Whether the person changes this entry here (LAI-788 review round 1): not
 * one that came from Solidtime, which is the record for it — it is changed
 * there, and the next `laika time pull` brings the change here.
 */
export function canChange(entry: Pick<TimeEntry, 'source'>): boolean {
  return entry.source !== 'import';
}

/** What an entry is on, in words. */
export function entryTarget(entry: TimeEntry): string {
  if (entry.task !== null) return `${entry.task.key} ${entry.task.title}`;
  if (entry.project !== null) return entry.project.name;
  return 'General';
}

export const STATE_LABELS: Readonly<Record<DayState, string>> = {
  confirmed: 'Confirmed',
  drafted: 'Drafted',
  no_signal: 'No signal',
  future: '',
};

/** What the organisation's *Time* setting means, in one line. */
export const MODE_NOTES: Readonly<Record<TimeMode, string>> = {
  off: 'Time is off for this organisation: nothing can be added or drafted.',
  manual: 'People add their own time by hand. Nothing is drafted.',
  drafts:
    'Each person may also choose to have their day drafted on their own machine. Only what they confirm is ever seen by anyone else.',
};

export const MODE_LABELS: Readonly<Record<TimeMode, string>> = {
  off: 'Off',
  manual: 'Manual',
  drafts: 'Drafts',
};

/** Time may be added by hand unless the organisation turned Time off. */
export function canAddTime(settings: TimeSettings): boolean {
  return settings.org_mode !== 'off';
}

/** The day's own figures: confirmed and still drafted, in minutes. */
export function dayTotals(view: Pick<MyDay, 'drafts' | 'entries'>): {
  readonly confirmed: number;
  readonly drafted: number;
} {
  return {
    confirmed: view.entries.reduce((sum, e) => sum + e.minutes, 0),
    drafted: view.drafts.reduce((sum, d) => sum + d.minutes, 0),
  };
}

/** One day of the strip, as it is drawn: its label and what it holds. */
export function weekCell(cell: MyDay['week'][number]): {
  readonly label: string;
  readonly figure: string;
} {
  switch (cell.state) {
    case 'confirmed':
      return { label: STATE_LABELS.confirmed, figure: hm(cell.confirmed_minutes) };
    case 'drafted':
      return {
        label: STATE_LABELS.drafted,
        figure: `${hm(cell.confirmed_minutes + cell.drafted_minutes)}`,
      };
    case 'no_signal':
      // Not zero hours: nothing reached the board, which is a different fact.
      return { label: STATE_LABELS.no_signal, figure: '—' };
    case 'future':
      return { label: '', figure: '' };
  }
}
