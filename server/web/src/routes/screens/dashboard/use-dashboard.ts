import { useCallback, useEffect, useRef, useState } from 'react';
import { shownInFeed, type ActivityEvent } from '../../../api/activity.ts';
import { request } from '../../../api/client.ts';
import { ApiError } from '../../../api/errors.ts';
import { listMembers, type Member } from '../../../api/members.ts';
import { listMentionable } from '../../../api/mentions.ts';
import { getMetrics, type MetricsView } from '../../../api/metrics.ts';
import { listTasks, type Page, type Task } from '../../../api/tasks.ts';
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
 * ## Refreshes in place, and follows the stream (LAI-711)
 *
 * Only the first load of a project is `loading`. A range change, a Retry or a
 * live frame keeps the page on screen with `refreshing` set and swaps the
 * numbers when they arrive — the board's rule since LAI-707, for the same
 * reason: a page that blanks on every change reads as broken. A refresh that
 * fails keeps what is shown and says so, unless the reader has lost access.
 */

const MAX_PAGES = 20;
const PAGE_LIMIT = 200;

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

async function walk<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<[T[], boolean]> {
  const all: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    all.push(...result.data);
    if (result.next_cursor === null || result.next_cursor === undefined) return [all, false];
    cursor = result.next_cursor;
  }

  return [all, true];
}

/**
 * The project feed.
 *
 * Written here rather than in `api/activity.ts`: that module is Builder-B's and
 * only has the task-scoped call the detail panel needs. Adding the project-wide
 * one there is LAI-123; this uses the shared `request` client so it still goes
 * through one place that knows how to talk to the API.
 */
function listProjectActivity(
  slug: string,
  query: { since?: number | undefined; cursor?: string | undefined },
  signal?: AbortSignal,
): Promise<Page<ActivityEvent>> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (query.since !== undefined) params.set('since', String(query.since));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);

  return request<Page<ActivityEvent>>(
    `/projects/${encodeURIComponent(slug)}/activity?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

export function useDashboard(slug: string | undefined, since: number | undefined): UseDashboard {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });
  const [metrics, setMetrics] = useState<MetricsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  /** Which project's answer is on screen — a different one is a first load. */
  const onScreen = useRef<string | undefined>(undefined);
  const metricsFor = useRef<string | undefined>(undefined);

  /*
   * **Live**: the space already holds one stream (`SpaceLive`), and bumps
   * `generation` on every frame. A burst — an agent moving ten tasks — settles
   * into one refetch rather than ten.
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

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    const same = onScreen.current === slug;
    if (same) {
      setState((prev) => (prev.status === 'ready' ? { ...prev, refreshing: true } : prev));
    } else {
      onScreen.current = undefined;
      setState({ status: 'loading' });
    }

    Promise.all([
      walk<Task>((cursor) =>
        listTasks(
          slug,
          cursor === undefined ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, cursor },
          controller.signal,
        ),
      ),
      walk<ActivityEvent>((cursor) =>
        listProjectActivity(
          slug,
          {
            ...(since === undefined ? {} : { since }),
            ...(cursor === undefined ? {} : { cursor }),
          },
          controller.signal,
        ),
      ),
      // Names. A failure here must not fail the dashboard — the rows fall
      // back to the raw id, which is worse but still true.
      listMembers(slug, controller.signal).catch(() => ({ members: [] as Member[] })),
      listMentionable(slug, controller.signal).catch(() => ({ users: [] })),
    ])
      .then(([[tasks, tasksCut], [events, eventsCut], memberList, mentionable]) => {
        const names = new Map<string, string>();
        for (const user of mentionable.users) names.set(user.id, user.name);
        for (const member of memberList.members) names.set(member.user_id, member.name);
        onScreen.current = slug;
        setState({
          status: 'ready',
          tasks,
          // Reorders are recorded, never read as activity (LAI-473).
          events: shownInFeed(events),
          members: new Map(memberList.members.map((m) => [m.user_id, m])),
          names,
          truncated: tasksCut || eventsCut,
          refreshing: false,
          refreshError: null,
          asOf: Date.now(),
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (same && !isFatal(cause)) {
          setState((prev) =>
            prev.status === 'ready'
              ? { ...prev, refreshing: false, refreshError: cause }
              : { status: 'error', error: cause },
          );
          return;
        }
        onScreen.current = undefined;
        setState({ status: 'error', error: cause });
      });

    return () => {
      controller.abort();
    };
  }, [slug, since, attempt, tick]);

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
    setAttempt((n) => n + 1);
  }, []);

  return { state, metrics, reload };
}
