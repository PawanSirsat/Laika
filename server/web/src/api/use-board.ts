import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mergeTasks } from './board-merge.ts';
import { byIdIndex } from './board-derive.ts';
import { ApiError } from './errors.ts';
import { changeStatus, listTasks, type Task, type TaskFilter, type TaskStatus } from './tasks.ts';

export interface BoardState {
  /**
   * `loading` only for the **first** read of a question — a new project or a
   * new filter (LAI-707). A refresh of the same question keeps `ready` and the
   * tasks on screen, and sets `refreshing` instead: swapping the board for a
   * skeleton on every live frame was the flash the owner reported.
   */
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
  /** A same-question re-read is in flight; the board stays as it is meanwhile. */
  readonly refreshing: boolean;
  /**
   * Why the last same-question re-read failed, or `null`. The board keeps what
   * it had and says it is stale — a dropped connection is not a reason to wipe
   * a screen someone is reading. Access errors replace the board instead.
   */
  readonly refreshError: unknown;
  /** When `tasks` were last read from the server (unix ms), for "as of". */
  readonly asOf: number | null;
}

/** Where a change to the board came from (LAI-707; LAI-708's motion keys on it). */
export type CommitOrigin = 'load' | 'refresh' | 'local';

export interface CommitMeta {
  readonly origin: CommitOrigin;
  /** Ids the commit changed, when the caller knows (a merged refresh does). */
  readonly changed?: ReadonlySet<string> | undefined;
  /** A drop the person already carried there — the card is where it belongs. */
  readonly settled?: string | undefined;
  /** State outside the board that must land in the same render (`movingId`). */
  readonly alongside?: (() => void) | undefined;
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
  /**
   * Defer *applying* refresh answers until the returned release is called —
   * used for the length of a pointer drag, so a lane does not reflow under the
   * cursor and change where the drop lands. Fetching carries on; the newest
   * answer is applied on release.
   */
  readonly hold: () => () => void;
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
 * **No polling.** The stream (LAI-048, LAI-070) calls `reload()` when something
 * changes, as does the Refresh control. A reload of the same question
 * **refreshes in place** (LAI-707): the board stays, the answer is merged so
 * unchanged tasks keep their objects, and only what changed re-renders.
 *
 * **One writer.** Every change to the board's state goes through `commit`, so
 * the two rules that keep a refresh from fighting a local write always apply:
 * a task with a write in flight (`pending`), or written after the refresh's
 * read began (`lastLocalWrite`), keeps its local version.
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

const INITIAL: BoardState = {
  status: 'loading',
  tasks: [],
  error: null,
  truncated: false,
  refreshing: false,
  refreshError: null,
  asOf: null,
};

/**
 * Errors that mean the reader may no longer see this board — so the old one
 * must not stay up. Anything else (a dropped connection, a 5xx) keeps it.
 */
function isFatal(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    (cause.code === 'unauthorized' || cause.code === 'forbidden' || cause.code === 'not_found')
  );
}

