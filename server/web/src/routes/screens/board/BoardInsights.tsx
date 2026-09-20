import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getMetrics, type MetricsView } from '../../../api/metrics.ts';
import { ApiError } from '../../../api/errors.ts';
import './board-insights.css';

export interface BoardInsightsProps {
  readonly slug: string;
  readonly onClose: () => void;
}

/** `3d 4h`, `5h`, `40m` — the same coarseness `staleFor` uses. */
function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;

  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${String(hours)}h`;

  const days = Math.floor(ms / 86_400_000);
  const rest = Math.floor((ms - days * 86_400_000) / 3_600_000);
  return rest === 0 ? `${String(days)}d` : `${String(days)}d ${String(rest)}h`;
}

/**
 * Throughput and cycle time for this space (LAI-290).
 *
 * The endpoint has been served since LAI-457 and nothing in the browser opened
 * it. This is the board toolbar's insights icon, and it exists so that icon
 * does something real — an icon with nothing behind it is decoration, and four
 * of them would be a row of decoration.
 *
 * ## What it refuses to draw
 *
 * `cycle_time` is `null` when there is nothing to measure, and that is **not**
 * a zero. A panel that drew `p50 0m` on a project where nobody has finished
 * anything would be stating a measurement that was never taken — the same
 * distinction `metrics.ts` makes between `measured` and `unmeasured`, which is
 * reported here rather than hidden.
 */
export function BoardInsights({ slug, onClose }: BoardInsightsProps) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; data: MetricsView }
    | { status: 'error'; why: string }
  >({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    getMetrics(slug, undefined, controller.signal)
      .then((data) => {
        setState({ status: 'ready', data });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({
          status: 'error',
          why: cause instanceof ApiError ? cause.message : 'Could not read the numbers.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const total =
    state.status === 'ready'
      ? state.data.throughput.reduce((n, bucket) => n + bucket.completed, 0)
      : 0;
  const peak =
    state.status === 'ready'
      ? Math.max(1, ...state.data.throughput.map((bucket) => bucket.completed))
      : 1;

  return createPortal(
    <>
      <div className="bi-catcher" aria-hidden="true" onClick={onClose} />
      <div className="bi" role="dialog" aria-label="Insights">
        <header className="bi-head">
          <h2 className="bi-title">Insights</h2>
          <button type="button" className="bi-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {state.status === 'loading' && <p className="bi-note">Reading…</p>}
        {state.status === 'error' && (
          <p className="bi-note" role="alert">
            {state.why}
          </p>
        )}

        {state.status === 'ready' && (
          <>
            <section className="bi-section">
              <h3 className="bi-label">Throughput</h3>
              <p className="bi-big">
                {total} <span className="bi-unit">finished</span>
              </p>
              <div className="bi-spark" aria-hidden="true">
                {state.data.throughput.map((bucket) => (
                  <span
                    key={bucket.day}
                    className="bi-bar"
                    style={{ height: `${String(Math.round((bucket.completed / peak) * 100))}%` }}
                    title={`${bucket.day}: ${String(bucket.completed)}`}
                  />
                ))}
              </div>
              <p className="bi-note">
                {state.data.throughput.length} days. Days with nothing finished are present and zero
                — the server sends them, so the shape is not invented here.
              </p>
            </section>

            <section className="bi-section">
              <h3 className="bi-label">Cycle time</h3>
              {state.data.cycle_time === null ? (
                /*
                 * `null` means nothing has been completed with a start to
                 * measure from. Drawing `0m` here would report a measurement
                 * nobody took.
                 */
                <p className="bi-note">Nothing finished yet, so there is nothing to measure.</p>
              ) : (
                <>
                  <p className="bi-big">
                    {duration(state.data.cycle_time.p50_ms)} <span className="bi-unit">median</span>
                  </p>
                  <dl className="bi-rows">
                    <div>
                      <dt>p75</dt>
                      <dd>{duration(state.data.cycle_time.p75_ms)}</dd>
                    </div>
                    <div>
                      <dt>p90</dt>
                      <dd>{duration(state.data.cycle_time.p90_ms)}</dd>
                    </div>
                    <div>
                      <dt>measured</dt>
                      <dd>{state.data.cycle_time.measured}</dd>
                    </div>
                  </dl>
                  {state.data.cycle_time.unmeasured > 0 && (
                    <p className="bi-note">
                      {state.data.cycle_time.unmeasured} finished without a recorded start, so they
                      are counted and not measured.
                    </p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
