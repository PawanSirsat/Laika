import type { ReactNode } from 'react';
import type { MyDay } from '../../../api/time.ts';
import { duration } from './format.ts';
import { addDays, dayLabel } from './my-day-derive.ts';
import { weekTiles } from './week-derive.ts';

export interface MyDayPhoneHeadProps {
  readonly view: MyDay;
  readonly readOnly: boolean;
  /** Whose day, when it is somebody else's. */
  readonly subjectName: string;
  /** While a batch runs on this day (LAI-810), the day is not changed under it. */
  readonly locked: boolean;
  readonly onDay: (day: string) => void;
  /** The timer, Add time and Day settings — on the person's own day only. */
  readonly tools?: ReactNode;
  /** Confirm, or the day note — on the person's own day only. */
  readonly action?: ReactNode;
}

/** What the line under the day says (the design's `phoneSub`). */
function dayWord(day: string, today: string, readOnly: boolean): string {
  if (day === today) return readOnly ? 'Read-only' : 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return day > today ? 'Upcoming' : 'Past';
}

/**
 * The week's dot (the design's `wk`): filled when settled, half while drafts
 * wait, an accent ring on a today with nothing yet, dashed with no signal, a
 * plain ring for a day not yet come.
 */
function dotOf(state: MyDay['week'][number]['state'], isToday: boolean): string {
  if (state === 'confirmed') return 'settled';
  if (state === 'drafted') return 'half';
  if (isToday) return 'today';
  return state === 'no_signal' ? 'quiet' : 'future';
}

/**
 * My day's head on a phone (the owner's `MyDay.dc.html`, `lay.phone`,
 * LAI-518): ‹ the day › with its word under it and the tools beside it; the
 * week as seven letters with a dot each; then the day's total and Confirm.
 * The desktop's header and week strip stand down at this width. Every figure
 * is the API's.
 */
export function MyDayPhoneHead({
  view,
  readOnly,
  subjectName,
  locked,
  onDay,
  tools,
  action,
}: MyDayPhoneHeadProps) {
  const confirmed = view.entries.reduce((n, e) => n + e.minutes, 0);
  const drafted = view.drafts.reduce((n, d) => n + d.minutes, 0);
  const firstName = subjectName.split(/\s+/)[0] ?? subjectName;
  const tiles = weekTiles(view.week, view.today);
  const label = dayLabel(view.day);
  const sub =
    view.state === 'future'
      ? 'not started'
      : drafted > 0
        ? `${duration(drafted)} to review`
        : confirmed > 0
          ? 'all confirmed'
          : 'nothing yet';

  return (
    <>
      <header className="myday-phone-head" data-phone-head>
        <h1 className="visually-hidden">{readOnly ? `${subjectName}’s day` : 'My day'}</h1>
        <div className="myday-phone-row" data-day-nav>
          <button
            type="button"
            className="myday-phone-step"
            aria-label="Previous day"
            disabled={locked}
            onClick={() => {
              onDay(addDays(view.day, -1));
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="myday-phone-day">
            <strong className="myday-phone-date" data-phone-date>
              {readOnly && `${firstName} · `}
              {/* The weekday goes first when the row is short of room (`phone.css`). */}
              <span className="myday-phone-dow">{label.slice(0, label.indexOf(' ') + 1)}</span>
              {label.slice(label.indexOf(' ') + 1)}
            </strong>
            <span className="myday-phone-word">{dayWord(view.day, view.today, readOnly)}</span>
          </span>
          <button
            type="button"
            className="myday-phone-step"
            aria-label="Next day"
            disabled={locked || view.day >= view.today}
            onClick={() => {
              onDay(addDays(view.day, 1));
            }}
          >
            <span aria-hidden="true">›</span>
          </button>
          {tools !== undefined && <span className="myday-phone-tools">{tools}</span>}
        </div>
        <ol className="myday-phone-week" data-phone-week aria-label="Week">
          {tiles.map((tile) => {
            const selected = tile.day === view.day;
            return (
              <li key={tile.day}>
                <button
                  type="button"
                  className={[
                    'myday-phone-weekday',
                    selected ? 'myday-phone-weekday-selected' : '',
                    tile.state === 'future' && !selected ? 'myday-phone-weekday-future' : '',
                  ]
                    .filter((c) => c !== '')
                    .join(' ')}
                  data-day={tile.day}
                  data-state={tile.state}
                  aria-pressed={selected}
                  aria-label={[
                    dayLabel(tile.day),
                    tile.isToday ? 'today' : '',
                    tile.figure === '—' || tile.figure === '' ? '' : tile.figure,
                    tile.label,
                  ]
                    .filter((part) => part !== '')
                    .join(', ')}
                  disabled={locked && !selected}
                  onClick={() => {
                    onDay(tile.day);
                  }}
                >
                  <span className="myday-phone-letter" aria-hidden="true">
                    {tile.name.slice(0, 1)}
                  </span>
                  <span
                    className={`myday-phone-dot myday-phone-dot-${dotOf(tile.state, tile.isToday)}`}
                    data-dot={dotOf(tile.state, tile.isToday)}
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </header>
      <div className="myday-phone-summary" data-phone-summary>
        <span className="myday-phone-total">
          <strong data-phone-total>
            {view.state === 'no_signal' && confirmed + drafted === 0
              ? '—'
              : duration(confirmed + drafted)}
          </strong>
          <span>{sub}</span>
        </span>
        {action}
      </div>
    </>
  );
}
