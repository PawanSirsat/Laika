import { useState } from 'react';
import { formatDurationMs } from '../../../api/duration.ts';
import { DashLink } from './DashLink.tsx';
import type { MetricsState } from './use-dashboard.ts';
import { completedIn } from './summary-derive.ts';

/** `4 h 12 min`, `3 d 2 h` — a duration a person reads, not milliseconds (LAI-830). */
function humanMs(ms: number): string {
  return formatDurationMs(Math.max(60_000, ms));
}

/** `7 Oct` from the server's `2026-10-07` — a UTC day, read as one. */
function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * **Throughput and cycle time** (SPEC §11.4.2.1, LAI-711) — what finished each
 * day, and how long work takes from start to done. Both from `/metrics`, the
 * endpoint that decides them; a failure there says so here and blanks nothing
 * else.
 */
export function Throughput({
  metrics,
  window,
  doneHref,
  onRetry,
}: {
  readonly metrics: MetricsState;
  /** "in the last 7 days"; all time is the endpoint's own 30 days, said as such. */
  readonly window: string;
  /** The List, filtered to finished work — what the chart summarises (LAI-1195). */
  readonly doneHref: string;
  /** Ask `/metrics` again after a failure. */
  readonly onRetry: () => void;
}) {
  /** The bar under the pointer or the keyboard, read out under the chart. */
  const [focusDay, setFocusDay] = useState<string | undefined>(undefined);
  const view = metrics.status === 'ready' ? metrics.view : undefined;
  const total = view === undefined ? 0 : completedIn(view.throughput);
  const peak = view === undefined ? 0 : Math.max(0, ...view.throughput.map((d) => d.completed));
  const first = view?.throughput[0];
  const last = view?.throughput.at(-1);

  return (
    <section className="dash-card dash-throughput" aria-labelledby="dash-throughput-title">
      <header className="dash-card-head">
        <h2 id="dash-throughput-title" className="dash-card-title">
          Throughput &amp; cycle time
        </h2>
        <span className="dash-card-tools">
          <span className="dash-card-meta">
            {view === undefined ? '' : `${String(total)} completed ${window}`}
          </span>
          {view !== undefined && total > 0 && (
            <DashLink
              href={doneHref}
              className="dash-card-link"
              title="Open finished work in the List"
            >
              Open in List
            </DashLink>
          )}
        </span>
      </header>

      {metrics.status === 'loading' ? (
        <p className="dash-empty">Counting what finished…</p>
      ) : metrics.status === 'error' ? (
        <p className="dash-empty" role="alert">
          Throughput could not be loaded. The rest of the page is current.
          <button type="button" className="dash-retry" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : total === 0 ? (
        <p className="dash-empty">Nothing was completed {window}.</p>
      ) : (
        <>
          {/*
            **Each day is a stop for the keyboard** (LAI-1195): a list of
            focusable bars, each named by its day and count, and a readout
            under the chart that says which one is under focus or the
            pointer. The list itself is the chart's text alternative.
          */}
          <ul className="dash-tp-bars" aria-label="Completed per day">
            {view!.throughput.map((d) => {
              const said = `${dayLabel(d.day)}: ${String(d.completed)} completed`;
              return (
                <li
                  key={d.day}
                  className={d.completed === 0 ? 'dash-tp-bar dash-tp-bar-zero' : 'dash-tp-bar'}
                  style={{ height: `${String(Math.max(3, (d.completed / peak) * 100))}%` }}
                  data-active={focusDay === d.day ? '' : undefined}
                  data-day={d.day}
                  tabIndex={0}
                  aria-label={said}
                  title={said}
                  onFocus={() => {
                    setFocusDay(d.day);
                  }}
                  onBlur={() => {
                    setFocusDay(undefined);
                  }}
                  onMouseEnter={() => {
                    setFocusDay(d.day);
                  }}
                  onMouseLeave={() => {
                    setFocusDay(undefined);
                  }}
                />
              );
            })}
          </ul>
          {first !== undefined && last !== undefined && (
            <p className="dash-tp-axis" aria-hidden="true">
              <span>{dayLabel(first.day)}</span>
              <span>{dayLabel(last.day)}</span>
            </p>
          )}
          <p className="dash-tp-readout" aria-live="polite">
            {(() => {
              const shown = view!.throughput.find((d) => d.day === focusDay);
              return shown === undefined ? (
                <span>
                  Peak day: <strong>{peak}</strong> completed
                </span>
              ) : (
                <span>
                  {dayLabel(shown.day)}: <strong>{shown.completed}</strong> completed
                </span>
              );
            })()}
          </p>
        </>
      )}

      {view?.cycle_time !== null &&
        view?.cycle_time !== undefined &&
        view.cycle_time.measured > 0 && (
          <dl className="dash-cycle">
            <div>
              <dt>Cycle time, median</dt>
              <dd>{humanMs(view.cycle_time.p50_ms)}</dd>
            </div>
            <div>
              <dt>90th percentile</dt>
              <dd>{humanMs(view.cycle_time.p90_ms)}</dd>
            </div>
            <div>
              <dt>Measured</dt>
              <dd>{view.cycle_time.measured}</dd>
            </div>
          </dl>
        )}
    </section>
  );
}
