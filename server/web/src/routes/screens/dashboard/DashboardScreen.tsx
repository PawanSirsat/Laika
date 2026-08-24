import { useEffect, useMemo, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { isProject, listProjects } from '../../../api/projects.ts';
import { useRoute } from '../../use-route.ts';
import {
  blockedTasks,
  byActorKind,
  describeProjectEvent,
  DEFAULT_RANGE,
  RANGES,
  rangeById,
  relativeTime,
  sinceFor,
  statusBreakdown,
  statusChange,
} from './dashboard-derive.ts';
import { useDashboard } from './use-dashboard.ts';
import './dashboard.css';

/**
 * Dashboard (SPEC §4.8, §11.4 — LAI-085).
 *
 * The activity endpoints landed in LAI-055 and nothing read them except the task
 * panel. This is the project-wide view: what happened, what is stuck, and where
 * the work is.
 *
 * ## Every number is derived from a response
 *
 * Status counts and blocked work come from the task list; the feed and the
 * agent/human split come from `activity`. Nothing is a fixture, and where a
 * number cannot be derived it is absent rather than invented — **cycle time and
 * throughput-over-time are not here** because deriving them needs a server-side
 * aggregation the endpoint does not do, and one request per task would be a
 * defect. Filed as LAI-124 rather than approximated.
 *
 * ## The range control drives the query
 *
 * `?since=` is what the endpoint already supports, so changing the range refetches
 * rather than trimming a list client-side. That is what lets the empty state say
 * *"nothing in this range"* truthfully instead of implying the project is empty.
 */
export function DashboardScreen() {
  const { params, setParams } = useRoute();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);

  // Fixed per range change, not per render: every "3 hours ago" on the page is
  // measured from it, and a moving clock would make rows disagree with each other.
  const [now, setNow] = useState(() => Date.now());

  const range = rangeById(params.get('range') ?? DEFAULT_RANGE);
  const since = useMemo(() => sinceFor(range, now), [range, now]);

  useEffect(() => {
    const controller = new AbortController();

    listProjects({}, controller.signal)
      .then((page) => {
        const live = page.data.filter(isProject);
        setSlug((slug === undefined ? live[0] : live.find((p) => p.slug === slug))?.slug);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectError(cause);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const dashboard = useDashboard(slug, since);

  const setRange = (id: string): void => {
    const next = new URLSearchParams(params);
    if (id === DEFAULT_RANGE) next.delete('range');
    else next.set('range', id);
    setParams(next);
    // Re-anchor the clock so the new window is measured from the moment it was
    // asked for, not from when the screen first opened.
    setNow(Date.now());
  };

  if (projectError !== null) {
    return (
      <div className="dash">
        <ApiErrorState error={projectError} resource="your projects" scope="organisation" />
      </div>
    );
  }

  const rangeControl = (
    <div className="dash-ranges" role="group" aria-label="Time range">
      {RANGES.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === range.id ? 'dash-range dash-range-on' : 'dash-range'}
          aria-pressed={option.id === range.id}
          onClick={() => {
            setRange(option.id);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  if (dashboard.state.status === 'loading') {
    return (
      <div className="dash">
        <header className="dash-head">
          <h1 className="dash-title">Dashboard</h1>
          {rangeControl}
        </header>
        <LoadingState shape="card" count={3} label="Loading dashboard" />
      </div>
    );
  }

  if (dashboard.state.status === 'error') {
    return (
      <div className="dash">
        <ApiErrorState
          error={dashboard.state.error}
          resource="this project's dashboard"
          scope="project"
          onRetry={dashboard.reload}
        />
      </div>
    );
  }

  const { tasks, events, members, truncated } = dashboard.state;
  const breakdown = statusBreakdown(tasks);
  const blocked = blockedTasks(tasks);
  const kinds = byActorKind(events);

  const nameFor = (id: string | null): string =>
    id === null ? 'Laika' : (members.get(id)?.name ?? id);

  return (
    <div className="dash">
      <header className="dash-head">
        <h1 className="dash-title">Dashboard</h1>
        {rangeControl}
      </header>

      {truncated && (
        <p className="dash-note" role="status">
          Showing the first pages only — some counts may be low.
        </p>
      )}

      <section className="dash-panel" aria-label="Work by status">
        <h2 className="dash-panel-title">
          Work by status
          <span className="dash-panel-meta">
            {/* `live` excludes cancelled; `total` keeps it, so the two together
                still say that cancellations happened. */}
            {breakdown.done}/{breakdown.live} done
            {breakdown.total !== breakdown.live &&
              ` · ${String(breakdown.total - breakdown.live)} cancelled`}
          </span>
        </h2>

        {breakdown.total === 0 ? (
          <p className="dash-empty">This project has no tasks yet.</p>
        ) : (
          <ul className="dash-counts">
            {breakdown.counts.map((entry) => (
              <li key={entry.status} className="dash-count">
                <span className={`dash-count-value dash-status-${entry.status}`}>
                  {entry.count}
                </span>
                <span className="dash-count-label">{entry.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-panel" aria-label="Blocked work">
        <h2 className="dash-panel-title">
          Blocked
          <span className="dash-panel-meta">{blocked.length}</span>
        </h2>

        {blocked.length === 0 ? (
          <p className="dash-empty">Nothing is waiting on an unfinished dependency.</p>
        ) : (
          <ul className="dash-blocked">
            {blocked.map((row) => (
              <li key={row.task.id} className="dash-blocked-row">
                <span className="dash-key">{row.task.key}</span>
                <span className="dash-blocked-title">{row.task.title}</span>
                <span className="dash-blocked-by">
                  waiting on {row.blockedBy.map((dep) => dep.key).join(', ')}
                  {row.unknown.length > 0 &&
                    `${row.blockedBy.length > 0 ? ', ' : ''}${String(row.unknown.length)} not loaded`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-panel" aria-label="Recent activity">
        <h2 className="dash-panel-title">
          Activity
          <span className="dash-panel-meta">
            {/* The agent/human split is why `actor_kind` is on every row (D-022);
                without it the badge is decoration. */}
            {events.length} event{events.length === 1 ? '' : 's'}
            {kinds.agent > 0 && ` · ${String(kinds.agent)} by agents`}
          </span>
        </h2>

        {events.length === 0 ? (
          <EmptyState
            headline={`Nothing in the ${range.label.toLowerCase()}`}
            body="Widen the range to see older activity."
          />
        ) : (
          <ul className="dash-feed">
            {events.map((event) => {
              const moved = statusChange(event);

              return (
                <li key={`${event.id}-${String(event.seq)}`} className="dash-event">
                  <span className={`dash-kind dash-kind-${event.actor_kind}`}>
                    {event.actor_kind}
                  </span>
                  <span className="dash-actor">{nameFor(event.actor_id)}</span>
                  <span className="dash-what">
                    {describeProjectEvent(event)}
                    {moved !== undefined && (
                      <span className="dash-move">
                        {' '}
                        {moved.from.replace('_', ' ')} → {moved.to.replace('_', ' ')}
                      </span>
                    )}
                  </span>
                  <time className="dash-when" dateTime={new Date(event.created_at).toISOString()}>
                    {relativeTime(event.created_at, now)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
