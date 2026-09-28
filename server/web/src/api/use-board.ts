import { useCallback, useEffect, useMemo, useState } from 'react';
import { byIdIndex } from './board-derive.ts';
import { ApiError } from './errors.ts';
import { changeStatus, listTasks, type Task, type TaskFilter, type TaskStatus } from './tasks.ts';

export interface BoardState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly tasks: readonly Task[];
  readonly error: unknown;
  /**
   * Set when the page cap was reached and the server still had more.
   *
   * **A truncated board must never look like a whole one** (LAI-621). Every
   * count on screen is derived from `tasks`, so a silent stop makes the lane
   * headers state numbers that are not the project's — `TO DO 96` meaning
   * "96 among the ones we happened to load". The screen says so instead.
   */
  readonly truncated: boolean;
}

export interface UseBoard {
  readonly state: BoardState;
  readonly byId: ReadonlyMap<string, Task>;
  /** Set while a drop is in flight, so the card can show it is moving. */
  readonly movingId: string | undefined;
  /** The server's reason for refusing the last move. Cleared on the next one. */
  readonly moveError: string | undefined;
  readonly move: (taskId: string, to: TaskStatus) => Promise<void>;
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
/** Rows per request. The server's own maximum, so this is the fewest calls. */
const PAGE_SIZE = 200;

/**
 * How many pages we will follow before stopping and saying so.
 *
 * 25 × 200 is 5,000 tasks — far past any board we have seen, and bounded so a
 * cursor that never terminates cannot spin the screen forever. Reaching it is
 * reported, never swallowed.
 */
const MAX_PAGES = 25;

/**
 * Every task, not the first page of them (LAI-621).
 *
 * `listTasks` is cursor-paginated and this asked for `limit: 200` **once**,
 * taking the first page as the whole answer. Measured on the owner's live
 * board: 251 tasks existed, 200 were drawn, and the 51 missing ones were
 * invisible on the board, in the List, and in every lane count — with nothing
 * on screen to suggest it.
 *
 * The board needs the whole set rather than a window, because it derives
 * counts and groups from it: a partial list does not show less, it shows
 * *wrong*.
 */
async function fetchEveryPage(
  slug: string,
  filter: TaskFilter,
  signal: AbortSignal,
): Promise<{ readonly tasks: readonly Task[]; readonly truncated: boolean }> {
  const tasks: Task[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await listTasks(
      slug,
      { ...filter, limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
      signal,
    );
    tasks.push(...answer.data);

    if (answer.next_cursor === null) return { tasks, truncated: false };
    cursor = answer.next_cursor;
  }

  return { tasks, truncated: true };
}

export function useBoard(slug: string | undefined, filter: TaskFilter): UseBoard {
  const [state, setState] = useState<BoardState>({
    status: 'loading',
    tasks: [],
    error: null,
    truncated: false,
  });
  const [attempt, setAttempt] = useState(0);
  const [movingId, setMovingId] = useState<string | undefined>(undefined);
  const [moveError, setMoveError] = useState<string | undefined>(undefined);

  /**
   * Depend on the filter's **content**, not its identity or a hand-listed
   * subset.
   *
   * The object is rebuilt every render, so depending on it directly would
   * refetch forever. The previous fix for that was to destructure four named
   * fields and depend on those — which meant `sprint`, added to `TaskFilter`
   * later, was accepted by the type, put in the URL, and then **silently
   * dropped here**: no request, no error, the board simply never scoped.
   *
   * A serialised key re-runs on any change to any field, including ones added
   * after this line was written.
   */
  const filterKey = JSON.stringify(filter, Object.keys(filter).sort());

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));

    fetchEveryPage(slug, filter, controller.signal)
      .then(({ tasks, truncated }) => {
        setState({ status: 'ready', tasks, error: null, truncated });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({ status: 'error', tasks: [], error: cause, truncated: false });
      });

    return () => {
      controller.abort();
    };
    // `filterKey` stands in for `filter`: it is that object's content, and
    // depending on the object itself would re-run on every render.
  }, [slug, filterKey, attempt]);

  const move = useCallback(async (taskId: string, to: TaskStatus): Promise<void> => {
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
      // specific than anything invented here ("only the assignee, a project lead
      // or an admin may send a task to review").
      //
      // The example used to be "done cannot go back to backlog", and LAI-266
      // widened the §5 table for people — so a person can now do exactly that,
      // and a comment naming it as a refusal would describe behaviour the code
      // no longer has.
      setMoveError(cause instanceof ApiError ? cause.message : 'That move could not be saved.');
    } finally {
      setMovingId(undefined);
    }
  }, []);

  const byId = useMemo(() => byIdIndex(state.tasks), [state.tasks]);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  const dismissMoveError = useCallback((): void => {
    setMoveError(undefined);
  }, []);

  return { state, byId, movingId, moveError, move, reload, dismissMoveError };
}
