import { memo, useMemo } from 'react';
import type { DaysDay } from '../../../api/time.ts';
import { duration, roundHours } from './format.ts';
import { monthBounds, monthName, yearOf } from './span.ts';
import { cellKind, heatScale, totalOf } from './span-derive.ts';
import { dayLong } from './week-derive.ts';

export interface YearViewProps {
  /**
   * Every day of the year, from four `GET /me/time/days` reads — or nothing
   * yet (LAI-1179): the twelve months are then drawn at their shape, every
   * day numbered and unheated, each month's total a shimmer.
   */
  readonly days: readonly DaysDay[] | undefined;
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
 *
 * The twelve months are built once per year and data set: 365 buttons each
 * naming their day is the costliest thing on the stage, and a zoom must not
 * pay for it twice (LAI-1179).
 */
export const YearView = memo(function YearView({
  days,
  day,
  today,
  onOpenMonth,
  onOpenDay,
}: YearViewProps) {
  const year = yearOf(day);
  const pending = days === undefined;
  const months = useMemo(() => {
    const byDay = new Map((days ?? []).map((d) => [d.day, d]));
    const heat = heatScale((days ?? []).map(totalOf));
    return Array.from({ length: 12 }, (_, m) => {
      const first = `${String(year)}-${String(m + 1).padStart(2, '0')}-01`;
      const { last } = monthBounds(first);
      const inMonth = (days ?? []).filter((d) => d.day >= first && d.day <= last);
      const total = inMonth.reduce((n, d) => n + totalOf(d), 0);
      const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
      const count = Number(last.slice(8));
      const cells = Array.from({ length: count }, (_, i) => {
        const d = `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
        const row = byDay.get(d);
        const kind = pending ? 'pending' : row === undefined ? 'future' : cellKind(row);
        const minutes = row === undefined ? 0 : totalOf(row);
        return {
          d,
          kind,
          heat: kind === 'time' ? heat(minutes) : 0,
          title: `${dayLong(d)} · ${kind === 'time' ? duration(minutes) : kind === 'no_signal' ? 'no signal' : kind === 'pending' ? 'loading' : 'not yet'}`,
        };
      });
      return { first, total, lead, cells };
    });
  }, [days, year, pending]);

  return (
    <div className="span-year" data-span-year data-pending={pending ? '' : undefined}>
      {months.map(({ first, total, lead, cells }) => {
        const future = first > today;
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
              {pending ? (
                <span className="span-year-total span-pending-bone" aria-hidden="true" />
              ) : (
                <span className="span-year-total">
                  {future ? '' : total > 0 ? roundHours(total) : '—'}
                </span>
              )}
            </button>
            <div className="span-year-grid">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`lead-${String(i)}`} className="span-year-pad" aria-hidden="true" />
              ))}
              {cells.map((c, i) => (
                <button
                  key={c.d}
                  type="button"
                  tabIndex={-1}
                  className="span-year-day"
                  data-zk={`d:${c.d}`}
                  data-kind={c.kind}
                  data-heat={c.heat}
                  data-today={c.d === today ? '' : undefined}
                  title={c.title}
                  onClick={() => {
                    onOpenDay(c.d);
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});
