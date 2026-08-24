import { useCallback, useEffect, useMemo, useState } from 'react';
import { byIdIndex, groupByColumn, type BoardColumn } from './board-derive.ts';
import { ApiError } from './errors.ts';
import { changeStatus, listTasks, type Task, type TaskFilter } from './tasks.ts';

export interface BoardState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly tasks: readonly Task[];
  readonly error: unknown;
}

export interface UseBoard {
  readonly state: BoardState;
  readonly columns: Record<BoardColumn, Task[]>;
  readonly byId: ReadonlyMap<string, Task>;
  /** Set while a drop is in flight, so the card can show it is moving. */
  readonly movingId: string | undefined;
  /** The server's reason for refusing the last move. Cleared on the next one. */
  readonly moveError: string | undefined;
  readonly move: (taskId: string, to: BoardColumn) => Promise<void>;
  readonly reload: () => void;
  readonly dismissMoveError: () => void;
}

/**
 * The board's data.
 *
 * **Moves are not optimistic, deliberately** (LAI-049): the server validates
 * transitions (§5) and rejects illegal ones, so a card that jumps on drop and
 * snaps back a moment later has told the user something false in between. The
 * card is marked as moving, the request is awaited, and only the server's answer
 * moves it — correctness first. Smoothing that is a separate task, and it should
 * be, because the smooth version is where the lie lives.
 *
 * **No polling.** SSE (LAI-048) has not landed; `reload()` is the single seam a
 * subscription will call, and it is wired to a visible control rather than a
 * timer nobody remembers to remove.
 */
export function useBoard(slug: string | undefined, filter: TaskFilter): UseBoard {
  const [state, setState] = useState<BoardState>({
    status: 'loading',
    tasks: [],
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [movingId, setMovingId] = useState<string | undefined>(undefined);
  const [moveError, setMoveError] = useState<string | undefined>(undefined);

  const { status: filterStatus, priority, assignee, ready } = filter;

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));

    listTasks(
      slug,
      {
        ...(filterStatus === undefined ? {} : { status: filterStatus }),
        ...(priority === undefined ? {} : { priority }),
        ...(assignee === undefined ? {} : { assignee }),
        ...(ready === undefined ? {} : { ready }),
        limit: 200,
      },
      controller.signal,
    )
      .then((page) => {
        setState({ status: 'ready', tasks: page.data, error: null });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({ status: 'error', tasks: [], error: cause });
      });

    return () => {
      controller.abort();
    };
  }, [slug, filterStatus, priority, assignee, ready, attempt]);

  const move = useCallback(async (taskId: string, to: BoardColumn): Promise<void> => {
    setMoveError(undefined);
    setMovingId(taskId);

    try {
      const updated = await changeStatus(taskId, to);
      // Replace with the server's version rather than patching the status: the
      // move also changes `updated_at`, and may change `ready` if this task was
      // some other task's last blocker.
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === updated.id ? updated : t)),
      }));
    } catch (cause) {
      // The card never moved, so there is nothing to undo — that is the whole
      // point of awaiting. Surface the server's reason verbatim; it is more
      // specific than anything invented here ("done cannot go back to backlog").
      setMoveError(cause instanceof ApiError ? cause.message : 'That move could not be saved.');
    } finally {
      setMovingId(undefined);
    }
  }, []);

  const columns = useMemo(() => groupByColumn(state.tasks), [state.tasks]);
  const byId = useMemo(() => byIdIndex(state.tasks), [state.tasks]);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  const dismissMoveError = useCallback((): void => {
    setMoveError(undefined);
  }, []);

  return { state, columns, byId, movingId, moveError, move, reload, dismissMoveError };
}
