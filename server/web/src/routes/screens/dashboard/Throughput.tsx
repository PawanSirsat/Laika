import type { MetricsState } from './use-dashboard.ts';
import { completedIn } from './summary-derive.ts';

/** `4h`, `3d` — a duration a person reads, not milliseconds. */
function humanMs(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `${String(Math.max(1, Math.round(ms / 60_000)))}m`;
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.round(hours / 24))}d`;
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
}: {
  readonly metrics: MetricsState;
  /** "in the last 7 days"; all time is the endpoint's own 30 days, said as such. */
  readonly window: string;
}) {
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
        <span className="dash-card-meta">
          {view === undefined ? '' : `${String(total)} completed ${window}`}
        </span>
      </header>

      {metrics.status === 'loading' ? (
        <p className="dash-empty">Counting what finished…</p>
      ) : metrics.status === 'error' ? (
        <p className="dash-empty">Throughput could not be loaded. The rest of the page is current.</p>
      ) : total === 0 ? (
        <p className="dash-empty">Nothing was completed {window}.</p>
      ) : (
        <>
          <div
            className="dash-tp-bars"
            role="img"
            aria-label={`Completed per day: ${view!.throughput
              .map((d) => `${dayLabel(d.day)} ${String(d.completed)}`)
              .join(', ')}`}
          >
            {view!.throughput.map((d) => (
              <span
                key={d.day}
                className={d.completed === 0 ? 'dash-tp-bar dash-tp-bar-zero' : 'dash-tp-bar'}
                style={{ height: `${String(Math.max(3, (d.completed / peak) * 100))}%` }}
                title={`${dayLabel(d.day)}: ${String(d.completed)}`}
              />
            ))}
          </div>
          {first !== undefined && last !== undefined && (
            <p className="dash-tp-axis" aria-hidden="true">
              <span>{dayLabel(first.day)}</span>
              <span>{dayLabel(last.day)}</span>
            </p>
          )}
        </>
      )}

      {view?.cycle_time !== null && view?.cycle_time !== undefined && (
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
