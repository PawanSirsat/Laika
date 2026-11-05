import { useState } from 'react';
import type { MyDay, TimeSummary } from '../../../api/time.ts';
import { SpaceBadge } from '../../../components/SpaceBadge.tsx';
import { TimeReport } from '../../../components/time-report/TimeReport.tsx';
import {
  RANGE_LABELS,
  REPORT_RANGES,
  type ReportRange,
} from '../../../components/time-report/time-report-derive.ts';
import { compact, duration } from './format.ts';
import { weekdayShort } from './my-day-derive.ts';
import {
  dayBars,
  kindRows,
  projectRows,
  statsOf,
  summaryOfDay,
  taskRows,
  type Stat,
} from './overview-derive.ts';
import { dayLong } from './week-derive.ts';
import './day-skeleton.css';
import './overview.css';

export type OverviewScope = ReportRange;

export interface OverviewTabProps {
  readonly view: MyDay;
  /** The reader: their own report is `GET /time/report?members=<them>`. */
  readonly meId: string | undefined;
  /** Somebody else's day, read (LAI-959): their report, not the reader's — a look they are told about. */
  readonly subjectId?: string | undefined;
  readonly subjectName?: string | undefined;
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

/**
 * *Overview* (the owner's design, D-110 item 4, LAI-505; LAI-514; LAI-526;
 * LAI-1138): the open day — Tracked, To review, Meetings, Off-screen, then by
 * kind, by project and by task, read from the page's own day — or, for a
 * Week, a Month or a picked Range, the shared **Time report** (D-130) from
 * `GET /time/report`: the reader's own, or the person the reader is viewing,
 * which is a look they are told about. Picking Day in the report comes back
 * here.
 */
export function OverviewTab({ view, meId, subjectId, subjectName }: OverviewTabProps) {
  const [scope, setScope] = useState<OverviewScope>('day');

  // Nobody to name — the frame before the session lands — keeps the day:
  // a report with no `members` would be everyone's.
  const whose = subjectId ?? meId;
  if (scope !== 'day' && whose !== undefined) {
    return (
      <TimeReport
        key={`${whose}:${scope}`}
        scope={subjectId === undefined ? 'me' : 'person'}
        subject={{ id: whose, name: subjectName ?? '' }}
        today={view.today}
        anchor={view.day}
        initialRange={scope}
        onDay={() => {
          setScope('day');
        }}
      />
    );
  }

  const summary = summaryOfDay(view);
  const tracked = summary.confirmed_minutes + summary.drafted_minutes;

  return (
    <section className="myday-card myday-ov" aria-labelledby="myday-ov-title" data-overview>
      <header className="myday-ov-head">
        <div>
          <h2 className="myday-card-title" id="myday-ov-title">
            Overview
          </h2>
          <span className="myday-quiet" data-ov-range>
            {dayLong(view.day)}
          </span>
        </div>
        <div className="myday-segments" role="radiogroup" aria-label="Range">
          {REPORT_RANGES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              className={scope === s ? 'myday-segment myday-segment-on' : 'myday-segment'}
              aria-checked={scope === s}
              data-ov-scope={s}
              onClick={() => {
                setScope(s);
              }}
            >
              {RANGE_LABELS[s]}
            </button>
          ))}
        </div>
      </header>

      {tracked === 0 ? (
        <p className="myday-quiet myday-pad" data-ov-empty>
          Nothing tracked on this day.
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
