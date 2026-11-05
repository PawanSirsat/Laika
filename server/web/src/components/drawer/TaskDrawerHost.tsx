import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ApiError } from '../../api/errors.ts';
import { everyPage } from '../../api/every-page.ts';
import { useGates } from '../../api/permissions.ts';
import { getProject } from '../../api/projects.ts';
import { listSprints, type Sprint } from '../../api/sprints.ts';
import { changeStatus, getTask, type Member, type TaskSummary } from '../../api/tasks.ts';
import { taskStore } from '../../api/store.ts';
import { reloadProjectTasks, useProjectTasks } from '../../api/use-project-tasks.ts';
import { useProjectStatuses } from '../../api/use-statuses.ts';
import { NewTaskForm } from '../../routes/screens/board/NewTaskForm.tsx';
import { TaskDetailPanel } from '../../routes/screens/board/TaskDetailPanel.tsx';
import { ApiErrorState } from '../ApiErrorState.tsx';
import { LoadingState } from '../LoadingState.tsx';
import { useShell } from '../shell/shell-context.ts';
import { TaskDrawer } from './TaskDrawer.tsx';
import type { TaskSource } from './TaskSourceProvider.tsx';

export interface TaskDrawerHostProps {
  /** The space the drawer is open over, from `?project=`. */
  readonly slug: string | undefined;
  /** `?task=` — a task id, or a key (`LAI-12`) from a link that knew only that. */
  readonly taskRef: string | undefined;
  /** `?new=task`: the new-task form, in place (B19). */
  readonly creating: boolean;
  /** The view's live copy, when it offers one (Board, List). */
  readonly source: TaskSource | undefined;
  /**
   * This view offers a source: wait for it rather than reading the set a
   * second time in the moment before its offer lands.
   */
  readonly awaitSource: boolean;
  /** The space's members, which the layout already reads for the bar. */
  readonly members: readonly Member[];
  /** Open another task in the same drawer — a history entry Back undoes. */
  readonly onOpen: (taskId: string) => void;
  /** A key resolved to its id: rewrite `?task=` in place, not a new entry. */
  readonly onResolved: (taskId: string) => void;
  readonly onClose: () => void;
  readonly onCloseCreate: () => void;
}

/**
 * The task drawer for **every** view of a space (LAI-1190, B1).
 *
 * `SpaceLayout` mounted the frame on any `?task=`, but only the board filled
 * it, so the Timeline and the Calendar opened an empty box and sent no
 * request at all. The host renders the frame **and** what goes in it, from
 * whichever copy of the task set is best:
 *
 * - the view's own, when it offers one through `TaskSourceProvider` — the
 *   board's, with its optimistic moves, so the card and the panel agree;
 * - otherwise the project's shared set (`useProjectTasks`), which Calendar,
 *   Sprints, Dashboard, Activity and Meeting review already hold — so opening
 *   a task there costs no second walk — and `GET /tasks/:id` for a task the
 *   set does not have.
 */
export function TaskDrawerHost(props: TaskDrawerHostProps) {
  const { slug, taskRef, creating, onCloseCreate } = props;
  const headingId = useId();

  if (taskRef !== undefined) {
    return <TaskDrawerTask {...props} taskRef={taskRef} />;
  }
  if (creating && slug !== undefined) {
    return (
      <TaskDrawer taskId="" onClose={onCloseCreate} labelledBy={headingId}>
        <section className="drawer-create">
          <header className="drawer-create-head">
            <h2 id={headingId} className="drawer-create-title">
              New task
            </h2>
            <button type="button" className="panel-close" onClick={onCloseCreate}>
              <span className="visually-hidden">Close</span>
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <NewTaskForm
            slug={slug}
            onCreated={() => {
              reloadProjectTasks(slug);
              props.source?.refresh();
            }}
            onCancel={onCloseCreate}
          />
        </section>
      </TaskDrawer>
    );
  }
  return null;
}

/** A display key, `LAI-12`, as opposed to an id (a ULID has no dash). */
const KEY = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/;

