import type { MyDayWeekDay } from '../../../api/time.ts';
import { addDays, dayLabel, weekCell, weekdayShort } from './my-day-derive.ts';

export interface WeekStripProps {
  readonly week: readonly MyDayWeekDay[];
  readonly selected: string;
  readonly today: string;
  readonly onPick: (day: string) => void;
}

/**
 * The week around the open day, Monday to Sunday (LAI-787): each day's own
 * time — confirmed, or confirmed and still drafted — and its state, with a
 * day nothing reached the board on said as **No signal** rather than drawn as
 * zero hours. Every cell is a button that opens that day.
 */
export function WeekStrip({ week, selected, today, onPick }: WeekStripProps) {
  const first = week[0]?.day ?? selected;
  return (
    <nav className="myday-week" aria-label="Week">
      <div className="myday-week-nav">
        <button
          type="button"
          className="myday-chip"
          onClick={() => {
            onPick(addDays(first, -7));
          }}
        >
          ← Previous week
        </button>
        {selected !== today && (
          <button
            type="button"
            className="myday-chip"
            onClick={() => {
              onPick(today);
            }}
          >
            Today
          </button>
        )}
        <button
          type="button"
          className="myday-chip"
          disabled={addDays(first, 7) > today}
          onClick={() => {
            onPick(addDays(first, 7));
          }}
        >
          Next week →
        </button>
      </div>
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
                disabled={cell.state === 'future'}
                onClick={() => {
                  onPick(cell.day);
                }}
              >
                <span className="myday-week-name">
                  {weekdayShort(cell.day)} {String(Number(cell.day.slice(8)))}
                </span>
                <span className="myday-week-figure">{figure}</span>
                <span className="myday-week-state">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
