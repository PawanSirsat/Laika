import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApiError } from './errors.ts';
import { statusStore, taskStore } from './store.ts';
import { applyOrder, fullOrder, hiddenColumns, visibleColumns } from './status-derive.ts';
import {
  createStatus,
  deleteStatus,
  reorderStatuses,
  updateStatus,
  type ProjectStatus,
  type StatusCategory,
} from './statuses.ts';

export interface UseStatuses {
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: unknown;
  /** Every status, hidden included, by position. */
  readonly all: readonly ProjectStatus[];
  /** The board's columns. */
  readonly visible: readonly ProjectStatus[];
  readonly hidden: readonly ProjectStatus[];
  readonly byId: ReadonlyMap<string, ProjectStatus>;
  readonly reload: () => void;
}

const NONE: readonly ProjectStatus[] = [];

/**
 * The project's statuses by id, for a screen whose rows sit several
 * components below the one that knows the project (the Timeline). Empty by
 * default, which makes `statusNameOf` fall back to the name the task carries.
 */
export const StatusesById = createContext<ReadonlyMap<string, ProjectStatus>>(new Map());

export function useStatusesById(): ReadonlyMap<string, ProjectStatus> {
  return useContext(StatusesById);
}

/**
 * The project's statuses, from the one shared copy (`store.ts`, LAI-739).
 * Every screen that names or picks a status reads this, so a rename shows
 * everywhere at once.
 */
export function useProjectStatuses(slug: string | undefined): UseStatuses {
  const subscribe = useCallback(
    (onChange: () => void) =>
      slug === undefined ? () => undefined : statusStore.subscribe(slug, onChange),
    [slug],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    slug === undefined ? undefined : statusStore.peek(slug),
  );

  // Dropped by a change of user while mounted: ask again. Only then — on the
  // first render nothing is held yet either, and `subscribe` is already
  // loading it; a second read here would abort and repeat that one.
  useEffect(() => {
    if (slug !== undefined && snapshot === undefined && statusStore.peek(slug) === undefined) {
      statusStore.reload(slug);
    }
  }, [slug, snapshot]);

  const all = snapshot?.statuses ?? NONE;
  const derived = useMemo(
    () => ({
      visible: visibleColumns(all),
      hidden: hiddenColumns(all),
      byId: new Map(all.map((s) => [s.id, s])),
    }),
    [all],
  );

  const reload = useCallback(() => {
    if (slug !== undefined) statusStore.reload(slug);
  }, [slug]);

  return {
    status: snapshot?.status ?? 'loading',
    error: snapshot?.error ?? null,
    all,
    ...derived,
    reload,
  };
}

export interface StatusEditor {
  /** The server's reason for refusing the last edit. */
  readonly error: string | undefined;
  readonly busy: boolean;
  readonly create: (name: string, category: StatusCategory) => Promise<ProjectStatus | undefined>;
  /** Resolves to the refusal's message, or `undefined` when it saved. */
  readonly rename: (id: string, name: string) => Promise<string | undefined>;
  readonly setHidden: (id: string, hidden: boolean) => Promise<void>;
  /** The new order of the **visible** columns; hidden ones keep their slots. */
  readonly reorder: (visibleIds: readonly string[]) => Promise<void>;
  /** Resolves `true` when the column is gone. */
  readonly remove: (id: string, moveTo: string) => Promise<boolean>;
  readonly dismissError: () => void;
}

/** A `data` list from the server, or nothing to trust. */
function listIn(
  answer: { readonly data?: unknown } | undefined,
): readonly ProjectStatus[] | undefined {
  return Array.isArray(answer?.data) ? (answer.data as readonly ProjectStatus[]) : undefined;
}

function message(cause: unknown): string {
  // The server's sentence, not one invented here — it knows which rule refused.
  return cause instanceof ApiError ? cause.message : 'Could not save that. Try again.';
}

/**
 * Column edits (LAI-739). **Optimistic** — a rename, a hide or a reorder is on
 * screen before the request lands — because none of them can be refused by a
 * rule the reader does not already know: the controls are not drawn for
 * somebody who may not configure the board. A refusal puts the server's list
 * back and says why.
 *
 * Moving a *card* stays the board's business (`use-board.ts`): it can be
 * refused by lifecycle rules, and its rollback is per card.
 */