/** The task's own drawer: find it, then hand it to the panel. */
function TaskDrawerTask({
  slug: urlSlug,
  taskRef,
  source,
  awaitSource,
  members: memberList,
  onOpen,
  onResolved,
  onClose,
}: TaskDrawerHostProps & { readonly taskRef: string }) {
  const { me, refreshReview } = useShell();
  const gates = useGates(me !== undefined);
  const headingId = useId();

  // The view's slug wins: the board resolves one when the URL names none.
  const slug = source?.slug ?? urlSlug;
  const own = source === undefined && !awaitSource ? slug : undefined;

  /*
   * **The shared set and the reads the board would have made**, only when no
   * view offered its own. Statuses come from the shared status store, so
   * reading them here costs nothing when the view already has them.
   *
   * The set only when it is **already held** — Calendar, Sprints, Dashboard,
   * Activity and Meeting review hold it — or when the link gave a key, which
   * only the set can turn into an id. A cold Timeline reads just the sprints
   * it opens (D-074), and opening one task must not walk the whole space: an
   * id is one `GET /tasks/:id`.
   */
  const isKey = KEY.test(taskRef);
  const held = own !== undefined && taskStore.peek(own) !== undefined;
  const shared = useProjectTasks(own !== undefined && (isKey || held) ? own : undefined);
  const statuses = useProjectStatuses(slug);
  const sprints = useSprints(own);
  const agentsAllowed = useAgentsAllowed(own);
  const memberMap = useMemo(
    () => new Map(memberList.map((m) => [m.user_id, m] as const)),
    [memberList],
  );

  const byId = source?.byId ?? shared?.byId;
  const loading =
    source !== undefined ? source.loading : awaitSource || shared?.status === 'loading';

  /*
   * A key is resolved against the set, then written back as the id (replace,
   * not push), so everything downstream — the card's highlight, focus return,
   * Back — speaks ids as it always did (B2, B18).
   */
  const inSet = useMemo(() => {
    if (byId === undefined) return undefined;
    const byIdHit = byId.get(taskRef);
    if (byIdHit !== undefined) return byIdHit;
    for (const t of byId.values()) if (t.key === taskRef) return t;
    return undefined;
  }, [byId, taskRef]);
  useEffect(() => {
    if (inSet !== undefined && inSet.id !== taskRef) onResolved(inSet.id);
  }, [inSet, taskRef, onResolved]);

  // **Not in the set** — past the page cap, or no set read — one read by id.
  // A key the set does not have names nothing the reader can open.
  const missingKey = isKey && inSet === undefined && !loading && byId !== undefined;
  const fetched = useTaskRead(inSet === undefined && !loading && !isKey ? taskRef : undefined);

  const local = useLocalMoves(own);
  const task: TaskSummary | undefined = inSet ?? fetched.task;

  if (task === undefined || slug === undefined) {
    return (
      <TaskDrawer taskId={taskRef} onClose={onClose} labelledBy={headingId}>
        <div className="drawer-state">
          <h2 id={headingId} className="visually-hidden">
            Task {taskRef}
          </h2>
          {missingKey || fetched.error !== undefined ? (
            missingKey || (fetched.error instanceof ApiError && fetched.error.status === 404) ? (
              <p className="drawer-state-missing">
                No task {taskRef} in this space. It may have been deleted, or it belongs to a space
                you cannot read.
              </p>
            ) : (
              <ApiErrorState error={fetched.error} resource="this task" onRetry={fetched.retry} />
            )
          ) : (
            <LoadingState shape="drawer" count={4} label="Loading this task" />
          )}
        </div>
      </TaskDrawer>
    );
  }

  const actions = source ?? local;
  const refresh = source?.refresh ?? (() => reloadProjectTasks(slug));
  const mayWrite = gates.project(task.project_id, 'task.write');

  return (
    <TaskDrawer taskId={task.id} onClose={onClose} labelledBy={`${headingId}-key ${headingId}`}>
      <TaskDetailPanel
        headingId={headingId}
        slug={slug}
        executionSignal={source?.executionSignal?.(task.id)}
        sprints={source?.sprints ?? sprints}
        agentsAllowed={source !== undefined ? source.agentsAllowed : agentsAllowed}
        maySetSprint={gates.project(task.project_id, 'task.assign_sprint')}
        statuses={source?.statuses ?? statuses.all}
        meId={me?.id}
        meEmail={me?.email}
        mayAssign={mayWrite}
        mayEdit={mayWrite}
        mayCreate={gates.project(task.project_id, 'task.create')}
        onTagsChanged={refresh}
        onAssigned={refresh}
        onTaskEdited={refresh}
        onHandoffsChanged={refresh}
        onReviewDecided={refreshReview}
        onOpen={onOpen}
        task={task}
        listReadAt={source?.listReadAt ?? shared?.asOf ?? null}
        listReadOrder={source?.listReadOrder ?? shared?.readOrder ?? 0}
        byId={byId ?? new Map([[task.id, task]])}
        members={source?.members ?? memberMap}
        moving={actions.movingId === task.id}
        moveError={actions.moveError}
        onMove={actions.onMove}
        onClose={onClose}
      />
    </TaskDrawer>
  );
}

