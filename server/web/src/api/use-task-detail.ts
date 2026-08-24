import { useCallback, useEffect, useState } from 'react';
import { listTaskActivity, type ActivityEvent } from './activity.ts';
import { addComment, isComment, listComments, type Comment } from './comments.ts';

export interface TaskDetail {
  readonly status: 'loading' | 'ready' | 'error';
  readonly comments: readonly Comment[];
  readonly activity: readonly ActivityEvent[];
  /** The first failure that mattered — comments and activity load together. */
  readonly error: unknown;
}

export interface UseTaskDetail extends TaskDetail {
  readonly posting: boolean;
  readonly postError: unknown;
  readonly post: (bodyMd: string) => Promise<void>;
  readonly reload: () => void;
}

/**
 * Everything the slide-over shows beyond the task itself.
 *
 * Comments and activity load together because the panel is useless with one of
 * them: a thread with no history, or history with no thread, is a panel that
 * looks broken. One error state, one retry.
 *
 * Tombstones are dropped rather than rendered (§6.3) — a deleted comment is a
 * removal, and drawing one gives an empty bubble with no author.
 */
export function useTaskDetail(slug: string | undefined, taskId: string | undefined): UseTaskDetail {
  const [state, setState] = useState<TaskDetail>({
    status: 'loading',
    comments: [],
    activity: [],
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<unknown>(null);

  useEffect(() => {
    if (slug === undefined || taskId === undefined) return;

    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));

    Promise.all([
      listComments(taskId, controller.signal),
      listTaskActivity(slug, taskId, controller.signal),
    ])
      .then(([comments, activity]) => {
        setState({
          status: 'ready',
          // Oldest-first from the server (LAI-047); left in that order.
          comments: comments.data.filter(isComment),
          // Newest-first from the server (LAI-055); also left alone.
          activity: activity.data,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({ status: 'error', comments: [], activity: [], error: cause });
      });

    return () => {
      controller.abort();
    };
  }, [slug, taskId, attempt]);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  const post = useCallback(
    async (bodyMd: string): Promise<void> => {
      if (taskId === undefined) return;

      setPosting(true);
      setPostError(null);
      try {
        const comment = await addComment(taskId, bodyMd);
        // Append rather than refetch: the server has just told us the row, and
        // a refetch would also re-pull the activity feed for one new line.
        setState((s) => ({ ...s, comments: [...s.comments, comment] }));
        // The comment produced an activity row too, so the trail is now stale.
        setAttempt((n) => n + 1);
      } catch (cause) {
        setPostError(cause);
      } finally {
        setPosting(false);
      }
    },
    [taskId],
  );

  return { ...state, posting, postError, post, reload };
}
