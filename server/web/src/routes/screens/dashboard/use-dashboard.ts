import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shownInFeed, type ActivityEvent } from '../../../api/activity.ts';
import type { ActivityWindow } from '../../../api/activity-store.ts';
import { ApiError } from '../../../api/errors.ts';
import { listMembers, type Member } from '../../../api/members.ts';
import { listMentionable } from '../../../api/mentions.ts';
import { getMetrics, type MetricsView } from '../../../api/metrics.ts';
import { activityStore, taskStore } from '../../../api/store.ts';
import type { Task } from '../../../api/tasks.ts';
import { useProjectTasks } from '../../../api/use-project-tasks.ts';
import { useLive } from '../../../components/space/SpaceLive.tsx';

/**
 * The dashboard's data (LAI-085).
 *
 * ## The activity request is bounded by the range, not by a page count
 *
 * `?since=` is the filter the endpoint already supports (§6.3, inclusive lower
 * bound), so the range control drives the query rather than trimming a fixed
 * page client-side. That matters for the empty state: "nothing happened in the
 * last 24 hours" is a fact about the range, and it is only true if the server
 * was asked about the range.
 *
 * Both lists walk their cursor with a runaway guard. Reaching it sets
 * `truncated` and the screen says so — a dashboard that silently counted the
 * first page would put a confidently wrong number in front of someone making a
 * decision, which is worse than no number.
 *
 * ## Read from the store, caught up incrementally (LAI-723, LAI-724)
 *
 * The tasks are the project's one set (`task-store.ts`), shared with every
 * other screen. The activity is a window kept by `activity-store.ts`: read in
 * full once, then **caught up with only what is newer** on each burst of live
 * frames — one small request, never a re-walk, and never cancelled by the next
 * frame, which is how "All time" used to stay stale. Members and mentionable
 * names are read once per project, not per frame.
 *
 * ## Refreshes in place, and follows the stream (LAI-711)
 *
 * Only the first load of a project is `loading`. A range change, a Retry or a
 * live frame keeps the page on screen with `refreshing` set and swaps the
 * numbers when they arrive — the board's rule since LAI-707, for the same
 * reason: a page that blanks on every change reads as broken. A refresh that
 * fails keeps what is shown and says so, unless the reader has lost access.
 */

export type DashboardState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly tasks: readonly Task[];
      readonly events: readonly ActivityEvent[];
      readonly members: ReadonlyMap<string, Member>;
      /**
       * Everyone who can be named: members first, then the mentionable list,
       * which also carries an org owner or admin who leads by role and has no
       * membership row — the person the old dashboard showed as a raw id.
       */
      readonly names: ReadonlyMap<string, string>;
      readonly truncated: boolean;
      /** A refresh is in flight; what is shown is the last answer. */
      readonly refreshing: boolean;
      /** The last refresh failed; what is shown is from {@link asOf}. */
      readonly refreshError: unknown;
      readonly asOf: number;
    };

/** Throughput and cycle time — apart, so a failure here blanks nothing else. */
export type MetricsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly view: MetricsView };

export interface UseDashboard {
  readonly state: DashboardState;
  readonly metrics: MetricsState;
  readonly reload: () => void;
}

/** How long a burst of live frames is allowed to settle before one refetch. */
const LIVE_SETTLE_MS = 500;

/** Lost access is not a stale page — it replaces it. */
function isFatal(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    (cause.code === 'unauthorized' || cause.code === 'forbidden' || cause.code === 'not_found')
  );
}

type Ready = Extract<DashboardState, { readonly status: 'ready' }>;

interface People {
  readonly slug: string;
  readonly members: ReadonlyMap<string, Member>;
  readonly names: ReadonlyMap<string, string>;
}

