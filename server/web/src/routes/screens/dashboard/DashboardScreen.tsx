import { useEffect, useMemo, useState } from 'react';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { getMetrics, type MetricsView } from '../../../api/metrics.ts';
import { statusLabel, updatedAge } from '../../../api/board-derive.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
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
/**
 * The avatar's colours for an actor.
 *
 * A `null` actor is Laika itself (the CHECK constraint makes that the only
 * meaning), and it gets the neutral chip rather than a colour drawn from the
 * string `"null"` — which is what colouring by a fallback id would do.
 */
function avatarStyle(actorId: string | null, theme: Parameters<typeof avatarColor>[1]) {
  if (actorId === null) return undefined;
  const ink = avatarColor(actorId, theme);
  return { background: ink.background, color: ink.foreground, borderColor: ink.border };
}

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
  const { theme } = useTheme();
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
  /**
   * Which actors the feed shows.
   *
   * Local, not a URL parameter: it is a way of reading the list already on
   * screen, and the range — which changes what is *fetched* — is the thing
   * that earns a place in the address bar.
   */
  const [actor, setActor] = useState<'all' | 'user' | 'agent'>('all');

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

  const nameFor = (id: string | null): string =>
    id === null ? 'Laika' : (members.get(id)?.name ?? id);

  /**
   * **Quiet for five days or more**, oldest first.
   *
   * The same threshold the board's rail and the List's amber use, taken from
   * the same `updated_at` — one definition of stale for the whole product, so
   * two screens cannot disagree about whether something has gone quiet.
   * Finished work is excluded: a done task is not stale, it is done.
   */
  const stale = tasks
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .filter((t) => now - t.updated_at > 5 * 24 * 60 * 60 * 1000)
    .sort((a, b) => a.updated_at - b.updated_at)
    .slice(0, 5);

  /**
   * What the agents did in this window — a filter over the feed, not a second
   * measurement of it. `actor_kind` is on every activity row (D-022).
   */
  const agentEvents = events.filter((e) => e.actor_kind === 'agent');
  const agentTasks = new Set(agentEvents.map((e) => e.task_id).filter((id) => id !== null)).size;
  const agentLog = [
    ...agentEvents.reduce((map, event) => {
      const who = nameFor(event.actor_id);
      map.set(who, (map.get(who) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  ]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

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

  /** How long the oldest blocked task has been waiting — the design's figure. */
  const oldestBlocked =
    blocked.length === 0
      ? undefined
      : updatedAge(Math.min(...blocked.map((row) => row.task.updated_at)), now);

  // The feed is edited; the counts are not. `byActorKind` still sees every
  // event, because "12 events, 3 by agents" is a claim about what happened —
  // hiding a verb from the list must not quietly change the arithmetic beside
  // it (`FEED_SILENT` explains which verb and why).
  const kinds = byActorKind(events);
  const shown = events.filter((event) => shownInFeed(event.type));
  /*
   * The counts above stay whole while the *list* narrows: "154 events, 4 by
   * agents" is a claim about what happened, and a filter must not quietly
   * change the arithmetic beside it.
   */
  const feed = actor === 'all' ? shown : shown.filter((event) => event.actor_kind === actor);

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
      {/*
        **The design's layout, not a stack** (prototype lines 719–816).

        Four panels across the top, then the activity feed beside a right rail.
        Ours ran every panel full width down the page, so the four figures a
        reader comes here for — progress, throughput, load, what is blocked —
        could not be seen together, which is the whole point of a dashboard.
      */}
      <div className="dash-row">
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

        <section className="dash-panel dash-decide" aria-label="Blocked work">
          <h2 className="dash-panel-label dash-decide-label">NEEDS A DECISION</h2>

          {/*
            The design leads with the figure and the age (prototype line 754):
            *how many, and how long has the oldest been waiting* is the question,
            and a list of keys does not answer it at a glance.
          */}
          <p className="dash-decide-figure">
            <span className="dash-decide-n">{blocked.length}</span>
            <span className="dash-decide-of">
              blocked
              {oldestBlocked !== undefined && ` · oldest ${oldestBlocked}`}
            </span>
          </p>

          {blocked.length === 0 ? (
            <p className="dash-empty">Nothing is waiting on an unfinished dependency.</p>
          ) : (
            <ul className="dash-blocked">
              {/*
                One line each, as the design writes them: `LAI-140 event store
                cursor · Tomás`. Who it is with matters more than what it is
                waiting on — that is the decision the panel is asking for.
              */}
              {blocked.slice(0, 4).map((row) => (
                <li key={row.task.id} className="dash-blocked-row" title={row.task.title}>
                  <span className="dash-key">{row.task.key}</span>
                  <span className="dash-blocked-title">{row.task.title}</span>
                  <span className="dash-blocked-who">
                    · {row.task.assignee_id === null ? 'unassigned' : nameFor(row.task.assignee_id)}
                  </span>
                </li>
              ))}
              {blocked.length > 4 && (
                <li className="dash-blocked-more">+{blocked.length - 4} more</li>
              )}
            </ul>
          )}
        </section>
      </div>

      <div className="dash-body">
        {/*
          **Not `dash-feed`** — that class already belongs to the `<ul>` of
          events below (`display: grid; padding: 0`), so putting it on the
          section stripped the panel's own padding and card. A class that reads
          right and is already taken is the easiest kind of collision to miss.
        */}
        <section className="dash-panel dash-feed-panel" aria-label="Recent activity">
          <h2 className="dash-panel-title">
            Activity
            {/*
            **The design's All · People · Agents filter** (prototype line 745).

            `actor_kind` is on every activity row (D-022), so this is a filter
            over what is already loaded rather than a second request — and the
            counts beside each name are the real split, which is what makes the
            badge on a row mean something.
          */}
            <span className="dash-feed-filters" role="group" aria-label="Filter activity">
              {(
                [
                  /*
                   * **Counted from `shown`, not from `kinds`.**
                   *
                   * `kinds` tallies every event in the range, including the verbs
                   * the feed declines (`FEED_SILENT`) — so it read `All 145` next
                   * to `People 155`, a filter claiming to show more than
                   * everything. A button's count must describe the list that
                   * button produces.
                   *
                   * The panel's own "154 events · 4 by agents" is a different
                   * claim — about what *happened*, not about what is listed — and
                   * that one deliberately keeps the whole range.
                   */
                  ['all', 'All', shown.length],
                  ['user', 'People', shown.filter((e) => e.actor_kind === 'user').length],
                  ['agent', 'Agents', shown.filter((e) => e.actor_kind === 'agent').length],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  className={actor === id ? 'dash-filter dash-filter-on' : 'dash-filter'}
                  aria-pressed={actor === id}
                  onClick={() => {
                    setActor(id);
                  }}
                >
                  {label} <span className="dash-filter-count">{count}</span>
                </button>
              ))}
            </span>
          </h2>

          {/*
            **The list scrolls inside the card.** 193 rows ran the page to five
            screens and left the rail beside a column of noise; the design's
            panel is a card of fixed height whose contents move, not the page.
          */}
          <div className="dash-feed-scroll">
            {feed.length === 0 ? (
              <EmptyState
                headline={
                  /*
                   * **Three reasons the list is empty, not two** (LAI-279). The
                   * filter added a third — "nobody of this kind acted" — and
                   * reporting it as "nothing worth showing" would blame the feed
                   * for a choice the reader just made.
                   */
                  actor !== 'all' && shown.length > 0
                    ? `No ${actor === 'agent' ? 'agent' : 'person'} activity in this range`
                    : events.length === 0
                      ? `Nothing in the ${range.label.toLowerCase()}`
                      : 'Nothing worth showing in this range'
                }
                body={
                  actor !== 'all' && shown.length > 0
                    ? 'Switch back to All to see everything in this range.'
                    : events.length === 0
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
                {feed.map((event) => {
                  const moved = statusChange(event);

                  return (
                    <li key={`${event.id}-${String(event.seq)}`} className="dash-event">
                      {/*
                      The design's row (prototype line 774): **when · who · what ·
                      which task**, in that order. Ours led with a `USER` badge
                      repeated down every row — a word that is the same on almost
                      all of them, taking the position the eye reads first.

                      The badge is gone; the avatar carries who, and the agent
                      mark rides on it as it does everywhere else.
                    */}
                      <time
                        className="dash-when"
                        dateTime={new Date(event.created_at).toISOString()}
                      >
                        {relativeTime(event.created_at, now)}
                      </time>

                      <span
                        className="dash-avatar"
                        style={avatarStyle(event.actor_id, theme)}
                        aria-hidden="true"
                      >
                        {initials(nameFor(event.actor_id))}
                        {event.actor_kind === 'agent' && (
                          <span className="dash-avatar-bot" aria-hidden="true" />
                        )}
                      </span>

                      <span className="dash-what">
                        <span className="dash-actor">{nameFor(event.actor_id)}</span>{' '}
                        {describeProjectEvent(event)}
                        {moved !== undefined && (
                          <span className="dash-move">
                            {' '}
                            {moved.from.replace('_', ' ')} → {moved.to.replace('_', ' ')}
                          </span>
                        )}
                        {/* Said in words too: the avatar's mark is not readable
                          by a screen reader, and `actor_kind` is the fact. */}
                        {event.actor_kind === 'agent' && (
                          <span className="visually-hidden"> (by an agent)</span>
                        )}
                      </span>
                      {/* The task the event is about, right-aligned as the
                        design has it — a column the eye can run down. */}
                      {event.task_id !== null && (
                        <span className="dash-event-key">
                          {tasks.find((t) => t.id === event.task_id)?.key ?? ''}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/*
          The design's right rail (prototype lines 780–812): what has gone
          quiet, and what the agents did today. Both are counted from the same
          tasks and activity the panels above use — no second source, so they
          cannot disagree with the feed beside them.
        */}
        <aside className="dash-rail" aria-label="Attention">
          <section className="dash-panel dash-stale">
            <h2 className="dash-panel-title">
              Stale · 5+ days quiet
              <span className="dash-panel-meta">{stale.length}</span>
            </h2>
            {stale.length === 0 ? (
              <p className="dash-empty">Everything has moved in the last five days.</p>
            ) : (
              <ul className="dash-stale-list">
                {stale.map((task) => (
                  <li key={task.id} className="dash-stale-row">
                    <span className="dash-stale-title">{task.title}</span>
                    <span className="dash-stale-meta">
                      <span className="dash-key">{task.key}</span>
                      <span className="dash-stale-age">
                        {updatedAge(task.updated_at, now)} quiet
                      </span>
                      <span className="dash-stale-status">{statusLabel(task.status)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dash-panel dash-agentlog">
            <h2 className="dash-panel-title">Agent log · this window</h2>
            {/*
              **Counted, not estimated.** `actor_kind` is on every activity row
              (D-022), so "what the agents did" is a filter over the feed rather
              than a second measurement of it.
            */}
            <p className="dash-agentlog-figures">
              <span className="dash-agentlog-n">{kinds.agent}</span> agent{' '}
              {kinds.agent === 1 ? 'event' : 'events'} · {agentTasks}{' '}
              {agentTasks === 1 ? 'task' : 'tasks'} touched
            </p>
            {agentLog.length === 0 ? (
              <p className="dash-empty">No agent has acted in this window.</p>
            ) : (
              <ul className="dash-agentlog-list">
                {agentLog.map((row) => (
                  <li key={row.name} className="dash-agentlog-row">
                    <span className="dash-agentlog-who">{row.name}</span>
                    <span className="dash-agentlog-count">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

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
    </div>
  );
}
