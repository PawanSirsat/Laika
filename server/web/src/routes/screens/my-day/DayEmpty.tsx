import { offKind, type OffDay } from '../../../api/off-days.ts';
import { hourName } from './format.ts';
import { offEmpty } from './off-words.ts';
import { weekdayOf } from './summary-derive.ts';
import { shortDay } from './week-derive.ts';
import './day-states.css';

/** `off`: a holiday or whole-day leave with nothing on it — never *no signal* (D-149, LAI-1184). */
export type EmptyKind = 'today' | 'past' | 'future' | 'draftOff' | 'off';

/** What a past day with nothing on it says: no signal is not zero hours (LAI-831). */
export const NO_SIGNAL =
  'No signal — nothing reached Laika from your machine. That is not zero hours: you can still add time you worked.';

export interface EmptyAction {
  readonly label: string;
  readonly primary?: boolean;
  readonly go: () => void;
}

/** The hours the empty Timeline draws, 7 AM to 9 PM — fifteen, each an hour wide. */
const FIRST_HOUR = 7;
const EMPTY_HOURS = Array.from({ length: 15 }, (_, i) => FIRST_HOUR + i);
const SPAN_MINUTES = EMPTY_HOURS.length * 60;

/** Where a minute of the day sits along the track, as a share of it; clamped. */
const along = (minute: number): number =>
  Math.min(1, Math.max(0, (minute - FIRST_HOUR * 60) / SPAN_MINUTES));
const pct = (share: number): string => `${String(Math.round(share * 10_000) / 100)}%`;

/**
 * The person's working hours on this day, when they set them (My
 * availability's working week): the stretch the track leaves unshaded.
 * `off` is a day that is not one of their working days.
 */
export type WorkHours =
  | { readonly kind: 'hours'; readonly start: number; readonly end: number; readonly label: string }
  | { readonly kind: 'off' };

/**
 * A Timeline with nothing on it (`bd.emptyTl`, reworked by LAI-1223): the
 * day's hours along a short track — shaded outside the person's working
 * hours **only when they set them, and then with a key that says so**, and a
 * now line on today — and under it, in the card's own flow rather than
 * floating over the grid, why it is empty and what to do — a day not begun, a
 * day nothing was recorded on, drafting off, today before anything reached the
 * board, or a day off (LAI-1184).
 */
export function DayEmpty({
  day,
  kind,
  actions,
  nowMinute,
  workHours,
  off = null,
  ahead = false,
}: {
  readonly day: string;
  readonly kind: EmptyKind;
  readonly actions: readonly EmptyAction[];
  /** Minutes after the day's midnight, on today only. */
  readonly nowMinute?: number | undefined;
  readonly workHours?: WorkHours | undefined;
  /** The day off, for `off`: its name is the card's. */
  readonly off?: OffDay | null;
  /** The day has not begun: a day off to come offers no time to add. */
  readonly ahead?: boolean;
}) {
  const weekday = weekdayOf(day);
  const free = kind === 'off' ? offEmpty(off, ahead) : undefined;
  const title =
    free !== undefined
      ? free.title
      : kind === 'future'
        ? `${weekday} hasn’t started`
        : kind === 'draftOff'
          ? 'Nothing drafted'
          : kind === 'today'
            ? 'Nothing yet today'
            : `Nothing recorded on ${weekday}`;
  const body =
    free !== undefined
      ? free.body
      : kind === 'future'
        ? 'Time appears here once the day begins. Nothing can be confirmed ahead of time.'
        : kind === 'draftOff'
          ? 'Draft my time is off, so Laika only shows time you add or record with a timer.'
          : kind === 'past'
            ? NO_SIGNAL
            : 'As you work, your collector drafts time from prompts, commits and agent sessions. Start the timer above, or add time yourself.';
  // The shaded stretches: before and after the working hours, or all of a day off.
  const shaded: { readonly from: number; readonly to: number }[] =
    workHours === undefined
      ? []
      : workHours.kind === 'off'
        ? [{ from: 0, to: 1 }]
        : [
            { from: 0, to: along(workHours.start) },
            { from: along(workHours.end), to: 1 },
          ].filter((band) => band.to - band.from > 0);
  const key =
    workHours === undefined
      ? undefined
      : workHours.kind === 'off'
        ? 'Not one of your working days'
        : `Outside your working hours (${workHours.label})`;
  const nowAt =
    nowMinute === undefined ||
    nowMinute < FIRST_HOUR * 60 ||
    nowMinute > FIRST_HOUR * 60 + SPAN_MINUTES
      ? undefined
      : along(nowMinute);
  return (
    <section
      className="myday-card dstate-empty"
      aria-label="Timeline"
      data-day-empty={kind}
      data-off={kind === 'off' ? (offKind(off) ?? undefined) : undefined}
    >
      <div className="dstate-empty-head">
        <span className="dstate-skel-title">Timeline</span>
        <span className="dstate-empty-date">{shortDay(day)}</span>
        {key !== undefined && shaded.length > 0 && (
          <span className="dstate-empty-key" data-off-hours-key>
            <span className="dstate-empty-swatch" aria-hidden="true" />
            {key}
          </span>
        )}
      </div>
      <div className="dstate-empty-track" aria-hidden="true">
        <div className="dstate-empty-axis">
          {EMPTY_HOURS.map((h) => (
            <span key={h} className="dstate-empty-hour">
              {hourName(h)}
            </span>
          ))}
        </div>
        <div className="dstate-empty-lane">
          {EMPTY_HOURS.map((h) => (
            <span key={h} className="dstate-empty-cell" />
          ))}
          {shaded.map((band) => (
            <span
              key={band.from}
              className="dstate-empty-off"
              data-off-hours
              style={{ left: pct(band.from), width: pct(band.to - band.from) }}
            />
          ))}
        </div>
        {nowAt !== undefined && (
          <span className="dstate-empty-now" data-now-line style={{ left: pct(nowAt) }}>
            <span className="dstate-empty-now-label">Now</span>
          </span>
        )}
      </div>
      <div className="dstate-empty-message">
        <h2 className="dstate-empty-title">{title}</h2>
        <p className="dstate-body" data-no-signal={kind === 'past' ? '' : undefined}>
          {body}
        </p>
        {actions.length > 0 && (
          <div className="dstate-actions">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={a.primary === true ? 'myday-chip myday-chip-primary' : 'myday-chip'}
                onClick={a.go}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
