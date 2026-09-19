import { useCallback, useEffect, useState } from 'react';
import {
  createColumn,
  deleteColumn,
  listColumns,
  renameColumn,
  reorderColumns,
  setColumnStatuses,
  type BoardColumn,
} from './columns.ts';
import { ApiError } from './errors.ts';
import { MOVABLE_STATUSES, STATUS_LABELS } from './board-derive.ts';
import { type TaskStatus } from './tasks.ts';

/**
 * One lane per status, for a server that does not serve columns yet.
 *
 * **Not invented data.** These are the five labels the board drew before
 * columns existed, and they still live in `STATUS_LABELS`; the fallback simply
 * keeps drawing them. The alternative — an error screen — would mean a Laika
 * running an older server shows a broken board rather than the board it has
 * always had.
 *
 * Reached **only on `404`**, which is the server saying it has no such route.
 * Any other failure is a real error: columns exist and could not be read, and
 * guessing there would show one project's board with another's shape.
 *
 * Column configuration is hidden in this state, because there is nothing behind
 * it — `BoardScreen` keys that off `id` starting with `status:`.
 */
function statusColumns(): BoardColumn[] {
  return MOVABLE_STATUSES.map((status, position) => ({
    id: `status:${status}`,
    project_id: '',
    name: STATUS_LABELS[status],
    position,
    hidden: false,
    statuses: [status],
    primary_status: status,
  }));
}

/** Is this board the pre-columns fallback rather than real configuration? */
export function isFallbackColumn(column: BoardColumn): boolean {
  return column.id.startsWith('status:');
}

export interface ColumnsState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly columns: readonly BoardColumn[];
  readonly error: unknown;
}

export interface UseColumns {
  readonly state: ColumnsState;
  /** Visible lanes, in `position` order. The hidden ones are configuration. */
  readonly visible: readonly BoardColumn[];
  /** The server's reason for refusing the last edit. */
  readonly error: string | undefined;
  readonly busy: boolean;
  readonly create: (name: string) => Promise<void>;
  readonly rename: (columnId: string, name: string) => Promise<void>;
  readonly setStatuses: (columnId: string, statuses: readonly TaskStatus[]) => Promise<void>;
  readonly remove: (columnId: string, reassignTo: string) => Promise<void>;
  readonly reorder: (columnIds: readonly string[]) => Promise<void>;
  readonly reload: () => void;
  readonly dismissError: () => void;
}

/**
 * The board's columns.
 *
 * ## Why this is not folded into `useBoard`
 *
 * Two reasons, and the second is the one that would actually bite.
 *
 * **Different rates.** Tasks change constantly and columns almost never. One
 * hook means a task refetch on every rename, and a column refetch on every
 * drag.
 *
 * **Different optimism.** `use-board.ts`'s docblock is an argument that moves
 * are *not* optimistic: the server validates transitions, so a card that jumps
 * and snaps back has told the user something false in between. Column edits
 * **are** optimistic, because a reorder cannot be refused by a rule the user
 * does not already know — if they may not configure columns, the control is not
 * rendered at all. Putting both policies in one hook is where that docblock
 * quietly stops being true.
 *
 * ## A failed load is an error — except the one failure that is not
 *
 * A **404** is the server saying it has no such route, and the honest response
 * is the board this Laika has always had: one lane per status, from labels that
 * were already ours. See `statusColumns` above.
 *
 * Every other failure is an error screen with a retry. Falling back there would
 * look exactly like the feature working, on a project whose real columns are
 * something else entirely.
 */
export function useColumns(slug: string | undefined): UseColumns {
  const [state, setState] = useState<ColumnsState>({
    status: 'loading',
    columns: [],
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));

    listColumns(slug, controller.signal)
      .then((body) => {
        setState({ status: 'ready', columns: body.columns, error: null });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;

        if (cause instanceof ApiError && cause.code === 'not_found') {
          setState({ status: 'ready', columns: statusColumns(), error: null });
          return;
        }

        setState({ status: 'error', columns: [], error: cause });
      });

    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  /**
   * Run a mutation and take the server's board as the answer.
   *
   * Replacing local state with what came back, rather than keeping the optimistic
   * guess, is the same reasoning `use-board.ts` gives: the server may have
   * normalised something, and two sources for one list is how they disagree.
   */
  const run = useCallback(
    async (fn: () => Promise<{ columns: readonly BoardColumn[] }>): Promise<void> => {
      setBusy(true);
      setError(undefined);

      try {
        const body = await fn();
        setState({ status: 'ready', columns: body.columns, error: null });
      } catch (cause) {
        // The server's sentence, not one invented here — it knows which rule
        // refused and this does not.
        setError(cause instanceof ApiError ? cause.message : 'Could not save that. Try again.');
        // Put the real board back, in case an optimistic order is on screen.
        reload();
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const create = useCallback(
    async (name: string) => {
      if (slug === undefined) return;
      await run(() => createColumn(slug, name));
    },
    [run, slug],
  );

  const rename = useCallback(
    async (columnId: string, name: string) => {
      if (slug === undefined) return;
      await run(() => renameColumn(slug, columnId, name));
    },
    [run, slug],
  );

  const setStatuses = useCallback(
    async (columnId: string, statuses: readonly TaskStatus[]) => {
      if (slug === undefined) return;
      await run(() => setColumnStatuses(slug, columnId, statuses));
    },
    [run, slug],
  );

  const remove = useCallback(
    async (columnId: string, reassignTo: string) => {
      if (slug === undefined) return;
      await run(() => deleteColumn(slug, columnId, reassignTo));
    },
    [run, slug],
  );

  const reorder = useCallback(
    async (columnIds: readonly string[]) => {
      if (slug === undefined) return;

      // Optimistic: the new order is on screen before the request lands, and
      // `run` puts the server's answer back either way. A drag that waited for
      // a round trip would feel broken, and unlike a status move there is no
      // rule that can refuse it — only a network failure or a concurrent edit.
      setState((s) => ({
        ...s,
        columns: columnIds
          .map((id, i) => {
            const found = s.columns.find((c) => c.id === id);
            return found === undefined ? undefined : { ...found, position: i };
          })
          .filter((c): c is BoardColumn => c !== undefined),
      }));

      await run(() => reorderColumns(slug, columnIds));
    },
    [run, slug],
  );

  const dismissError = useCallback(() => {
    setError(undefined);
  }, []);

  return {
    state,
    visible: state.columns.filter((c) => !c.hidden).sort((a, b) => a.position - b.position),
    error,
    busy,
    create,
    rename,
    setStatuses,
    remove,
    reorder,
    reload,
    dismissError,
  };
}
