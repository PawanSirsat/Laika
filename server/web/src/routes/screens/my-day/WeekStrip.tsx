import type { MyDayWeekDay } from '../../../api/time.ts';
import { duration } from './format.ts';
import { addDays, dayLabel } from './my-day-derive.ts';
import { weekTiles, weekTotal } from './week-derive.ts';

export interface WeekStripProps {
  readonly week: readonly MyDayWeekDay[];
  readonly selected: string;
  readonly today: string;
  /** While a batch runs on this day (LAI-810), the day is not changed under it. */
  readonly locked?: boolean;
  readonly onPick: (day: string) => void;
}

const pct = (share: number): string => `${String(Math.round(share * 1000) / 10)}%`;

/**
 * The week around the open day, Monday to Sunday (LAI-787; the owner's
 * "Laika App v2" design, LAI-831): seven tiles, each its day's total, a bar in
 * two parts — **confirmed solid, drafted striped** — and where it stands:
 * *Not yet*, *No signal* (hatched, never zero hours), *… to settle* or
 * *Settled*. A red dot marks today. Every tile opens its day.
 *
 * The weeks either side are one arrow away, with the week's total beside them
 * (CHIEF's addition E) — **never a target or a score**: the bars are the
 * week's own busiest day, and per-person hours are not scored.
 */
export function WeekStrip({ week, selected, today, locked = false, onPick }: WeekStripProps) {
  const first = week[0]?.day ?? selected;
  const previous = addDays(first, -7);
  const following = addDays(first, 7);
  const tiles = weekTiles(week, today);
  const total = weekTotal(week);
  const thisWeek = week.some((d) => d.day === today);

  return (
    <nav className="myday-week" aria-label="Week">
      <div className="myday-week-bar">
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
        <span className="myday-week-total" data-week-total>
          <span className="myday-week-total-label">Week</span>{' '}
          <span className="myday-week-total-figure">{duration(total.total)}</span>
          {total.drafted > 0 && (
            <span className="myday-week-total-split">
              {' '}
              · {duration(total.confirmed)} confirmed · {duration(total.drafted)} to settle
            </span>
          )}
        </span>
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
        {(!thisWeek || selected !== today) && (
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
      </div>
      <ol className="myday-week-days">
        {tiles.map((tile) => {
          const isSelected = tile.day === selected;
          return (
            <li key={tile.day}>
              <button
                type="button"
                className={[
                  'myday-week-day',
                  `myday-week-${tile.state}`,
                  isSelected ? 'myday-week-selected' : '',
                ]
                  .filter((c) => c !== '')
                  .join(' ')}
                data-day={tile.day}
                data-state={tile.state}
                aria-pressed={isSelected}
                aria-label={[
                  dayLabel(tile.day),
                  tile.isToday ? 'today' : '',
                  tile.figure === '—' || tile.figure === '' ? '' : tile.figure,
                  tile.label,
                ]
                  .filter((part) => part !== '')
                  .join(', ')}
                disabled={locked && !isSelected}
                onClick={() => {
                  onPick(tile.day);
                }}
              >
                <span className="myday-week-name">
                  <span className="myday-week-weekday">{tile.name}</span>{' '}
                  <span className="myday-week-date">{tile.date}</span>
                  {tile.isToday && (
                    <span
                      className="myday-week-dot"
                      data-today-dot
                      title="Today"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="myday-week-figure">{tile.figure}</span>
                <span className="myday-week-meter" aria-hidden="true">
                  <span
                    className="myday-week-meter-confirmed"
                    data-bar-confirmed
                    style={{ width: pct(tile.confirmedShare) }}
                  />
                  <span
                    className="myday-week-meter-drafted"
                    data-bar-drafted
                    style={{ width: pct(tile.draftedShare) }}
                  />
                </span>
                <span className="myday-week-state">{tile.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
