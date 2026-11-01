import { hourName } from './format.ts';
import { weekdayOf } from './summary-derive.ts';
import { shortDay } from './week-derive.ts';
import './day-states.css';

export type EmptyKind = 'today' | 'past' | 'future' | 'draftOff';

/** What a past day with nothing on it says: no signal is not zero hours (LAI-831). */
export const NO_SIGNAL =
  'No signal — nothing reached Laika from your machine. That is not zero hours: you can still add time you worked.';

export interface EmptyAction {
  readonly label: string;
  readonly primary?: boolean;
  readonly go: () => void;
}

/** The hours the empty Timeline draws, 7 AM to 9 PM, each with its sky. */
const EMPTY_HOURS = Array.from({ length: 15 }, (_, i) => 7 + i);

/**
 * A Timeline with nothing on it (`bd.emptyTl`): the day's hours along the
 * top with the sky behind them and a card in the middle saying why it is
 * empty and what to do — a day not begun, a day nothing was recorded on,
 * drafting off, or today before anything reached the board.
 */
export function DayEmpty({
  day,
  kind,
  actions,
}: {
  readonly day: string;
  readonly kind: EmptyKind;
  readonly actions: readonly EmptyAction[];
}) {
  const weekday = weekdayOf(day);
  const title =
    kind === 'future'
      ? `${weekday} hasn’t started`
      : kind === 'draftOff'
        ? 'Nothing drafted'
        : kind === 'today'
          ? 'Nothing yet today'
          : `Nothing recorded on ${weekday}`;
  const body =
    kind === 'future'
      ? 'Time appears here once the day begins. Nothing can be confirmed ahead of time.'
      : kind === 'draftOff'
        ? 'Draft my time is off, so Laika only shows time you add or record with a timer.'
        : kind === 'past'
          ? NO_SIGNAL
          : 'As you work, your collector drafts time from prompts, commits and agent sessions. You can also start a timer or add time yourself.';
  return (
    <section className="myday-card dstate-empty" aria-label="Timeline" data-day-empty={kind}>
      <div className="dstate-empty-head">
        <span className="dstate-skel-title">Timeline</span>
        <span className="dstate-empty-date">{shortDay(day)}</span>
      </div>
      <div className="dstate-empty-track">
        <div className="dstate-empty-axis" aria-hidden="true">
          {EMPTY_HOURS.map((h) => (
            <span key={h} className="dstate-empty-hour" data-sky={h < 18 ? 'day' : 'night'}>
              {hourName(h)}
            </span>
          ))}
        </div>
        <div className="dstate-empty-body" aria-hidden="true">
          {EMPTY_HOURS.map((h) => (
            <span key={h} className="dstate-empty-cell" data-sky={h < 18 ? 'day' : 'night'} />
          ))}
        </div>
        <div className="dstate-empty-centre">
          <div className="dstate-empty-card">
            <h2 className="dstate-empty-title">{title}</h2>
            <p className="dstate-body" data-no-signal={kind === 'past' ? '' : undefined}>
              {body}
            </p>
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
          </div>
        </div>
      </div>
    </section>
  );
}