export function useBoard(slug: string | undefined, filter: TaskFilter): UseBoard {
  const [state, setState] = useState<BoardState>(INITIAL);
  /** The truth, written only by `commit`; React state follows it. */
  const stateRef = useRef<BoardState>(INITIAL);
  /** `slug|filterKey` whose answer is on screen — the "same question" test. */
  const settledKey = useRef<string | undefined>(undefined);
  /** Tasks with a local write in flight. */
  const pending = useRef(new Set<string>());
  /** A counter bumped on every local write, and when each task was last written. */
  const writeEpoch = useRef(0);
  const lastLocalWrite = useRef(new Map<string, number>());
  /** Which fetch is current; an older one never applies. */
  const run = useRef(0);
  /** Active holds, and the newest refresh answer waiting for them to end. */
  const holds = useRef(0);
  const held = useRef<(() => void) | undefined>(undefined);
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

  /**
   * The one place the board's state is written (LAI-707). `meta` says where the
   * change came from, for LAI-708's motion; `alongside` lands other state —
   * `movingId` — in the same render, so a card never shows "moving" in its new
   * lane or "settled" in its old one.
   */
  const commit = useCallback((next: BoardState, meta: CommitMeta): void => {
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
    meta.alongside?.();
  }, []);

  useEffect(() => {
    if (slug === undefined) return;

    const key = `${slug}|${filterKey}`;
    const same = settledKey.current === key;
    const mine = (run.current += 1);
    const startedAt = writeEpoch.current;
    const controller = new AbortController();

    const now = stateRef.current;
    if (same) {
      commit({ ...now, refreshing: true }, { origin: 'refresh' });
    } else {
      // A different question: the old answer is not this one, so it shows the
      // skeleton (the tasks are kept only so identical ones can be reused).
      settledKey.current = undefined;
      commit(
        { ...now, status: 'loading', refreshing: false, refreshError: null },
        { origin: 'load' },
      );
    }

    fetchEveryPage(slug, filter, controller.signal)
      .then(({ tasks, truncated }) => {
        const apply = (): void => {
          if (mine !== run.current) return;
          const cur = stateRef.current;
          const keep = new Set(pending.current);
          for (const [id, at] of lastLocalWrite.current) {
            if (at > startedAt) keep.add(id);
            // A write this read already includes no longer needs protecting.
            else lastLocalWrite.current.delete(id);
          }
          const merged = mergeTasks(cur.tasks, tasks, keep);
          settledKey.current = key;
          commit(
            {
              status: 'ready',
              tasks: merged.tasks,
              error: null,
              truncated,
              refreshing: false,
              refreshError: null,
              asOf: Date.now(),
            },
            { origin: same ? 'refresh' : 'load', changed: merged.changed },
          );
        };
        if (same && holds.current > 0) held.current = apply;
        else apply();
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (mine !== run.current) return;
        const cur = stateRef.current;
        if (same && !isFatal(cause)) {
          commit({ ...cur, refreshing: false, refreshError: cause }, { origin: 'refresh' });
          return;
        }
        settledKey.current = undefined;
        commit({ ...INITIAL, status: 'error', error: cause }, { origin: 'load' });
      });

    return () => {
      controller.abort();
    };
    // `filterKey` stands in for `filter`: it is that object's content, and
    // depending on the object itself would re-run on every render.
  }, [slug, filterKey, attempt]);

  const move = useCallback(
    async (taskId: string, to: TaskStatus): Promise<void> => {
      setMoveError(undefined);
      setMovingId(taskId);
      pending.current.add(taskId);

      try {
        const updated = await changeStatus(taskId, to);
        writeEpoch.current += 1;
        lastLocalWrite.current.set(taskId, writeEpoch.current);
        // Replace with the server's version rather than patching the status:
        // the move also changes `updated_at`, and may change `ready` if this
        // task was some other task's last blocker.
        const cur = stateRef.current;
        commit(
          { ...cur, tasks: cur.tasks.map((t) => (t.id === updated.id ? updated : t)) },
          {
            origin: 'local',
            changed: new Set([taskId]),
            alongside: () => {
              setMovingId(undefined);
            },
          },
        );
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
        setMovingId(undefined);
      } finally {
        pending.current.delete(taskId);
      }
    },
    [commit],
  );

  const byId = useMemo(() => byIdIndex(state.tasks), [state.tasks]);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  const dismissMoveError = useCallback((): void => {
    setMoveError(undefined);
  }, []);

  const hold = useCallback((): (() => void) => {
    holds.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current = Math.max(0, holds.current - 1);
      if (holds.current === 0 && held.current !== undefined) {
        const apply = held.current;
        held.current = undefined;
        apply();
      }
    };
  }, []);

  return { state, byId, movingId, moveError, move, reload, dismissMoveError, hold };
}
