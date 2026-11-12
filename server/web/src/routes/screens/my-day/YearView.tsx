import type { DaysDay } from '../../../api/time.ts';
import { duration, roundHours } from './format.ts';
import { monthBounds, monthName, yearOf } from './span.ts';
import { cellKind, heatScale, totalOf } from './span-derive.ts';
import { dayLong } from './week-derive.ts';

export interface YearViewProps {
  /** Every day of the year, from four `GET /me/time/days` reads. */
  readonly days: readonly DaysDay[];
  /** Any day of the year shown. */
  readonly day: string;
  readonly today: string;
  readonly onOpenMonth: (first: string) => void;
  readonly onOpenDay: (day: string) => void;
}

/**
 * My day → Year (LAI-1174): twelve months, each a small calendar whose days
 * are coloured by how much time each held **against the year's own working
 * days** — its busiest quarter darkest, whatever the hours. A day nothing
 * reached is drawn empty with *no signal* in its name, and a day still to
 * come is an outline.
 */
export function YearView({ days, day, today, onOpenMonth, onOpenDay }: YearViewProps) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const heat = heatScale(days.map(totalOf));
  const year = yearOf(day);
  const months = Array.from(
    { length: 12 },
    (_, m) => `${String(year)}-${String(m + 1).padStart(2, '0')}-01`,
  );

  return (
    <div className="span-year" data-span-year>
      {months.map((first) => {
        const { last } = monthBounds(first);
        const inMonth = days.filter((d) => d.day >= first && d.day <= last);
        const total = inMonth.reduce((n, d) => n + totalOf(d), 0);
        const future = first > today;
        const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
        const count = Number(last.slice(8));
        return (
          <div
            key={first}
            className="span-year-month"
            data-zk={`m:${first.slice(0, 7)}`}
            data-current={today.slice(0, 7) === first.slice(0, 7) ? '' : undefined}
          >
            <button
              type="button"
              className="span-year-title"
              aria-label={`Open ${monthName(first)} ${String(year)}${total > 0 ? `, ${duration(total)}` : ''}`}
              onClick={() => {
                onOpenMonth(first);
              }}
            >
              <span>{monthName(first)}</span>
              <span className="span-year-total">
                {future ? '' : total > 0 ? roundHours(total) : '—'}
              </span>
            </button>
            <div className="span-year-grid">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`lead-${String(i)}`} className="span-year-pad" aria-hidden="true" />
              ))}
              {Array.from({ length: count }, (_, i) => {
                const d = `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
                const row = byDay.get(d);
                const kind = row === undefined ? 'future' : cellKind(row);
                const minutes = row === undefined ? 0 : totalOf(row);
                return (
                  <button
                    key={d}
                    type="button"
                    tabIndex={-1}
                    className="span-year-day"
                    data-zk={`d:${d}`}
                    data-kind={kind}
                    data-heat={kind === 'time' ? heat(minutes) : 0}
                    data-today={d === today ? '' : undefined}
                    title={`${dayLong(d)} · ${kind === 'time' ? duration(minutes) : kind === 'no_signal' ? 'no signal' : 'not yet'}`}
                    onClick={() => {
                      onOpenDay(d);
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
