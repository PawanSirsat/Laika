import { useEffect, useId, useMemo } from 'react';
import { ApiError } from '../../api/errors.ts';
import { useGates } from '../../api/permissions.ts';
import type { Member, TaskSummary } from '../../api/tasks.ts';
import { taskStore } from '../../api/store.ts';
import { reloadProjectTasks, useProjectTasks } from '../../api/use-project-tasks.ts';
import { useProjectStatuses } from '../../api/use-statuses.ts';
import { TaskDetailPanel } from '../../routes/screens/board/TaskDetailPanel.tsx';
import { workroomHref } from '../../routes/task-href.ts';
import { rememberWorkroomReturn } from '../../routes/workroom-return.ts';
import { ApiErrorState } from '../ApiErrorState.tsx';
import { LoadingState } from '../LoadingState.tsx';
import { useShell } from '../shell/shell-context.ts';
import { TaskDrawer } from './TaskDrawer.tsx';
import type { TaskSource } from './TaskSourceProvider.tsx';
import { useAgentsAllowed, useLocalMoves, useSprints, useTaskRead } from './use-space-reads.ts';

export interface TaskDrawerHostProps {
  /** The space the drawer is open over, from `?project=`. */
  readonly slug: string | undefined;
  /** `?task=` — a task id, or a key (`LAI-12`) from a link that knew only that. */
  readonly taskRef: string | undefined;
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
  // Creating a task is the Create task dialog's (LAI-1167), not the drawer's.
  if (props.taskRef === undefined) return null;
  return <TaskDrawerTask {...props} taskRef={props.taskRef} />;
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
  const {
    me,
    refreshReview,
    route: { navigate },
  } = useShell();
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
        expandHref={workroomHref(task.key)}
        onExpand={() => {
          /*
           * **The Workroom, as a pushed entry** (LAI-1199): Back from the page
           * lands here, on this view with this drawer open. The address is
           * remembered so the page's *Back to …* can step back rather than
           * push a second copy of this view.
           */
          rememberWorkroomReturn(task.key, window.location.pathname + window.location.search);
          navigate(workroomHref(task.key));
        }}
      />
    </TaskDrawer>
  );
}
