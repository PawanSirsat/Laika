import type { MyDayWeekDay } from '../../../api/time.ts';
import { addDays, dayLabel } from './my-day-derive.ts';
import { weekTiles } from './week-derive.ts';

export interface WeekStripProps {
  readonly week: readonly MyDayWeekDay[];
  readonly selected: string;
  readonly today: string;
  /** While a batch runs on this day (LAI-810), the day is not changed under it. */
  readonly locked?: boolean;
  readonly onPick: (day: string) => void;
}

/** A bar's share of an eight-hour day, as the design draws it; never past the tile. */
const EIGHT_HOURS = 480;
const pct = (minutes: number): string =>
  `${String(Math.min(100, Math.round((minutes / EIGHT_HOURS) * 1000) / 10))}%`;

/**
 * The week around the open day, Monday to Sunday (LAI-787; the owner's
 * `MyDay.dc.html`, LAI-509): ‹ Today › in one group, then seven low tiles,
 * each its weekday, date and figure on one line and a 4px bar — **confirmed
 * solid, drafted striped** — of an eight-hour day. The open day wears the
 * accent; a day with no signal shows — on a hatched track, never zero hours;
 * a day not yet happened is faded. Every tile opens its day. **Never a target
 * or a score**: per-person hours are not scored.
 */
export function WeekStrip({ week, selected, today, locked = false, onPick }: WeekStripProps) {
  const first = week[0]?.day ?? selected;
  const previous = addDays(first, -7);
  const following = addDays(first, 7);
  const tiles = weekTiles(week, today);
  const minutesOf = (day: string): { confirmed: number; drafted: number } => {
    const d = week.find((w) => w.day === day);
    return { confirmed: d?.confirmed_minutes ?? 0, drafted: d?.drafted_minutes ?? 0 };
  };

  return (
    <nav className="myday-week" aria-label="Week">
      <div className="myday-week-nav">
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
        <button
          type="button"
          className="myday-week-step myday-week-today"
          disabled={locked}
          onClick={() => {
            onPick(today);
          }}
        >
          Today
        </button>
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
      </div>
      <ol className="myday-week-days">
        {tiles.map((tile) => {
          const isSelected = tile.day === selected;
          const m = minutesOf(tile.day);
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
                {...(tile.isToday ? { 'data-today': '' } : {})}
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
                <span className="myday-week-line">
                  {/* A phone shows one letter a day (LAI-502); the width decides, in CSS. */}
                  <span className="myday-week-letter" aria-hidden="true">
                    {tile.name.slice(0, 1)}
                  </span>
                  <span className="myday-week-weekday">{tile.name}</span>
                  <span className="myday-week-date">{tile.date}</span>
                  <span className="myday-week-figure">{tile.figure}</span>
                </span>
                <span className="myday-week-track" aria-hidden="true">
                  {m.confirmed > 0 && (
                    <span
                      className="myday-week-fill myday-week-fill-confirmed"
                      data-bar-confirmed
                      style={{ width: pct(m.confirmed) }}
                    />
                  )}
                  {m.drafted > 0 && (
                    <span
                      className="myday-week-fill myday-week-fill-drafted"
                      data-bar-drafted
                      style={{ width: pct(m.drafted) }}
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
