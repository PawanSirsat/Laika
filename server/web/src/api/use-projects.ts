import { useCallback, useEffect, useState } from 'react';
import { applyProjectRows, listProjects, type Project, type ProjectRow } from './projects.ts';

export interface UseProjects {
  readonly status: 'loading' | 'ready' | 'error';
  readonly projects: readonly Project[];
  readonly error: unknown;
  /** Present while there are more pages (§6.3). */
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
  readonly reload: () => void;
  /** Fold a newly created project in without refetching the list. */
  readonly add: (project: Project) => void;
}

/**
 * The project list, paginated.
 *
 * **Tombstones are removals, not rows.** `{ id, deleted: true }` comes back for
 * archived projects (§6.3) and is applied as a delete against what we hold —
 * rendering one as a card gives a nameless entry with an undefined slug, which
 * reads as an API bug and is not one.
 *
 * They only appear with `updated_since`, which this hook does not send on the
 * first page. It handles them anyway: the shape is part of the contract for
 * every page of this endpoint, and code that only works because of the query it
 * happens to send is code that breaks when someone adds a parameter.
 */
export function useProjects(): UseProjects {
  const [status, setStatus] = useState<UseProjects['status']>('loading');
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /**
   * Apply a page. The merge itself is `applyProjectRows` in `projects.ts` —
   * pure, so the tombstone rule is unit-tested rather than trapped in here
   * where this package has no renderer to reach it.
   */
  const apply = useCallback((rows: readonly ProjectRow[], replace: boolean): void => {
    setProjects((current) => applyProjectRows(current, rows, replace ? 'replace' : 'merge'));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');

    listProjects({ limit: 50 }, controller.signal)
      .then((page) => {
        apply(page.data, true);
        setNextCursor(page.next_cursor);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
        setStatus('error');
      });

    return () => {
      controller.abort();
    };
  }, [apply, attempt]);

  const loadMore = useCallback((): void => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);

    listProjects({ cursor: nextCursor, limit: 50 })
      .then((page) => {
        apply(page.data, false);
        setNextCursor(page.next_cursor);
      })
      .catch((cause: unknown) => {
        // A failed *next* page must not discard the pages already shown — the
        // list stays usable and the error is about the fetch, not the data.
        setError(cause);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [nextCursor, loadingMore, apply]);

  const add = useCallback(
    (project: Project): void => {
      apply([project], false);
    },
    [apply],
  );

  const reload = useCallback((): void => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { status, projects, error, nextCursor, loadingMore, loadMore, reload, add };
}
