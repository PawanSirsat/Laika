import { useEffect, useMemo, useState } from 'react';
import { staleTasks } from '../../../api/board-derive.ts';
import { everyPage } from '../../../api/every-page.ts';
import { listProjects } from '../../../api/projects.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { PRIORITIES } from '../../../api/tasks.ts';
import { activeSprintId } from '../board/filter-keys.ts';
import { CardField, CardFilter, CardSelect } from './CardFilter.tsx';
import {
  ACTIVE_SPRINT,
  ALL_TASKS,
  blockedIdsOf,
  cardTasks,
  PEOPLE_KEYS,
  peopleCardActive,
  rangeApplies,
  readPeopleCard,
  readStatusCard,
  STATUS_KEYS,
  statusCardActive,
  UNASSIGNED,
} from './card-filters.ts';
import { pickProject } from '../../../api/pick-project.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { useShell } from '../../../components/shell/shell-context.ts';
import { SpaceSlot, useClaimSpaceFilters } from '../../../components/space/SpaceSlot.tsx';
import { useDelayed } from '../../../components/use-delayed.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { withProjectParam } from '../../nav-url.ts';
import { useRoute } from '../../use-route.ts';
import { ActivityFeed } from './ActivityFeed.tsx';
import { Contributors } from './Contributors.tsx';
import { contributors } from './contributors-derive.ts';
import {
  blockedTasks,
  DEFAULT_RANGE,
  RANGES,
  rangeById,
  sinceFor,
  statusBreakdown,
} from './dashboard-derive.ts';
import { NeedsAttention } from './NeedsAttention.tsx';
import { PriorityBreakdown } from './PriorityBreakdown.tsx';
import { StatCards } from './StatCards.tsx';
import { StatusOverview } from './StatusOverview.tsx';
import {
  MAX_PEOPLE,
  completedIn,
  priorityBreakdown,
  splitBlocked,
  waitingForReview,
  windowCounts,
  workloadByPerson,
} from './summary-derive.ts';
import { Throughput } from './Throughput.tsx';
import { useDashboard } from './use-dashboard.ts';
import { clockTime } from '../../../api/time-label.ts';
import './dashboard.css';

/**
 * Dashboard (SPEC §11.4.2.1 — LAI-085, reshaped by LAI-711, D-072).
 *
 * **Jira's project Summary, for a board shared with agents.** Four figures
 * across the top — done, touched, created, due soon — then the status donut
 * beside Contributors (who delivered in the range, and open work now), the
 * activity feed beside what needs attention, and priority beside throughput
 * and cycle time.
 *
 * ## Every number is derived from a response
 *
 * Counts come from the task list, the feed from `activity`, done and
 * throughput from `/metrics`. Nothing is a fixture; where a number is not known
 * yet the page shows a dash, not a guess.
 *
 * ## The range drives the query, and the page never blanks
 *
 * `?since=` is what the endpoints support, so changing the range refetches
 * rather than trimming a list. After the first load every refetch — a range
 * change, a Retry, a live frame — swaps the numbers in place.
 */