export function useDashboard(slug: string | undefined, since: number | undefined): UseDashboard {
  const [metrics, setMetrics] = useState<MetricsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const metricsFor = useRef<string | undefined>(undefined);

  /** The project's one task set — live through the store. */
  const tasks = useProjectTasks(slug);

  /** The activity feed for the range — caught up through the store. */
  const [feed, setFeed] = useState<ActivityWindow | undefined>(undefined);
  useEffect(() => {
    if (slug === undefined) return;
    return activityStore.subscribe(slug, since, setFeed);
  }, [slug, since]);

  /*
   * Names, once per project. A failure here must not fail the dashboard — the
   * rows fall back to the raw id, which is worse but still true.
   */
  const [people, setPeople] = useState<People | undefined>(undefined);
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    Promise.all([
      listMembers(slug, controller.signal).catch(() => ({ members: [] as Member[] })),
      listMentionable(slug, controller.signal).catch(() => ({ users: [] })),
    ])
      .then(([memberList, mentionable]) => {
        if (controller.signal.aborted) return;
        const names = new Map<string, string>();
        for (const user of mentionable.users) names.set(user.id, user.name);
        for (const member of memberList.members) names.set(member.user_id, member.name);
        setPeople({
          slug,
          members: new Map(memberList.members.map((m) => [m.user_id, m])),
          names,
        });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  /*
   * **Live, for the metrics only**: the space already holds one stream
   * (`SpaceLive`), and bumps `generation` on every frame. A burst settles into
   * one re-read. Tasks and activity follow the stream through the store.
   */
  const { generation } = useLive();
  const seenGeneration = useRef(generation);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (generation === seenGeneration.current) return;
    seenGeneration.current = generation;
    const timer = window.setTimeout(() => {
      setTick((n) => n + 1);
    }, LIVE_SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [generation]);

  /** The last whole answer for this project — kept on screen while the next arrives. */
  const shown = useRef<Ready | undefined>(undefined);
  const shownFor = useRef<string | undefined>(undefined);

  const events = useMemo(
    () => (feed === undefined ? [] : shownInFeed(feed.events)),
    [feed?.events],
  );

  const state = useMemo((): DashboardState => {
    if (slug === undefined) return { status: 'loading' };
    const last = shownFor.current === slug ? shown.current : undefined;
    const failure =
      tasks?.status === 'error'
        ? tasks.error
        : feed?.slug === slug && feed.since === since && feed.status === 'error'
          ? feed.error
          : null;
    if (failure !== null) {
      if (last !== undefined && !isFatal(failure)) {
        return { ...last, refreshing: false, refreshError: failure };
      }
      return { status: 'error', error: failure };
    }

    const whole =
      tasks?.status === 'ready' &&
      feed?.slug === slug &&
      feed.since === since &&
      feed.status === 'ready' &&
      people?.slug === slug;
    if (!whole) return last === undefined ? { status: 'loading' } : { ...last, refreshing: true };

    return {
      status: 'ready',
      tasks: tasks.tasks,
      // Reorders are recorded, never read as activity (LAI-473).
      events,
      members: people.members,
      names: people.names,
      truncated: tasks.truncated || feed.truncated,
      refreshing: tasks.refreshing || feed.refreshing,
      refreshError: tasks.refreshError ?? feed.refreshError ?? null,
      asOf: Math.max(tasks.asOf ?? 0, feed.asOf ?? 0),
    };
  }, [slug, since, tasks, feed, events, people]);

  if (state.status === 'ready') {
    shown.current = state;
    shownFor.current = slug;
  } else if (state.status === 'error') {
    shown.current = undefined;
  }

  /*
   * Throughput and cycle time follow the same window and the same refreshes,
   * but in their own state: the endpoint that decides them failing must not
   * blank the counts, which come from a different request. The last answer
   * stays up while the next is in flight; a different project starts empty.
   */
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    if (metricsFor.current !== slug) setMetrics({ status: 'loading' });

    getMetrics(slug, since, controller.signal)
      .then((view) => {
        if (controller.signal.aborted) return;
        metricsFor.current = slug;
        setMetrics({ status: 'ready', view });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setMetrics((prev) =>
          prev.status === 'ready' && metricsFor.current === slug ? prev : { status: 'error' },
        );
      });

    return () => {
      controller.abort();
    };
  }, [slug, since, attempt, tick]);

  const reload = useCallback((): void => {
    if (slug !== undefined) {
      taskStore.reload(slug);
      activityStore.reload(slug);
    }
    setAttempt((n) => n + 1);
  }, [slug]);

  return { state, metrics, reload };
}
