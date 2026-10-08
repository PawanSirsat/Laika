import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  addTasksToSprint,
  createSprint,
  deleteSprint,
  listSprints,
  removeTaskFromSprint,
  updateSprint,
  type Sprint,
  type SprintInput,
} from '../../../api/sprints.ts';
import type { Task } from '../../../api/tasks.ts';
import { reloadProjectTasks, useProjectTasks } from '../../../api/use-project-tasks.ts';
import {
  groupBySprint,
  inCalendarOrder,
  progressFor,
  type SprintProgress,
} from './sprint-derive.ts';

/**
 * The sprints screen's data (LAI-083) — and the Timeline's, which reads it.
 *
 * ## One task set for the whole screen — and now for the whole app
 *
 * Progress needs every sprint's task counts and the assignment panel needs the
 * unassigned ones, so the screen reads the project's tasks **once** and groups
 * them locally. Since LAI-724 that once is the project's one set
 * (`task-store.ts`), shared with every other screen and kept live by the
 * stream, rather than a walk of its own on every mount. The exported shape is
 * unchanged. The alternative — `?sprint=<id>` per sprint — is a request per
 * row on the screen whose whole job is showing several rows at once, and it
 * would still need a separate call for the unassigned ones.
 *
 * Both lists walk their cursor rather than taking the first page. A sprints
 * screen that silently counted only the first 50 tasks would put a confidently
 * wrong `done/total` on every card, and an undercount in a progress bar is
 * invisible in a way an error is not. `MAX_PAGES` is a runaway guard, and
 * reaching it is reported rather than swallowed — see `truncated`.
 *
 * ## Mutations are not optimistic
 *
 * Same reasoning as `use-board.ts`, and it matters more here: the server owns
 * non-overlap and one-active-sprint (§4.15) and enforces them under a write
 * lock. A screen that applied a change locally and rolled it back on `409` would
 * show a sprint as active for a moment when it never was. Every mutation awaits,
 * then refetches, and a failure surfaces **the server's own message** — which
 * already names the sprint holding the slot or the range that collides.
 */

/** Enough for any real project; a guard against a server that never stops. */
const MAX_PAGES = 20;

export interface SprintRow {
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
  readonly progress: SprintProgress;
}

export type SprintsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly rows: readonly SprintRow[];
      readonly unassigned: readonly Task[];
      /** True when a list hit `MAX_PAGES` — the counts below are a floor. */
      readonly truncated: boolean;
    };

export interface UseSprints {
  readonly state: SprintsState;
  /** Set while any mutation is in flight, so controls can disable. */
  readonly busy: boolean;
  /**
   * Which mutation is in flight — `activate:<id>`, `remove:<id>`, and so on.
   *
   * `busy` is screen-wide and correct for *disabling*: one mutation at a time
   * is the rule here. It is wrong for a *spinner*, which claims a specific
   * control is the one working. Keying the flight lets a card spin the button
   * that was actually pressed instead of all four.
   */
  readonly pending: string | undefined;
  /** The server's reason for refusing the last action. Never invented here. */
  readonly actionError: string | undefined;
  readonly dismissError: () => void;
  readonly reload: () => void;
  readonly create: (input: SprintInput) => Promise<boolean>;
  readonly update: (id: string, patch: Partial<SprintInput>) => Promise<boolean>;
  readonly activate: (id: string) => Promise<boolean>;
  readonly remove: (id: string) => Promise<boolean>;
  readonly assign: (id: string, taskIds: readonly string[]) => Promise<boolean>;
  readonly unassign: (id: string, taskId: string) => Promise<boolean>;
}

async function allSprints(slug: string, signal: AbortSignal): Promise<[Sprint[], boolean]> {
  const all: Sprint[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listSprints(slug, cursor === undefined ? {} : { cursor }, signal);
    all.push(...result.data);
    if (result.next_cursor === null || result.next_cursor === undefined) return [all, false];
    cursor = result.next_cursor;
  }

  return [all, true];
}

