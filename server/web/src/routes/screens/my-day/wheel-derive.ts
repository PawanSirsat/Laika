/**
 * The time wheel's arithmetic (the owner's ask, 2026-10-25: a picker *like
 * we use in Apple phones*): a time of day as hour, minute and AM / PM, and a
 * length as hours and minutes, each on the five-minute grid the Timeline
 * moves on. Pure: minutes after midnight in, column indexes out, and back.
 */

/** The wheel's minutes step, the Timeline's grid. */
export const WHEEL_STEP = 5;

/** The hour column, 1 to 12, as an iPhone's runs. */
export const WHEEL_HOURS: readonly string[] = Array.from({ length: 12 }, (_, i) => String(i + 1));

/** The minute column on the grid: `00`, `05` … `55`. */
export const WHEEL_MINUTES: readonly string[] = Array.from({ length: 60 / WHEEL_STEP }, (_, i) =>
  String(i * WHEEL_STEP).padStart(2, '0'),
);

export const WHEEL_PERIODS: readonly string[] = ['AM', 'PM'];

/** A length's hours column, 0 to 23. */
export const WHEEL_LENGTH_HOURS: readonly string[] = Array.from({ length: 24 }, (_, i) =>
  String(i),
);

export interface ClockIndexes {
  readonly hour: number;
  readonly minute: number;
  readonly period: number;
}

/** Minutes after midnight on the grid, wrapped into the day. */
const onGrid = (minutes: number): number =>
  (((Math.round(minutes / WHEEL_STEP) * WHEEL_STEP) % 1440) + 1440) % 1440;

/** Where each column stands for `minutes` after midnight (rounded to the grid). */
export function clockIndexes(minutes: number): ClockIndexes {
  const m = onGrid(minutes);
  const h24 = Math.floor(m / 60);
  return {
    hour: (h24 + 11) % 12,
    minute: (m % 60) / WHEEL_STEP,
    period: h24 >= 12 ? 1 : 0,
  };
}

/** The minutes after midnight the columns name. */
export function clockFrom(at: ClockIndexes): number {
  const h12 = at.hour + 1;
  const h24 = (h12 % 12) + (at.period === 1 ? 12 : 0);
  return h24 * 60 + at.minute * WHEEL_STEP;
}

/** `1:30 PM` — what the wheel writes into the field, read back by `clockMinute`. */
export function clockText(minutes: number): string {
  const at = clockIndexes(minutes);
  return `${WHEEL_HOURS[at.hour] ?? ''}:${WHEEL_MINUTES[at.minute] ?? ''} ${WHEEL_PERIODS[at.period] ?? ''}`;
}

export interface LengthIndexes {
  readonly hours: number;
  readonly minutes: number;
}

/** Where the length columns stand: hours, and minutes on the grid; a day at most. */
export function lengthIndexes(minutes: number): LengthIndexes {
  const m = Math.max(0, Math.min(23 * 60 + 55, Math.round(minutes / WHEEL_STEP) * WHEEL_STEP));
  return { hours: Math.floor(m / 60), minutes: (m % 60) / WHEEL_STEP };
}

/** The length the columns name — never under one step, a block is never empty. */
export function lengthFrom(at: LengthIndexes): number {
  return Math.max(WHEEL_STEP, at.hours * 60 + at.minutes * WHEEL_STEP);
}
