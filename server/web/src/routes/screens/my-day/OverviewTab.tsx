import { useEffect, useState } from 'react';
import { getPersonSummary } from '../../../api/people-analytics.ts';
import { getTimeSummary, type MyDay, type TimeSummary } from '../../../api/time.ts';
import { SpaceBadge } from '../../../components/SpaceBadge.tsx';
import { compact, duration } from './format.ts';
import { weekdayShort } from './my-day-derive.ts';
import {
  dayBars,
  kindRows,
  presetRange,
  projectRows,
  RANGE_PRESETS,
  rangeProblem,
  statsOf,
  summaryOfDay,
  taskRows,
  weekOf,
  type DayRange,
  type Stat,
} from './overview-derive.ts';
import { dayLong } from './week-derive.ts';
import './day-skeleton.css';
import './overview.css';

export type OverviewScope = 'day' | 'week' | 'range';

export interface OverviewTabProps {
  readonly view: MyDay;
  /** Somebody else's day, read (LAI-959): their summary, not the reader's. */
  readonly subjectId?: string | undefined;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly key: string; readonly summary: TimeSummary }
  | { readonly kind: 'error'; readonly message: string };

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

/** The figures being read: the stats and three lists, in bones (LAI-524's sheen). */
function Reading() {
  return (
    <div className="myday-ov-reading" aria-hidden="true" data-ov-loading>
      <div className="myday-ov-stats">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="myday-ov-stat">
            <span className="dsk-bone" style={{ width: '4.5rem', height: '0.625rem' }} />
            <span className="dsk-bone" style={{ width: '6rem', height: '1.25rem' }} />
            <span className="dsk-bone" style={{ width: '5rem', height: '0.625rem' }} />
          </span>
        ))}
      </div>
      <div className="myday-ov-columns">
        {[0, 1].map((c) => (
          <div key={c} className="myday-ov-column">
            {[70, 55, 82, 40].map((w, i) => (
              <span key={i} className="dsk-bone" style={{ width: `${String(w)}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A signature of the open day, so a write on it reads the stretch again. */
const signatureOf = (view: MyDay): string =>
  [...view.entries, ...view.drafts].map((x) => `${x.id}:${String(x.minutes)}`).join(',');

/**
 * *Overview* (the owner's design, D-110 item 4, LAI-505; LAI-514; LAI-526):
 * the open day, its week, or any range the reader picks — quick picks or two
 * dates, a quarter at most. Every scope draws the same: Tracked, To review,
 * Meetings, Off-screen and, over several days, Per active day; then by kind,
 * by project and by task; and by day over several. The day is read from the
 * page's own day; a week or a range from `GET /me/time/summary` (somebody
 * else's from `GET /people/:id/time/summary`, a look they are told about).
 */
export function OverviewTab({ view, subjectId }: OverviewTabProps) {
  const [scope, setScope] = useState<OverviewScope>('day');
  const [range, setRange] = useState<DayRange>(() => presetRange('last7', view.today));
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const stretch: DayRange | undefined =
    scope === 'day' ? undefined : scope === 'week' ? weekOf(view.day) : range;
  const problem = scope === 'range' ? rangeProblem(range) : undefined;
  const signature = signatureOf(view);
  const key =
    stretch === undefined ? '' : `${subjectId ?? 'me'}:${stretch.from}:${stretch.to}:${signature}`;

  useEffect(() => {
    if (stretch === undefined || problem !== undefined) return;
    const controller = new AbortController();
    const { from, to } = stretch;
    setLoad((was) => (was.kind === 'ready' && was.key === key ? was : { kind: 'loading' }));
    (subjectId === undefined
      ? getTimeSummary(from, to, controller.signal)
      : getPersonSummary(subjectId, from, to, controller.signal)
    ).then(
      (summary) => {
        setLoad({ kind: 'ready', key, summary });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          kind: 'error',
          message: cause instanceof Error ? cause.message : 'The summary could not be read.',
        });
      },
    );
    return () => {
      controller.abort();
    };
    // `key` carries the stretch, whose it is and the open day's signature.
  }, [key, problem, attempt]);

  const summary =
    scope === 'day' ? summaryOfDay(view) : load.kind === 'ready' ? load.summary : undefined;
  const label =
    scope === 'day' || stretch === undefined
      ? dayLong(view.day)
      : stretch.from === stretch.to
        ? dayLong(stretch.from)
        : `${dayLong(stretch.from)} – ${dayLong(stretch.to)}`;
  const tracked = summary === undefined ? 0 : summary.confirmed_minutes + summary.drafted_minutes;

  return (
    <section className="myday-card myday-ov" aria-labelledby="myday-ov-title" data-overview>
      <header className="myday-ov-head">
        <div>
          <h2 className="myday-card-title" id="myday-ov-title">
            Overview
          </h2>
          <span className="myday-quiet" data-ov-range>
            {label}
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
      </header>

      {scope === 'range' && (
        <div className="myday-ov-range" data-ov-range-picker>
          <div className="myday-ov-presets" role="group" aria-label="Quick picks">
            {RANGE_PRESETS.map(([preset, words]) => {
              const days = presetRange(preset, view.today);
              const on = days.from === range.from && days.to === range.to;
              return (
                <button
                  key={preset}
                  type="button"
                  className={on ? 'myday-ov-preset myday-ov-preset-on' : 'myday-ov-preset'}
                  aria-pressed={on}
                  data-ov-preset={preset}
                  onClick={() => {
                    setRange(days);
                  }}
                >
                  {words}
                </button>
              );
            })}
          </div>
          <div className="myday-ov-dates">
            <label className="myday-ov-date">
              <span className="myday-ov-date-label">From</span>
              <input
                type="date"
                className="input myday-ov-date-input"
                value={range.from}
                max={view.today}
                data-ov-from
                onChange={(event) => {
                  setRange({ from: event.target.value, to: range.to });
                }}
              />
            </label>
            <span className="myday-quiet" aria-hidden="true">
              –
            </span>
            <label className="myday-ov-date">
              <span className="myday-ov-date-label">To</span>
              <input
                type="date"
                className="input myday-ov-date-input"
                value={range.to}
                min={range.from}
                max={view.today}
                data-ov-to
                onChange={(event) => {
                  setRange({ from: range.from, to: event.target.value });
                }}
              />
            </label>
          </div>
        </div>
      )}

      {problem !== undefined ? (
        <p className="myday-ov-note" role="alert" data-ov-problem>
          {problem}
        </p>
      ) : summary === undefined ? (
        load.kind === 'error' ? (
          <p className="myday-ov-note myday-ov-failed" role="alert" data-ov-error>
            This range could not be read: {load.message}
            <button
              type="button"
              className="myday-chip"
              onClick={() => {
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </button>
          </p>
        ) : (
          <Reading />
        )
      ) : tracked === 0 ? (
        <p className="myday-quiet myday-pad" data-ov-empty>
          {scope === 'day' ? 'Nothing tracked on this day.' : 'Nothing tracked in this range.'}
        </p>
      ) : (
        <Figures summary={summary} openDay={view.day} />
      )}
    </section>
  );
}

function Figures({
  summary,
  openDay,
}: {
  readonly summary: TimeSummary;
  readonly openDay: string;
}) {
  const kinds = kindRows(summary.by_kind);
  const projects = projectRows(summary.by_project);
  const tasks = taskRows(summary.by_task);
  const bars = summary.days > 1 ? dayBars(summary) : [];
  // Past two weeks a bar is thin: its figure moves to its title, its name to every seventh.
  const dense = bars.length > 14;

  return (
    <>
      <Stats stats={statsOf(summary)} />
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
                <span className={`myday-ov-dot myday-summary-fill-${k.key}`} aria-hidden="true" />
                <span className="myday-ov-name">{k.label}</span>
                <span className="myday-ov-figure">{duration(k.minutes)}</span>
                <span className="myday-quiet myday-ov-pct">{k.pct}%</span>
              </li>
            ))}
          </ul>

          <h3 className="myday-summary-head myday-ov-project-head">By project</h3>
          <ul className="myday-ov-list" aria-label="By project">
            {projects.map((p) => (
              <li
                key={p.key}
                className="myday-ov-project"
                data-ov-project={p.project?.slug ?? 'none'}
              >
                <span className="myday-ov-task-line">
                  {p.project === null ? (
                    <span className="myday-ov-project-none" aria-hidden="true" />
                  ) : (
                    <SpaceBadge slug={p.project.slug} name={p.project.name} />
                  )}
                  <span
                    className={
                      p.project === null
                        ? 'myday-ov-project-name myday-ov-key-none'
                        : 'myday-ov-project-name'
                    }
                  >
                    {p.label}
                  </span>
                  <span className="myday-ov-figure">{duration(p.minutes)}</span>
                  <span className="myday-quiet myday-ov-pct">{p.pct}%</span>
                </span>
                <span className="myday-ov-track" aria-hidden="true">
                  <span
                    className="myday-ov-project-fill"
                    style={{ width: `${String(Math.round(p.width * 100))}%` }}
                  />
                </span>
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
                      t.key === 'No task yet' || t.key === 'No task'
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

      {bars.length > 0 && (
        <div className="myday-ov-column">
          <h3 className="myday-summary-head">By day</h3>
          <ol
            className={dense ? 'myday-ov-days myday-ov-days-dense' : 'myday-ov-days'}
            aria-label="By day"
            style={{ gridTemplateColumns: `repeat(${String(bars.length)}, minmax(0, 1fr))` }}
          >
            {bars.map((d, i) => {
              const sum = d.confirmed + d.drafted;
              const figure = sum > 0 ? duration(sum) : '—';
              // A narrow column takes the Timeline's short figure; the title keeps the long.
              const short = sum > 0 ? compact(sum) : '—';
              return (
                <li
                  key={d.day}
                  className={d.day === openDay ? 'myday-ov-day myday-ov-day-open' : 'myday-ov-day'}
                  data-ov-day={d.day}
                  title={`${dayLong(d.day)} · ${figure}`}
                >
                  {!dense && (
                    <span className="myday-ov-day-figure">
                      <span className="myday-ov-day-long">{figure}</span>
                      <span className="myday-ov-day-short">{short}</span>
                    </span>
                  )}
                  <span className="myday-ov-day-bar" aria-hidden="true">
                    <span
                      className="myday-ov-day-fill"
                      style={{ height: `${String(Math.round(d.height * 100))}%` }}
                    >
                      {sum > 0 && (
                        <span
                          className="myday-ov-day-drafted"
                          style={{ height: `${String(Math.round((d.drafted / sum) * 100))}%` }}
                        />
                      )}
                    </span>
                  </span>
                  <span className="myday-ov-day-name">
                    {dense
                      ? i % 7 === 0
                        ? String(Number(d.day.slice(8)))
                        : ''
                      : bars.length > 7
                        ? String(Number(d.day.slice(8)))
                        : weekdayShort(d.day)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}
