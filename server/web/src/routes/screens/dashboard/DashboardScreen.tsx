import { useEffect, useMemo, useState } from 'react';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { getMetrics, type MetricsView } from '../../../api/metrics.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { listProjects } from '../../../api/projects.ts';
import { useRoute } from '../../use-route.ts';
import {
  blockedTasks,
  byActorKind,
  describeProjectEvent,
  shownInFeed,
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
import { pickProject } from '../../../api/pick-project.ts';
import { withProjectParam } from '../../nav-url.ts';

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
/** A width for a segment of the release bar; `0%` rather than `NaN` when empty. */
function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${String((part / whole) * 100)}%`;
}

/** `4h`, `3d` — a duration a person reads, not milliseconds. */
function humanMs(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `${String(Math.max(1, Math.round(ms / 60_000)))}m`;
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.round(hours / 24))}d`;
}

export function DashboardScreen() {
  const { params, setParams } = useRoute();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);

  /**
   * Throughput and cycle time, from the endpoint that decides them.
   *
   * Kept out of `use-dashboard` deliberately: that hook's three lists all feed
   * the counts, and a fourth request whose failure must **not** blank the
   * screen does not belong in the same all-or-nothing state. A metrics request
   * that fails leaves the panel saying so and every other panel intact.
   */
  const [metrics, setMetrics] = useState<MetricsView | undefined>(undefined);

  // Fixed per range change, not per render: every "3 hours ago" on the page is
  // measured from it, and a moving clock would make rows disagree with each other.
  const [now, setNow] = useState(() => Date.now());

  const range = rangeById(params.get('range') ?? DEFAULT_RANGE);
  const since = useMemo(() => sinceFor(range, now), [range, now]);

  /*
   * The throughput request follows the same window the rest of the screen
   * uses, so the bars and the counts describe the same period. `since` is
   * `undefined` for "all time", and the endpoint's own 30-day default then
   * applies — which is the window the design's chart draws anyway.
   */
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    setMetrics(undefined);
    getMetrics(slug, since, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setMetrics(view);
      })
      .catch(() => {
        // The panel keeps saying "loading" rather than blanking the screen;
        // every other panel on it is fed by a different request.
      });

    return () => {
      controller.abort();
    };
  }, [slug, since]);

  useEffect(() => {
    const controller = new AbortController();

    listProjects({}, controller.signal)
      .then((page) => {
        // One rule on every screen (LAI-423): the most recently active
        // project, never the alphabetically first, and written into the URL so
        // the address bar names what is on screen.
        const wanted = pickProject(page.data, slug);
        setSlug(wanted?.slug);
        if (wanted !== undefined && slug === undefined) {
          setParams(new URLSearchParams(withProjectParam(params.toString(), wanted.slug)));
        }
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
        {/* No context while loading: the counts it would describe are not
            known yet, and a header that guesses is worse than a quiet one. */}
        <SpaceSlot>{rangeControl}</SpaceSlot>
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
  const inReview = tasks.filter((t) => t.status === 'review').length;
  const inFlight = tasks.filter((t) => t.status === 'in_progress').length;

  /** In-progress work per person, heaviest first — the design's mini bars. */
  const load = [
    ...tasks
      .filter((t) => t.status === 'in_progress' && t.assignee_id !== null)
      .reduce((map, task) => {
        const id = task.assignee_id ?? '';
        map.set(id, (map.get(id) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
  ]
    .map(([id, count]) => ({ id, count, name: members.get(id)?.name ?? id }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const blocked = blockedTasks(tasks);
  // The feed is edited; the counts are not. `byActorKind` still sees every
  // event, because "12 events, 3 by agents" is a claim about what happened —
  // hiding a verb from the list must not quietly change the arithmetic beside
  // it (`FEED_SILENT` explains which verb and why).
  const kinds = byActorKind(events);
  const shown = events.filter((event) => shownInFeed(event.type));

  const nameFor = (id: string | null): string =>
    id === null ? 'Laika' : (members.get(id)?.name ?? id);

  return (
    <div className="dash">
      <SpaceSlot
        /* What the numbers below actually cover. `truncated` means the lists
           hit their page cap, so the totals are a floor and the context says
           so rather than presenting them as complete. */
        context={`${String(tasks.length)}${truncated ? '+' : ''} ${
          tasks.length === 1 && !truncated ? 'task' : 'tasks'
        } · ${String(members.size)} ${members.size === 1 ? 'member' : 'members'}`}
      >
        {rangeControl}
      </SpaceSlot>

      {truncated && (
        <p className="dash-note" role="status">
          Showing the first pages only — some counts may be low.
        </p>
      )}

      {/*
        **RELEASE PROGRESS** (prototype line 723). One number, the fraction it
        came from, and a segmented bar — the design leads with this because it
        is the only figure on the screen a reader can act on without reading
        anything else.
      */}
      <section className="dash-panel dash-release" aria-label="Release progress">
        <h2 className="dash-panel-label">RELEASE PROGRESS</h2>
        <div className="dash-release-body">
          <span className="dash-release-pct">
            {breakdown.live === 0
              ? '—'
              : `${String(Math.round((breakdown.done / breakdown.live) * 100))}%`}
          </span>
          <span className="dash-release-of">
            {breakdown.done} of {breakdown.live} tasks
          </span>
        </div>

        <div className="dash-release-bar" aria-hidden="true">
          {/* Three real segments in one bar, so the eye reads finished, waiting
              and moving as parts of one whole rather than three counts. */}
          <span
            className="dash-seg dash-seg-done"
            style={{ width: pct(breakdown.done, breakdown.live) }}
          />
          <span
            className="dash-seg dash-seg-review"
            style={{ width: pct(inReview, breakdown.live) }}
          />
          <span
            className="dash-seg dash-seg-wip"
            style={{ width: pct(inFlight, breakdown.live) }}
          />
        </div>

        <div className="dash-release-legend">
          <span className="dash-leg dash-leg-done">done {breakdown.done}</span>
          <span className="dash-leg dash-leg-review">review {inReview}</span>
          <span className="dash-leg dash-leg-wip">in progress {inFlight}</span>
        </div>
      </section>

      {/*
        **THROUGHPUT** (prototype line 733) — from `GET /projects/:slug/metrics`,
        which the server has served since LAI-124 and nothing called until now.
        Every bar is the server's own count of tasks completed that day; the
        server sends quiet days as explicit zeroes, so nothing is interpolated.
      */}
      <section className="dash-panel" aria-label="Throughput">
        <h2 className="dash-panel-title">
          Throughput
          <span className="dash-panel-meta">
            {metrics === undefined
              ? 'loading'
              : `${String(metrics.throughput.reduce((n, b) => n + b.completed, 0))} completed`}
          </span>
        </h2>

        {metrics === undefined ? (
          <p className="dash-empty">Loading throughput…</p>
        ) : metrics.throughput.length === 0 ? (
          <p className="dash-empty">Nothing has been completed in this window.</p>
        ) : (
          <>
            <div className="dash-bars">
              {metrics.throughput.map((bucket) => {
                const peak = Math.max(...metrics.throughput.map((b) => b.completed), 1);
                return (
                  <span
                    key={bucket.day}
                    className={bucket.completed === 0 ? 'dash-bar dash-bar-zero' : 'dash-bar'}
                    style={{ height: `${String(Math.max(2, (bucket.completed / peak) * 100))}%` }}
                    title={`${bucket.day}: ${String(bucket.completed)} completed`}
                  />
                );
              })}
            </div>

            {/* `null` is "nothing to measure", never a zeroed shape — so the
                screen says so instead of printing `p50 0m`. */}
            <p className="dash-cycle">
              {metrics.cycle_time === null
                ? 'No completed task in this window had a start to measure from.'
                : `cycle time p50 ${humanMs(metrics.cycle_time.p50_ms)} · p90 ${humanMs(
                    metrics.cycle_time.p90_ms,
                  )} · ${String(metrics.cycle_time.measured)} measured`}
            </p>
          </>
        )}
      </section>

      {/*
        **WHO IS CARRYING WHAT** (prototype line 740). Counted from the tasks
        already loaded — the same list every other panel here counts.
      */}
      <section className="dash-panel" aria-label="Who is carrying what">
        <h2 className="dash-panel-title">
          Who is carrying what
          <span className="dash-panel-meta">{load.length} carrying work</span>
        </h2>

        {load.length === 0 ? (
          <p className="dash-empty">Nothing in progress is assigned to anyone.</p>
        ) : (
          <ul className="dash-load">
            {load.map((row) => (
              <li key={row.id} className="dash-load-row">
                <span className="dash-load-name">{row.name}</span>
                <span className="dash-load-bars" aria-hidden="true">
                  {Array.from({ length: row.count }, (_, i) => (
                    <span key={i} className="dash-load-pip" />
                  ))}
                </span>
                <span className="dash-load-count">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

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

        {shown.length === 0 ? (
          <EmptyState
            headline={
              events.length === 0
                ? `Nothing in the ${range.label.toLowerCase()}`
                : 'Nothing worth showing in this range'
            }
            body={
              events.length === 0
                ? 'Widen the range to see older activity.'
                : /* The count beside this says how many events there were, and
                     it is not wrong — they are all verbs the feed declines
                     (`FEED_SILENT`). Saying "nothing happened" over a count of
                     52 is the contradiction; saying nothing worth *showing* is
                     the truth. */
                  'Everything in this range is the kind of event this feed leaves out — tasks moved between sprints.'
            }
          />
        ) : (
          <ul className="dash-feed">
            {shown.map((event) => {
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