export function useStatusEditor(slug: string | undefined): StatusEditor {
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T>(
      optimistic: ((list: readonly ProjectStatus[]) => readonly ProjectStatus[]) | undefined,
      call: () => Promise<T>,
      settle: (answer: T) => void,
    ): Promise<{ ok: true; answer: T } | { ok: false; message: string }> => {
      if (slug === undefined) return { ok: false, message: 'No project.' };
      setBusy(true);
      setError(undefined);
      // Held for the request's life: a frame's re-read meanwhile may predate
      // this write on the server, and must not undo it (LAI-739).
      const end = statusStore.begin(slug);
      if (optimistic !== undefined) statusStore.write(slug, optimistic);
      try {
        const answer = await call();
        settle(answer);
        return { ok: true, answer };
      } catch (cause) {
        const said = message(cause);
        // Whatever was guessed on screen, the server's list replaces it.
        statusStore.reload(slug);
        return { ok: false, message: said };
      } finally {
        end();
        setBusy(false);
      }
    },
    [slug],
  );

  /*
   * The server's list replaces the guess — every status write answers with
   * the whole list (LAI-738). An answer without one (a shape this client does
   * not expect) is not trusted to mean anything: the list is read again.
   */
  const settleList = useCallback(
    (answer: { readonly data?: unknown } | undefined) => {
      if (slug === undefined) return;
      const list = listIn(answer);
      if (list === undefined) statusStore.reload(slug);
      else statusStore.write(slug, () => list);
    },
    [slug],
  );

  const create = useCallback(
    async (name: string, category: StatusCategory) => {
      // The new one is found by **id difference**, not by name: two columns
      // may share a name, and the answer is the whole list.
      const before = new Set((statusStore.peek(slug ?? '')?.statuses ?? []).map((s) => s.id));
      const result = await run(
        undefined,
        () => createStatus(slug ?? '', { name, category }),
        settleList,
      );
      if (!result.ok) {
        setError(result.message);
        return undefined;
      }
      return listIn(result.answer)?.find((s) => !before.has(s.id));
    },
    [run, slug, settleList],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const result = await run(
        (list) => list.map((s) => (s.id === id ? { ...s, name } : s)),
        () => updateStatus(slug ?? '', id, { name }),
        settleList,
      );
      // Inline: the header that asked shows it, not the board's alert bar.
      return result.ok ? undefined : result.message;
    },
    [run, slug, settleList],
  );

  const setHidden = useCallback(
    async (id: string, hidden: boolean) => {
      const result = await run(
        (list) => list.map((s) => (s.id === id ? { ...s, hidden } : s)),
        () => updateStatus(slug ?? '', id, { hidden }),
        settleList,
      );
      if (!result.ok) setError(result.message);
    },
    [run, slug, settleList],
  );

  const reorder = useCallback(
    async (visibleIds: readonly string[]) => {
      if (slug === undefined) return;
      const ids = fullOrder(statusStore.peek(slug)?.statuses ?? [], visibleIds);
      const result = await run(
        (list) => applyOrder(list, ids),
        () => reorderStatuses(slug, ids),
        settleList,
      );
      if (!result.ok) setError(result.message);
    },
    [run, slug, settleList],
  );

  const remove = useCallback(
    async (id: string, moveTo: string) => {
      if (slug === undefined) return false;
      const result = await run(
        undefined,
        () => deleteStatus(slug, id, moveTo),
        (answer) => {
          // The server's remaining list — positions closed up — or, if it did
          // not send one, this one without the deleted status.
          const left = listIn(answer);
          statusStore.write(slug, (list) => left ?? list.filter((s) => s.id !== id));
          // Its tasks moved on the server: the board re-reads them.
          taskStore.reload(slug);
        },
      );
      if (!result.ok) setError(result.message);
      return result.ok;
    },
    [run, slug],
  );

  const dismissError = useCallback(() => {
    setError(undefined);
  }, []);

  return { error, busy, create, rename, setHidden, reorder, remove, dismissError };
}