/** Every sprint in the space, for the panel's sprint control. */
function useSprints(slug: string | undefined): readonly Sprint[] {
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  useEffect(() => {
    setSprints([]);
    if (slug === undefined) return;
    const controller = new AbortController();
    everyPage((cursor) =>
      listSprints(slug, cursor === undefined ? {} : { cursor }, controller.signal),
    )
      .then(({ items }) => {
        if (!controller.signal.aborted) setSprints(items);
      })
      .catch(() => {
        // No sprints to offer rather than wrong ones.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);
  return sprints;
}

/** The space's `agents_allowed`; `undefined` (allowed) until it answers. */
function useAgentsAllowed(slug: string | undefined): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setAllowed(undefined);
    if (slug === undefined) return;
    const controller = new AbortController();
    getProject(slug, controller.signal)
      .then((project) => {
        if (!controller.signal.aborted) setAllowed(project.agents_allowed);
      })
      .catch(() => {
        // The Agent row then reads as allowed, and the server still decides.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);
  return allowed;
}

/** `GET /tasks/:id` for a task the set does not hold. */
function useTaskRead(taskId: string | undefined): {
  readonly task: TaskSummary | undefined;
  readonly error: unknown;
  readonly retry: () => void;
} {
  const [state, setState] = useState<{
    readonly id: string;
    readonly task?: TaskSummary;
    readonly error?: unknown;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (taskId === undefined) return;
    const controller = new AbortController();
    setState({ id: taskId });
    getTask(taskId, controller.signal)
      .then((task) => {
        if (!controller.signal.aborted) setState({ id: taskId, task });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ id: taskId, error });
      });
    return () => {
      controller.abort();
    };
  }, [taskId, attempt]);
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  const current = taskId !== undefined && state?.id === taskId ? state : undefined;
  return { task: current?.task, error: current?.error, retry };
}

/**
 * Moving a task from the drawer when the view offers no store of its own: the
 * same `POST /tasks/:id/status` the board's move makes, then the shared set
 * is read again so the view under the drawer follows.
 */
function useLocalMoves(slug: string | undefined) {
  const [movingId, setMovingId] = useState<string | undefined>(undefined);
  const [moveError, setMoveError] = useState<string | undefined>(undefined);
  const onMove = useCallback(
    (taskId: string, toStatusId: string): void => {
      setMoveError(undefined);
      setMovingId(taskId);
      changeStatus(taskId, { status_id: toStatusId })
        .then(() => {
          reloadProjectTasks(slug);
        })
        .catch((cause: unknown) => {
          setMoveError(cause instanceof ApiError ? cause.message : 'That move could not be saved.');
        })
        .finally(() => {
          setMovingId(undefined);
        });
    },
    [slug],
  );
  return { movingId, moveError, onMove };
}