export function useSprints(slug: string | undefined): UseSprints {
  const tasks = useProjectTasks(slug);
  /** The sprint list, and whose it is — a list from the last project is not this one's. */
  const [sprints, setSprints] = useState<
    | { readonly slug: string; readonly list: readonly Sprint[]; readonly cut: boolean }
    | { readonly slug: string; readonly error: unknown }
    | undefined
  >(undefined);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    allSprints(slug, controller.signal)
      .then(([list, cut]) => {
        setSprints({ slug, list, cut });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setSprints({ slug, error: cause });
      });

    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  const state = useMemo((): SprintsState => {
    if (slug === undefined || sprints?.slug !== slug) return { status: 'loading' };
    if ('error' in sprints) return { status: 'error', error: sprints.error };
    if (tasks?.status === 'error') return { status: 'error', error: tasks.error };
    if (tasks?.status !== 'ready') return { status: 'loading' };

    // `sprint_id` is on the client `Task` since LAI-121, so there is no
    // longer a boundary where tasks gain the field.
    const bySprint = groupBySprint(tasks.tasks);
    return {
      status: 'ready',
      rows: inCalendarOrder(sprints.list).map((sprint) => {
        const own = bySprint.get(sprint.id) ?? [];
        return { sprint, tasks: own, progress: progressFor(own) };
      }),
      unassigned: bySprint.get(null) ?? [],
      truncated: sprints.cut || tasks.truncated,
    };
  }, [slug, sprints, tasks]);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
    reloadProjectTasks(slug);
  }, [slug]);

  const dismissError = useCallback((): void => {
    setActionError(undefined);
  }, []);

  /**
   * Run a mutation, then refetch.
   *
   * Refetch rather than patch the local copy: activating a sprint can change
   * *another* sprint's status server-side, and assigning tasks changes counts on
   * two rows at once. Reconstructing that here would be a second implementation
   * of rules the server already applied.
   *
   * Returns whether it succeeded, so a form knows whether to close.
   */
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
      setActionError(undefined);
      setPending(key);

      try {
        await action();
        // The write made the cached sprint list stale (`client.ts`); the set is
        // walked again because assigning moves tasks between rows.
        setAttempt((n) => n + 1);
        reloadProjectTasks(slug);
        return true;
      } catch (cause) {
        // Verbatim. The server's 409 already names the sprint holding `active`
        // or the range that collides, and anything written here would be vaguer
        // than what it replaced.
        setActionError(
          cause instanceof ApiError ? cause.message : 'That change could not be saved.',
        );
        return false;
      } finally {
        setPending(undefined);
      }
    },
    [slug],
  );

  const create = useCallback(
    (input: SprintInput) => run('create', () => createSprint(slug ?? '', input)),
    [run, slug],
  );
  const update = useCallback(
    (id: string, patch: Partial<SprintInput>) => run(`update:${id}`, () => updateSprint(id, patch)),
    [run],
  );
  const activate = useCallback(
    (id: string) => run(`activate:${id}`, () => updateSprint(id, { status: 'active' })),
    [run],
  );
  const remove = useCallback((id: string) => run(`remove:${id}`, () => deleteSprint(id)), [run]);
  const assign = useCallback(
    (id: string, taskIds: readonly string[]) =>
      run(`assign:${id}`, () => addTasksToSprint(id, taskIds)),
    [run],
  );
  const unassign = useCallback(
    (id: string, taskId: string) =>
      run(`unassign:${taskId}`, () => removeTaskFromSprint(id, taskId)),
    [run],
  );

  const busy = pending !== undefined;

  return useMemo(
    () => ({
      state,
      busy,
      pending,
      actionError,
      dismissError,
      reload,
      create,
      update,
      activate,
      remove,
      assign,
      unassign,
    }),
    [
      state,
      busy,
      pending,
      actionError,
      dismissError,
      reload,
      create,
      update,
      activate,
      remove,
      assign,
      unassign,
    ],
  );
}
