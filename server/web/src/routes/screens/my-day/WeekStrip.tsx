import { Fragment } from 'react';
import type { MyDayWeekDay } from '../../../api/time.ts';
import { addDays, dayLabel, weekCell, weekdayShort } from './my-day-derive.ts';

export interface WeekStripProps {
  readonly week: readonly MyDayWeekDay[];
  readonly selected: string;
  readonly today: string;
  /** While a batch runs on this day (LAI-810), the day is not changed under it. */
  readonly locked?: boolean;
  readonly onPick: (day: string) => void;
}

/**
 * The week around the open day, Monday to Sunday (LAI-787): each day's own
 * time — confirmed, or confirmed and still drafted — and its state, with a
 * day nothing reached the board on said as **No signal** rather than drawn as
 * zero hours. Every cell is a button that opens that day.
 */
export function WeekStrip({ week, selected, today, locked = false, onPick }: WeekStripProps) {
  const first = week[0]?.day ?? selected;
  const previous = addDays(first, -7);
  const following = addDays(first, 7);
  return (
    <nav className="myday-week" aria-label="Week">
      {/* The owner's reference (LAI-796): the week between two arrows, and a
          way back to today from any other week. */}
      <button
        type="button"
        className="myday-week-step"
        aria-label="Previous week"
        disabled={locked}
        onClick={() => {
          onPick(previous);
        }}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <ol className="myday-week-days">
        {week.map((cell) => {
          const { label, figure } = weekCell(cell);
          const isSelected = cell.day === selected;
          return (
            <li key={cell.day}>
              <button
                type="button"
                className={[
                  'myday-week-day',
                  `myday-week-${cell.state}`,
                  isSelected ? 'myday-week-selected' : '',
                  cell.day === today ? 'myday-week-today' : '',
                ]
                  .filter((c) => c !== '')
                  .join(' ')}
                aria-pressed={isSelected}
                // The state is hidden on a phone's narrow cells; it is still
                // said, in full, to anyone who cannot see the cell's colour.
                aria-label={[dayLabel(cell.day), label, figure === '—' ? '' : figure]
                  .filter((part) => part !== '')
                  .join(', ')}
                disabled={cell.state === 'future' || (locked && !isSelected)}
                onClick={() => {
                  onPick(cell.day);
                }}
              >
                <span className="myday-week-name">
                  {weekdayShort(cell.day)} {String(Number(cell.day.slice(8)))}
                </span>
                <span className="myday-week-figure">
                  {figure === ''
                    ? '—'
                    : // One span per `2 h`, `50 min`: a narrow cell breaks between them.
                      figure.split(/(?<=[a-z]) (?=\d)/).map((pair, i) => (
                        <Fragment key={pair}>
                          {i > 0 && ' '}
                          <span>{pair}</span>
                        </Fragment>
                      ))}
                </span>
                <span className="myday-week-state">
                  {cell.day === today
                    ? `Today${label === '' ? '' : ` · ${label.toLowerCase()}`}`
                    : label === ''
                      ? 'Not yet'
                      : label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="myday-week-step"
        aria-label="Next week"
        disabled={following > today || locked}
        onClick={() => {
          onPick(following);
        }}
      >
        <span aria-hidden="true">›</span>
      </button>
      {selected !== today && (
        <button
          type="button"
          className="myday-chip myday-week-back"
          disabled={locked}
          onClick={() => {
            onPick(today);
          }}
        >
          Today
        </button>
      )}
    </nav>
  );
}