export function DashboardScreen() {
  const { params, setParams } = useRoute();
  const { theme } = useTheme();
  /*
   * **When each task moved into review, at any age** (LAI-832): the shell's
   * one read of `GET /review`, for the sidebar's badge — asked for nothing
   * more here. The range's activity sees back only as far as the range, so a
   * wait read from it alone moved with the range picker.
   */
  const { reviewQueue } = useShell();
  const reviewEntered = useMemo(
    () => new Map((reviewQueue ?? []).map((item) => [item.task.id, item.waiting_since] as const)),
    [reviewQueue],
  );
  /*
   * **The bar's task filters do nothing here** (LAI-711): Priority, Assignee,
   * Ready and Search narrow a list of cards, and the dashboard summarises the
   * whole space — it never read them, so they sat above it doing nothing. Its
   * own control is the range; claiming the space's filtering hands the bar's
   * copies back the moment the reader leaves.
   */
  useClaimSpaceFilters();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);
  /** The organisation has no project to show — not "loading" for ever. */
  const [noProject, setNoProject] = useState(false);

  // Fixed per range change, not per render: every "3 hours ago" on the page is
  // measured from it, and a moving clock would make rows disagree with each other.
  const [now, setNow] = useState(() => Date.now());

  const range = rangeById(params.get('range') ?? DEFAULT_RANGE);
  const since = useMemo(() => sinceFor(range, now), [range, now]);

  useEffect(() => {
    const controller = new AbortController();

    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        // One rule on every screen (LAI-423): the most recently active
        // project, written into the URL so the address bar names what is on
        // screen.
        const wanted = pickProject(items, slug);
        setSlug(wanted?.slug);
        setNoProject(wanted === undefined);
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

  /*
   * **The sprints, for the cards' Sprint filter** (LAI-732). The shell already
   * reads this list for its count, so it is a cached answer (`client.ts`),
   * not a new request. `undefined` until it lands: a `so_sprint=` id is not
   * applied before it can be checked.
   */
  const [sprints, setSprints] = useState<{ slug: string; list: readonly Sprint[] } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    everyPage((cursor) =>
      listSprints(slug, cursor === undefined ? {} : { cursor }, controller.signal),
    )
      .then(({ items }) => {
        if (!controller.signal.aborted) setSprints({ slug, list: items });
      })
      .catch(() => {
        // No sprint options; the filter offers Any and Active only.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);
  const loading = dashboard.state.status === 'loading' && !noProject;
  const showSkeleton = useDelayed(loading);

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

  if (noProject) {
    return (
      <div className="dash">
        <EmptyState
          headline="No space to summarise"
          body="Create a space, and its dashboard appears here."
        />
      </div>
    );
  }

  if (dashboard.state.status === 'loading') {
    return (
      <div className="dash">
        <SpaceSlot>{rangeControl}</SpaceSlot>
        {/* Nothing for the first moments, then a skeleton held long enough
            not to flash (LAI-293) — a fast answer never blinks. */}
        {showSkeleton && <LoadingState shape="card" count={3} label="Loading dashboard" />}
      </div>
    );
  }

  if (dashboard.state.status === 'error' || slug === undefined) {
    return (
      <div className="dash">
        <ApiErrorState
          error={dashboard.state.status === 'error' ? dashboard.state.error : null}
          resource="this project's dashboard"
          scope="project"
          onRetry={dashboard.reload}
        />
      </div>
    );
  }

  const { tasks, events, members, names, truncated, refreshing, refreshError, asOf } =
    dashboard.state;
  /*
   * **The clock the page reads by is the last answer's**, not the moment the
   * range was picked. `now` anchors the query window and must stay put — moving
   * it would move `since` and refetch for ever — but a live refresh brings
   * events newer than it, and "just now" on all of them would be wrong.
   */
  const clock = Math.max(now, asOf);
  const nameOf = (id: string): string => names.get(id) ?? id;
  const actorName = (id: string | null): string => (id === null ? 'Laika' : nameOf(id));
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  const window = range.ms === null ? 'all time' : `in the ${range.label.toLowerCase()}`;
  /*
   * **What the two cards count** (LAI-732, LAI-817): Status overview, the
   * tasks touched in the range — the "N touched" rule — and its own filter.
   * Contributors never reads the range off tasks: Delivered counts the range's
   * *activity*, and Open work now has no range at all (D-092). Each card's
   * filter is in the URL; with no filter and All time, each is the whole set.
   */
  const sprintList = sprints?.slug === slug ? sprints.list : undefined;
  const known = {
    sprintIds: sprintList === undefined ? undefined : new Set(sprintList.map((s) => s.id)),
    memberIds: new Set(members.keys()),
  };
  const ctx = {
    since,
    activeSprintId: sprintList === undefined ? undefined : activeSprintId(sprintList),
  };
  const statusFilter = readStatusCard(params, known);
  const peopleFilter = readPeopleCard(params, known);
  const statusTasks = cardTasks(tasks, statusFilter, ctx);
  const peopleTasks = cardTasks(tasks, peopleFilter, ctx);
  const statusActive = statusCardActive(statusFilter);
  const peopleActive = peopleCardActive(peopleFilter);
  const statusCard = statusBreakdown(statusTasks);
  const openNow = workloadByPerson(peopleTasks, nameOf, MAX_PEOPLE, {
    blockedIds: blockedIdsOf(tasks),
  });
  /*
   * **Who delivered, from the range's activity** (D-092 item 1). The card's
   * filter narrows the tasks counted; the assignee stands in for a delivery
   * made before the range began. Which moves count is the events' business:
   * a rule that sets bulk imports aside (LAI-823) filters `events` first.
   */
  const peopleTaskIds = peopleActive > 0 ? new Set(peopleTasks.map((t) => t.id)) : undefined;
  const contributorList = contributors(events, nameOf, {
    include: peopleTaskIds === undefined ? undefined : (id) => peopleTaskIds.has(id),
    assigneeOf: (id) => tasksById.get(id)?.assignee_id,
  });
  const blocked = splitBlocked(blockedTasks(tasks));

  /** "touched in the last 7 days", "· all time", "· 2 filters" — what a card covers. */
  const scopeSuffix = (filter: { readonly allTasks: boolean }, active: number): string => {
    const narrowing = active - (filter.allTasks ? 1 : 0);
    return (
      (rangeApplies(filter, ctx)
        ? ` touched ${window}`
        : filter.allTasks && since !== undefined
          ? ' · all time'
          : '') +
      (narrowing > 0 ? ` · ${String(narrowing)} ${narrowing === 1 ? 'filter' : 'filters'}` : '')
    );
  };
  const statusScope = `${String(statusCard.live)} ${statusCard.live === 1 ? 'task' : 'tasks'}${scopeSuffix(statusFilter, statusActive)}`;

  /** One URL key, or several, written at once; `undefined` deletes. */
  const setCard = (changes: Readonly<Record<string, string | undefined>>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const clearAll = (keys: Readonly<Record<string, string>>): void => {
    setCard(Object.fromEntries(Object.values(keys).map((key) => [key, undefined])));
  };

  const sprintOptions: readonly (readonly [string, string])[] = [
    ['', 'Any'],
    [ACTIVE_SPRINT, 'Active sprint'],
    ...(sprintList ?? []).map((s, i) => [s.id, `S${String(i + 1)} · ${s.name}`] as const),
  ];
  const priorityOptions: readonly (readonly [string, string])[] = [
    ['', 'Any'],
    ...PRIORITIES.map((p) => [p, p.toUpperCase()] as const),
  ];
  const labels = [...new Set(tasks.flatMap((t) => t.tags))].sort();
  const labelOptions: readonly (readonly [string, string])[] = [
    ['', 'Any'],
    ...labels.map((l) => [l, l] as const),
  ];
  const rangeOptions: readonly (readonly [string, string])[] = [
    ['', 'Follow dashboard range'],
    [ALL_TASKS, 'All tasks'],
  ];

  const statusFilterControl = (
    <CardFilter
      title="Status overview"
      active={statusActive}
      onClear={() => {
        clearAll(STATUS_KEYS);
      }}
    >
      <CardField label="Sprint" set={statusFilter.sprint !== undefined}>
        <CardSelect
          value={statusFilter.sprint ?? ''}
          noun="sprints"
          options={sprintOptions}
          onChange={(v) => {
            setCard({ [STATUS_KEYS.sprint]: v });
          }}
        />
      </CardField>
      <CardField label="Assignee" set={statusFilter.assignee !== undefined}>
        <CardSelect
          value={statusFilter.assignee ?? ''}
          options={[
            ['', 'Anyone'],
            [UNASSIGNED, 'Unassigned'],
            ...[...members.values()]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => [m.user_id, m.name] as const),
          ]}
          onChange={(v) => {
            setCard({ [STATUS_KEYS.assignee]: v });
          }}
        />
      </CardField>
      <CardField label="Priority" set={statusFilter.priority !== undefined}>
        <CardSelect
          value={statusFilter.priority ?? ''}
          options={priorityOptions}
          onChange={(v) => {
            setCard({ [STATUS_KEYS.priority]: v });
          }}
        />
      </CardField>
      <CardField label="Label" set={statusFilter.tag !== undefined}>
        <CardSelect
          value={statusFilter.tag ?? ''}
          noun="labels"
          options={labelOptions}
          onChange={(v) => {
            setCard({ [STATUS_KEYS.tag]: v });
          }}
        />
      </CardField>
      <CardField label="Created by" set={statusFilter.agentOnly}>
        <CardSelect
          value={statusFilter.agentOnly ? 'true' : ''}
          options={[
            ['', 'Anyone'],
            ['true', 'Agents only'],
          ]}
          onChange={(v) => {
            setCard({ [STATUS_KEYS.agent]: v });
          }}
        />
      </CardField>
      <CardField wide label="Range" set={statusFilter.allTasks}>
        <CardSelect
          value={statusFilter.allTasks ? ALL_TASKS : ''}
          options={rangeOptions}
          onChange={(v) => {
            setCard({ [STATUS_KEYS.range]: v });
          }}
        />
      </CardField>
    </CardFilter>
  );

  const peopleFilterControl = (
    <CardFilter
      title="Contributors"
      active={peopleActive}
      onClear={() => {
        clearAll(PEOPLE_KEYS);
      }}
    >
      <CardField label="Sprint" set={peopleFilter.sprint !== undefined}>
        <CardSelect
          value={peopleFilter.sprint ?? ''}
          noun="sprints"
          options={sprintOptions}
          onChange={(v) => {
            setCard({ [PEOPLE_KEYS.sprint]: v });
          }}
        />
      </CardField>
      <CardField label="Priority" set={peopleFilter.priority !== undefined}>
        <CardSelect
          value={peopleFilter.priority ?? ''}
          options={priorityOptions}
          onChange={(v) => {
            setCard({ [PEOPLE_KEYS.priority]: v });
          }}
        />
      </CardField>
      <CardField label="Label" set={peopleFilter.tag !== undefined}>
        <CardSelect
          value={peopleFilter.tag ?? ''}
          noun="labels"
          options={labelOptions}
          onChange={(v) => {
            setCard({ [PEOPLE_KEYS.tag]: v });
          }}
        />
      </CardField>
    </CardFilter>
  );

  const breakdown = statusBreakdown(tasks);
  const metricsDone =
    dashboard.metrics.status === 'ready'
      ? completedIn(dashboard.metrics.view.throughput)
      : undefined;
  // All time has no window for `/metrics` to sum (it answers its own 30 days),
  // so all-time done is the task list's own count.
  const done = range.ms === null ? breakdown.done : metricsDone;

  return (
    <div className="dash" aria-busy={refreshing || undefined}>
      <SpaceSlot
        /* What the numbers below cover. `truncated` means the lists hit their
           page cap, so the totals are a floor and the context says so. */
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
      {refreshError !== null && (
        <p className="dash-note dash-note-stale" role="status">
          Could not refresh — this is the dashboard as of {clockTime(asOf)}.{' '}
          <button type="button" className="dash-note-retry" onClick={dashboard.reload}>
            Retry
          </button>
        </p>
      )}

      <StatCards done={done} counts={windowCounts(tasks, since, clock)} window={window} />

      <div className="dash-grid">
        <StatusOverview
          breakdown={statusCard}
          slug={slug}
          scope={statusScope}
          narrowed={statusTasks !== tasks}
          touchedOnly={rangeApplies(statusFilter, ctx)}
          filter={statusFilterControl}
        />
        <Contributors
          contributors={contributorList}
          workload={openNow}
          nameOf={nameOf}
          slug={slug}
          theme={theme}
          window={window}
          allTime={range.ms === null}
          filters={peopleActive}
          narrowed={peopleActive > 0}
          filter={peopleFilterControl}
        />
        <ActivityFeed
          events={events}
          tasksById={tasksById}
          nameOf={actorName}
          slug={slug}
          now={clock}
          rangeLabel={range.label}
          theme={theme}
        />
        <NeedsAttention
          blocked={blocked.committed}
          blockedApart={blocked.apart}
          stale={staleTasks(tasks)}
          review={waitingForReview(tasks, events, since, clock, reviewEntered)}
          nameOf={nameOf}
          slug={slug}
          now={clock}
        />
        <PriorityBreakdown counts={priorityBreakdown(tasks)} slug={slug} />
        <Throughput
          metrics={dashboard.metrics}
          window={range.ms === null ? 'in the last 30 days' : window}
        />
      </div>
    </div>
  );
}
