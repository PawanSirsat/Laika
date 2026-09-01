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
import { listTasks, type Task } from '../../../api/tasks.ts';
import {
  groupBySprint,
  inCalendarOrder,
  progressFor,
  type SprintProgress,
} from './sprint-derive.ts';

/**
 * The sprints screen's data (LAI-083).
 *
 * ## One task request for the whole screen
 *
 * Progress needs every sprint's task counts and the assignment panel needs the
 * unassigned ones, so the screen fetches the project's tasks **once** and groups
 * them locally. The alternative — `?sprint=<id>` per sprint — is a request per
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

async function allTasks(slug: string, signal: AbortSignal): Promise<[Task[], boolean]> {
  const all: Task[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listTasks(
      slug,
      cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
      signal,
    );
    all.push(...result.data);
    if (result.next_cursor === null || result.next_cursor === undefined) return [all, false];
    cursor = result.next_cursor;
  }

  return [all, true];
}

export function useSprints(slug: string | undefined): UseSprints {
  const [state, setState] = useState<SprintsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    setState({ status: 'loading' });

    Promise.all([allSprints(slug, controller.signal), allTasks(slug, controller.signal)])
      .then(([[sprints, sprintsCut], [tasks, tasksCut]]) => {
        // `sprint_id` is on the client `Task` since LAI-121, so there is no
        // longer a boundary where tasks gain the field.
        const bySprint = groupBySprint(tasks);

        setState({
          status: 'ready',
          rows: inCalendarOrder(sprints).map((sprint) => {
            const own = bySprint.get(sprint.id) ?? [];
            return { sprint, tasks: own, progress: progressFor(own) };
          }),
          unassigned: bySprint.get(null) ?? [],
          truncated: sprintsCut || tasksCut,
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({ status: 'error', error: cause });
      });

    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

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
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setActionError(undefined);
    setBusy(true);

    try {
      await action();
      setAttempt((n) => n + 1);
      return true;
    } catch (cause) {
      // Verbatim. The server's 409 already names the sprint holding `active`
      // or the range that collides, and anything written here would be vaguer
      // than what it replaced.
      setActionError(cause instanceof ApiError ? cause.message : 'That change could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (input: SprintInput) => run(() => createSprint(slug ?? '', input)),
    [run, slug],
  );
  const update = useCallback(
    (id: string, patch: Partial<SprintInput>) => run(() => updateSprint(id, patch)),
    [run],
  );
  const activate = useCallback(
    (id: string) => run(() => updateSprint(id, { status: 'active' })),
    [run],
  );
  const remove = useCallback((id: string) => run(() => deleteSprint(id)), [run]);
  const assign = useCallback(
    (id: string, taskIds: readonly string[]) => run(() => addTasksToSprint(id, taskIds)),
    [run],
  );
  const unassign = useCallback(
    (id: string, taskId: string) => run(() => removeTaskFromSprint(id, taskId)),
    [run],
  );

  return useMemo(
    () => ({
      state,
      busy,
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
