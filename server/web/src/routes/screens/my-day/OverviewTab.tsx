import { useState } from 'react';
import type { MyDay } from '../../../api/time.ts';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { kindGlyph } from './entry-kinds.ts';
import { duration } from './format.ts';
import { weekdayShort } from './my-day-derive.ts';
import { byTask, dayStats, weekStats, type Stat } from './overview-derive.ts';
import { daySplit } from './summary-derive.ts';
import { dayLong } from './week-derive.ts';

export type OverviewScope = 'day' | 'week' | 'range';

export interface OverviewTabProps {
  readonly view: MyDay;
}

function Stats({ stats }: { readonly stats: readonly Stat[] }) {
  return (
    <ul className="myday-ov-stats" aria-label="Figures">
      {stats.map((s) => (
        <li key={s.key} className="myday-ov-stat" data-ov-stat={s.key}>
          <span className="myday-ov-stat-label">{s.label}</span>
          <span className="myday-ov-stat-value">{duration(s.value)}</span>
          <span className="myday-quiet">
            {s.sub.replace(
              /^(\d+) confirmed$/,
              (_, m: string) => `${duration(Number(m))} confirmed`,
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** `Mon 19` — a day of the week's strip, as the selects name it. */
const shortOf = (day: string): string => `${weekdayShort(day)} ${String(Number(day.slice(8)))}`;

/**
 * *Overview* (the owner's design, D-110 item 4, LAI-505; LAI-514): the day,
 * the week around it, or a range of its days — Tracked, To review, Meetings
 * and Off-screen for the day, Per active day over several — then where the
 * time went: by kind and by task for the day, by day over several. The week
 * knows minutes and not kinds (the strip's figures), and says so rather than
 * fetching seven days.
 */
export function OverviewTab({ view }: OverviewTabProps) {
  const [scope, setScope] = useState<OverviewScope>('day');
  const days = view.week.map((d) => d.day);
  const first = days[0] ?? view.day;
  const last = days.at(-1) ?? view.day;
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(view.day);
  const dayOptions = days.map((d) => ({ value: d, label: shortOf(d) }));
  const kinds = daySplit(view.entries, view.drafts);
  const tasks = byTask(view.entries, view.drafts);
  // The range, in the week's order whichever end was picked first.
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const span = scope === 'week' ? view.week : view.week.filter((d) => d.day >= lo && d.day <= hi);
  const multi = weekStats(span);
  const tracked =
    scope === 'day'
      ? view.entries.reduce((n, e) => n + e.minutes, 0) +
        view.drafts.reduce((n, d) => n + d.minutes, 0)
      : (multi.stats[0]?.value ?? 0);
  const range =
    scope === 'day'
      ? dayLong(view.day)
      : scope === 'week'
        ? `${dayLong(first)} – ${dayLong(last)}`
        : lo === hi
          ? dayLong(lo)
          : `${dayLong(lo)} – ${dayLong(hi)}`;

  return (
    <section className="myday-card myday-ov" aria-labelledby="myday-ov-title" data-overview>
      <header className="myday-ov-head">
        <div>
          <h2 className="myday-card-title" id="myday-ov-title">
            Overview
          </h2>
          <span className="myday-quiet" data-ov-range>
            {range}
          </span>
        </div>
        <div className="myday-segments" role="radiogroup" aria-label="Scope">
          {(['day', 'week', 'range'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              className={scope === s ? 'myday-segment myday-segment-on' : 'myday-segment'}
              aria-checked={scope === s}
              aria-pressed={scope === s}
              data-ov-scope={s}
              onClick={() => {
                setScope(s);
              }}
            >
              {s === 'day' ? 'Day' : s === 'week' ? 'Week' : 'Range'}
            </button>
          ))}
        </div>
        {scope === 'range' && (
          <div className="myday-ov-pick">
            <Dropdown
              value={from}
              options={dayOptions}
              onChange={setFrom}
              aria-label="From"
              className="myday-ov-select"
            />
            <span className="myday-quiet">–</span>
            <Dropdown
              value={to}
              options={dayOptions}
              onChange={setTo}
              aria-label="To"
              className="myday-ov-select"
            />
          </div>
        )}
      </header>
      {tracked === 0 ? (
        <p className="myday-quiet myday-pad" data-ov-empty>
          Nothing tracked in this range.
        </p>
      ) : scope === 'day' ? (
        <>
          <Stats stats={dayStats(view)} />
          <div className="myday-ov-columns">
            <div className="myday-ov-column">
              <h3 className="myday-summary-head">By kind</h3>
              <div className="myday-ov-bar" aria-hidden="true">
                {kinds.map((k) => (
                  <span
                    key={k.key}
                    className={`myday-summary-fill myday-summary-fill-${k.key}`}
                    style={{ width: `${String(k.pct)}%` }}
                  />
                ))}
              </div>
              <ul className="myday-ov-list" aria-label="By kind">
                {kinds.map((k) => (
                  <li key={k.key} className="myday-ov-row" data-ov-kind={k.key}>
                    <span
                      className={`myday-ov-dot myday-summary-fill-${k.key}`}
                      aria-hidden="true"
                    />
                    <span className="myday-ov-name">
                      {k.key !== 'building' && k.key !== 'general' && (
                        <span aria-hidden="true">{kindGlyph(k.key)} </span>
                      )}
                      {k.label}
                    </span>
                    <span className="myday-ov-figure">{duration(k.minutes)}</span>
                    <span className="myday-quiet myday-ov-pct">{k.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="myday-ov-column">
              <h3 className="myday-summary-head">By task</h3>
              <ul className="myday-ov-list" aria-label="By task">
                {tasks.map((t) => (
                  <li key={t.key} className="myday-ov-task" data-ov-task={t.key}>
                    <span className="myday-ov-task-line">
                      <span
                        className={
                          t.key === 'No task yet'
                            ? 'myday-ov-key myday-ov-key-none'
                            : 'myday-ov-key'
                        }
                      >
                        {t.key}
                      </span>
                      {t.title !== '' && <span className="myday-ov-task-title">{t.title}</span>}
                      <span className="myday-ov-figure">{duration(t.minutes)}</span>
                    </span>
                    <span className="myday-ov-track" aria-hidden="true">
                      <span
                        className="myday-ov-task-fill"
                        style={{ width: `${String(Math.round(t.width * 100))}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      ) : (
        <>
          <Stats stats={multi.stats} />
          <div className="myday-ov-column">
            <h3 className="myday-summary-head">By day</h3>
            <ol
              className="myday-ov-days"
              aria-label="By day"
              style={{
                gridTemplateColumns: `repeat(${String(multi.days.length)}, minmax(0, 1fr))`,
              }}
            >
              {multi.days.map((d) => (
                <li
                  key={d.day}
                  className={d.day === view.day ? 'myday-ov-day myday-ov-day-open' : 'myday-ov-day'}
                  data-ov-day={d.day}
                >
                  <span className="myday-ov-day-figure">
                    {d.confirmed + d.drafted > 0 ? duration(d.confirmed + d.drafted) : '—'}
                  </span>
                  <span className="myday-ov-day-bar" aria-hidden="true">
                    <span
                      className="myday-ov-day-fill"
                      style={{ height: `${String(Math.round(d.height * 100))}%` }}
                    >
                      {d.confirmed + d.drafted > 0 && (
                        <span
                          className="myday-ov-day-drafted"
                          style={{
                            height: `${String(Math.round((d.drafted / (d.confirmed + d.drafted)) * 100))}%`,
                          }}
                        />
                      )}
                    </span>
                  </span>
                  <span className="myday-ov-day-name">{weekdayShort(d.day)}</span>
                </li>
              ))}
            </ol>
            <p className="myday-quiet">
              By kind and by task are the open day’s: the week carries minutes, not kinds.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
