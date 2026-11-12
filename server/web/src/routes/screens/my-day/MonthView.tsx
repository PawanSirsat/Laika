import type { DaysDay } from '../../../api/time.ts';
import { compact, duration } from './format.ts';
import { isoWeek, monthKey, monthWeeks } from './span.ts';
import { barOf, busiest, cellKind, pct, totalOf } from './span-derive.ts';
import { dayLong } from './week-derive.ts';

export interface MonthViewProps {
  /** Every day the month's rows show, spill-over included, from `GET /me/time/days`. */
  readonly days: readonly DaysDay[];
  /** Any day of the month shown. */
  readonly day: string;
  readonly today: string;
  readonly onOpenDay: (day: string) => void;
  /** A week number opens that week. */
  readonly onOpenWeek: (monday: string) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * My day → Month (LAI-1174): the month in Monday-first weeks, a week number
 * that opens the week, and a cell per day — its total, its two largest
 * tasks, and a bar that is a share of the month's busiest day. A day nothing
 * reached says `—`; days outside the month are drawn faint.
 */
export function MonthView({ days, day, today, onOpenDay, onOpenWeek }: MonthViewProps) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const month = monthKey(day);
  const top = busiest(days.filter((d) => monthKey(d.day) === month));
  const weeks = monthWeeks(day);

  return (
    <div className="span-month" data-span-month>
      <div className="span-month-head" aria-hidden="true">
        <span />
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      {weeks.map((week) => {
        const monday = week[0] ?? day;
        return (
          <div key={monday} className="span-month-row" data-zk={`w:${monday}`}>
            <button
              type="button"
              className="span-month-week"
              aria-label={`Open week ${String(isoWeek(monday))}`}
              onClick={() => {
                onOpenWeek(monday);
              }}
            >
              W{isoWeek(monday)}
            </button>
            {week.map((d) => {
              const row = byDay.get(d);
              return (
                <MonthCell
                  key={d}
                  day={d}
                  row={row}
                  inMonth={monthKey(d) === month}
                  today={today}
                  top={top}
                  onOpen={onOpenDay}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MonthCell({
  day,
  row,
  inMonth,
  today,
  top,
  onOpen,
}: {
  readonly day: string;
  readonly row: DaysDay | undefined;
  readonly inMonth: boolean;
  readonly today: string;
  readonly top: number;
  readonly onOpen: (day: string) => void;
}) {
  const kind = row === undefined ? 'future' : cellKind(row);
  const all = row === undefined ? 0 : totalOf(row);
  const bar = row === undefined ? { confirmed: 0, drafted: 0 } : barOf(row, top);
  const said = kind === 'future' ? '' : kind === 'no_signal' ? 'no signal' : duration(all);
  return (
    <button
      type="button"
      className="span-month-cell"
      data-zk={`d:${day}`}
      data-kind={kind}
      data-out={inMonth ? undefined : ''}
      data-today={day === today ? '' : undefined}
      aria-label={`${dayLong(day)}${said === '' ? '' : `, ${said}`}`}
      onClick={() => {
        onOpen(day);
      }}
    >
      <span className="span-month-top">
        <span className="span-month-date">{Number(day.slice(8))}</span>
        <span className="span-month-total">
          {kind === 'time' ? compact(all) : kind === 'no_signal' ? '—' : ''}
        </span>
      </span>
      {row?.top_tasks.slice(0, 2).map((t, i) => (
        <span
          key={t.task?.id ?? `${t.untied ? 'untied' : 'none'}-${String(i)}`}
          className="span-month-chip"
          data-untied={t.untied ? '' : undefined}
          data-drafted={t.drafted_minutes > 0 ? '' : undefined}
        >
          <span className="span-month-chip-key">
            {t.task?.key ?? (t.untied ? 'No task yet' : 'No task')}
          </span>
          <span className="span-month-chip-len">
            {compact(t.confirmed_minutes + t.drafted_minutes)}
          </span>
        </span>
      ))}
      <span className="span-bar" aria-hidden="true">
        <span className="span-bar-c" style={{ width: pct(bar.confirmed) }} />
        <span className="span-bar-d" style={{ width: pct(bar.drafted) }} />
      </span>
    </button>
  );
}
