import { useCallback, useEffect, useState } from 'react';
import type { ActivityEvent } from '../../../api/activity.ts';
import { request } from '../../../api/client.ts';
import { listMembers, type Member } from '../../../api/members.ts';
import { listTasks, type Page, type Task } from '../../../api/tasks.ts';

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
      readonly truncated: boolean;
    };

export interface UseDashboard {
  readonly state: DashboardState;
  readonly reload: () => void;
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    setState({ status: 'loading' });

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
      // Names for the feed. A failure here must not fail the dashboard — the
      // rows fall back to the raw id, which is worse but still true.
      listMembers(slug, controller.signal).catch(() => ({ members: [] as Member[] })),
    ])
      .then(([[tasks, tasksCut], [events, eventsCut], memberList]) => {
        setState({
          status: 'ready',
          tasks,
          events,
          members: new Map(memberList.members.map((m) => [m.user_id, m])),
          truncated: tasksCut || eventsCut,
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({ status: 'error', error: cause });
      });

    return () => {
      controller.abort();
    };
  }, [slug, since, attempt]);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  return { state, reload };
}
