import { useCallback, useEffect, useRef, useState } from 'react';
import { listOrgHistory, type ActivityEvent, type HistoryQuery } from '../../../api/activity.ts';

export type OrgHistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly rows: readonly ActivityEvent[];
      /** `null` once the last page is in. */
      readonly next: string | null;
      readonly loadingMore: boolean;
      /** Why the last *Load more* failed; the rows already shown stay. */
      readonly moreError: unknown;
    };

export interface UseOrgHistory {
  readonly state: OrgHistoryState;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

/**
 * The organisation's history for one set of filters (LAI-951): the first page,
 * then one more per *Load more*, walking `next_cursor`.
 *
 * **A page at a time, on purpose.** This is every row the organisation has ever
 * written; reading it whole before drawing anything is the one thing a history
 * this size must not do. A filter change starts again from the newest row.
 */
export function useOrgHistory(query: HistoryQuery): UseOrgHistory {
  const [state, setState] = useState<OrgHistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(query);
  /** The filters the rows on screen belong to, so a late page cannot land on new ones. */
  const current = useRef(key);
  const more = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    current.current = key;
    more.current?.abort();
    setState({ status: 'loading' });

    listOrgHistory(JSON.parse(key) as HistoryQuery, undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'ready',
          rows: page.data,
          next: page.next_cursor,
          loadingMore: false,
          moreError: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error });
      });

    return () => {
      controller.abort();
    };
  }, [key, attempt]);

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || state.next === null || state.loadingMore) return;
    const asked = key;
    const controller = new AbortController();
    more.current = controller;
    setState({ ...state, loadingMore: true, moreError: null });

    listOrgHistory(JSON.parse(key) as HistoryQuery, state.next, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || current.current !== asked) return;
        setState((was) =>
          was.status === 'ready'
            ? {
                ...was,
                rows: [...was.rows, ...page.data],
                next: page.next_cursor,
                loadingMore: false,
              }
            : was,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || current.current !== asked) return;
        setState((was) =>
          was.status === 'ready' ? { ...was, loadingMore: false, moreError: error } : was,
        );
      });
  }, [key, state]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(
    () => () => {
      more.current?.abort();
    },
    [],
  );

  return { state, loadMore, reload };
}
