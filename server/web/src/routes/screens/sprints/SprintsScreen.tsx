import { everyPage } from '../../../api/every-page.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { useEffect, useRef, useState } from 'react';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { type Sprint } from '../../../api/sprints.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { useGates } from '../../../api/permissions.ts';
import { listProjects } from '../../../api/projects.ts';
import { useShell } from '../../../components/shell/shell-context.ts';
import { useRoute } from '../../use-route.ts';
import { AssignTasksPanel } from './AssignTasksPanel.tsx';
import { SprintCard } from './SprintCard.tsx';
import { SprintForm } from './SprintForm.tsx';
import { formatRange, sprintFigures } from './sprint-derive.ts';
import { useSprints } from './use-sprints.ts';
import './sprints.css';
import { pickProject } from '../../../api/pick-project.ts';
import { withProjectParam } from '../../nav-url.ts';

const NO_TASKS: ReadonlyMap<string, TaskSummary> = new Map();

/**
 * Sprints (SPEC §4.15, §11.4 — LAI-083).
 *
 * The API has been complete since LAI-050 and nothing consumed it. This is the
 * screen; it adds no rules of its own.
 *
 * ## Where the rules live
 *
 * Non-overlap and at-most-one-active are the **server's**, enforced under a
 * write lock, and both refuse with a `409` whose message already names the
 * sprint holding the slot. This screen never predicts either: it sends the
 * request and renders the refusal verbatim. That is not laziness — a
 * client-side copy is wrong exactly when two people plan at once, which is the
 * case the lock exists for, and it would refuse things the server would have
 * allowed.
 *
 * ## Props
 *
 * Takes none. `AppShell.tsx` renders `<SprintsScreen />` and is Builder-B's
 * under D-028, so the project slug is read from the URL here rather than
 * threaded through a prop change in a file this task may not touch.
 */
export function SprintsScreen() {
  const { params, setParams, navigate } = useRoute();
  /*
   * **The shell's session, not a second one** (LAI-724). A `useSession()` here
   * was a second session hook: it asked `/me` again on every visit, and it
   * replaced the shell's 401 handler with its own and cleared it on leaving.
   */
  const { me } = useShell();
  // `sprint.manage` and `task.assign_sprint`, as the server reports them (LAI-970).
  const gates = useGates(me !== undefined);
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [projectError, setProjectError] = useState<unknown>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Sprint | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [assigning, setAssigning] = useState<Sprint | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState<Sprint | undefined>(undefined);
  /**
   * What the last action did, said once (LAI-1195): a sprint created, saved,
   * started or deleted. The list changing is not enough — a new sprint can
   * land below the fold, and a delete leaves nothing to look at.
   */
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const confirmRef = useRef<HTMLDivElement>(null);
  /** The Delete button that opened the confirm, so focus goes back to it. */
  const deleteOrigin = useRef<string | undefined>(undefined);

  /*
   * **The confirm takes focus** (B12's class, LAI-1195): an alertdialog that
   * appears without moving focus is not announced, and the keyboard is left
   * on a button that no longer means anything. The safe choice, Keep it,
   * takes it; Escape keeps the sprint too.
   */
  useEffect(() => {
    if (confirmingDelete === undefined) return;
    confirmRef.current?.querySelector<HTMLButtonElement>('[data-keep]')?.focus();
  }, [confirmingDelete?.id]);

  const closeConfirm = (): void => {
    const origin = deleteOrigin.current;
    setConfirmingDelete(undefined);
    deleteOrigin.current = undefined;
    // Back to where the keyboard was, if that sprint is still there.
    requestAnimationFrame(() => {
      if (origin === undefined) return;
      const back = document.querySelector<HTMLElement>(`[data-delete-for="${origin}"]`);
      (back ?? document.querySelector<HTMLElement>('.sprints .sprint-button'))?.focus();
    });
  };

  // The project id is needed for the permission check, and the slug for the API.
  // Resolved together so a screen opened without `?project=` still works.
  useEffect(() => {
    const controller = new AbortController();

    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703); `page.data` is the whole list.
        const page = { data: items };
        // One rule on every screen (LAI-423): the most recently active
        // project, never the alphabetically first, and written into the URL so
        // the address bar names what is on screen.
        const wanted = pickProject(page.data, slug);
        setSlug(wanted?.slug);
        setProjectId(wanted?.id);
        if (wanted !== undefined && slug === undefined) {
          setParams(new URLSearchParams(withProjectParam(params.toString(), wanted.slug)));
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectError(cause);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const sprints = useSprints(slug);

  const canManage = projectId !== undefined && gates.project(projectId, 'sprint.manage');
  const canAssign = projectId !== undefined && gates.project(projectId, 'task.assign_sprint');

  if (projectError !== null) {
    return (
      <div className="sprints">
        <ApiErrorState error={projectError} resource="your projects" scope="organisation" />
      </div>
    );
  }

  if (slug === undefined && projectId === undefined) {
    return (
      <div className="sprints">
        <EmptyState
          headline="No projects yet"
          body="Sprints belong to a project. Create one first."
        />
      </div>
    );
  }

  /**
   * Derived, and silent when it would have to guess.
   *
   * The count is only known once the list is `ready`, so until then there is no
   * context rather than a placeholder. `truncated` means the list hit
   * `MAX_PAGES` and the number is a **floor**, so it is shown as `4+` — writing
   * a bare `4` there would be the screen stating something it does not know.
   */
  const headerContext =
    slug === undefined || sprints.state.status !== 'ready'
      ? undefined
      : // The count alone (LAI-1195): the slug is a URL word, and the space
        // header above already names the space.
        `${String(sprints.state.rows.length)}${sprints.state.truncated ? '+' : ''} ${
          sprints.state.rows.length === 1 && !sprints.state.truncated ? 'sprint' : 'sprints'
        }`;

  /** The whole project's tasks, which a sprint's lock is judged against (LAI-819). */
  const projectById = sprints.state.status === 'ready' ? sprints.state.byId : NO_TASKS;

  return (
    <div className="sprints">
      <SpaceSlot context={headerContext}>
        {canManage && !formOpen && (
          <button
            type="button"
            className="sprint-button sprint-button-primary"
            onClick={() => {
              setEditing(undefined);
              setNotice(undefined);
              setFormOpen(true);
            }}
          >
            New sprint
          </button>
        )}
      </SpaceSlot>

      {sprints.actionError !== undefined && (
        <p className="sprint-alert" role="alert">
          {/* The server's own words. Its 409 names the sprint that already holds
              `active`, or the one whose dates collide — both more specific than
              anything this screen could say. */}
          {sprints.actionError}
          <button type="button" className="sprint-alert-close" onClick={sprints.dismissError}>
            Dismiss
          </button>
        </p>
      )}

      {notice !== undefined && (
        <p className="sprint-notice" role="status">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.4" />
          </svg>
          <span>{notice}</span>
          <button
            type="button"
            className="sprint-alert-close"
            onClick={() => {
              setNotice(undefined);
            }}
          >
            Dismiss
          </button>
        </p>
      )}

      {formOpen && (
        <SprintForm
          key={editing?.id ?? 'new'}
          {...(editing === undefined ? {} : { sprint: editing })}
          busy={sprints.busy}
          onSubmit={async (input) => {
            setNotice(undefined);
            const ok =
              editing === undefined
                ? await sprints.create(input)
                : await sprints.update(editing.id, input);
            if (ok) {
              setNotice(
                `${editing === undefined ? 'Created' : 'Saved'} ${input.name} · ${formatRange(
                  input.starts_on,
                  input.ends_on,
                )}.`,
              );
              setFormOpen(false);
              setEditing(undefined);
            }
            return ok;
          }}
          onCancel={() => {
            setFormOpen(false);
            setEditing(undefined);
          }}
        />
      )}

      {confirmingDelete !== undefined && (
        <div
          ref={confirmRef}
          className="sprint-confirm"
          role="alertdialog"
          aria-labelledby="sprint-confirm-title"
          aria-describedby="sprint-confirm-note"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !sprints.busy) {
              event.stopPropagation();
              closeConfirm();
            }
          }}
        >
          <p className="sprint-confirm-body" id="sprint-confirm-title">
            Delete <strong>{confirmingDelete.name}</strong>?
          </p>
          {/* §4.15: deleting a sprint releases its tasks rather than destroying
              them. Said before the click, not after — this is the only moment
              the reassurance is worth anything. */}
          <p className="sprint-confirm-note" id="sprint-confirm-note">
            {confirmingDelete.status === 'active' ? 'This is the running sprint. ' : ''}
            Its tasks are not deleted. They return to no sprint and stay on the board.
          </p>
          <div className="sprint-form-actions">
            <button
              type="button"
              className="sprint-button sprint-button-danger"
              disabled={sprints.busy}
              onClick={() => {
                const gone = confirmingDelete;
                void sprints.remove(gone.id).then((ok) => {
                  if (!ok) return;
                  setNotice(`Deleted ${gone.name}. Its tasks are back in no sprint.`);
                  closeConfirm();
                });
              }}
            >
              {sprints.busy && <Spinner size="sm" />}
              Delete sprint
            </button>
            <button
              type="button"
              className="sprint-button"
              data-keep=""
              disabled={sprints.busy}
              onClick={closeConfirm}
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {sprints.state.status === 'loading' ? (
        <LoadingState shape="row" count={3} label="Loading sprints" />
      ) : sprints.state.status === 'error' ? (
        <ApiErrorState
          error={sprints.state.error}
          resource="this project's sprints"
          scope="project"
          onRetry={sprints.reload}
        />
      ) : sprints.state.rows.length === 0 ? (
        <EmptyState
          headline="No sprints yet"
          body={
            canManage
              ? 'Plan the first one — a name and two dates is all it needs.'
              : 'A space admin can plan the first one.'
          }
          {...(canManage
            ? {
                action: {
                  label: 'New sprint',
                  onClick: () => {
                    setEditing(undefined);
                    setFormOpen(true);
                  },
                },
              }
            : {})}
        />
      ) : (
        <>
          {sprints.state.truncated && (
            <p className="sprint-note" role="status">
              Showing the first pages only — some counts may be low.
            </p>
          )}

          <ul className="sprint-list">
            {sprints.state.rows.map((row, index) => {
              /*
               * Counted here rather than in the card, so the card places numbers
               * and decides none of them — against the whole project's tasks,
               * so a blocker outside this sprint counts (LAI-819).
               */
              const figures = sprintFigures(row.tasks, projectById);

              return (
                <li key={row.sprint.id}>
                  <SprintCard
                    sprint={row.sprint}
                    tasks={row.tasks}
                    progress={row.progress}
                    index={index + 1}
                    blocked={figures.blocked}
                    wip={figures.wip}
                    unassigned={figures.unassigned}
                    subtasks={figures.subtasks}
                    onScope={() => {
                      const next = new URLSearchParams(params);
                      next.set('sprint', row.sprint.id);
                      setParams(next);
                      navigate(`/board?${next.toString()}`);
                    }}
                    canManage={canManage}
                    canAssign={canAssign}
                    busy={sprints.busy}
                    pending={sprints.pending}
                    expanded={expanded === row.sprint.id}
                    onToggle={() => {
                      setExpanded(expanded === row.sprint.id ? undefined : row.sprint.id);
                    }}
                    onEdit={() => {
                      setNotice(undefined);
                      setEditing(row.sprint);
                      setFormOpen(true);
                    }}
                    onActivate={() => {
                      setNotice(undefined);
                      void sprints.activate(row.sprint.id).then((ok) => {
                        if (ok)
                          setNotice(`Started ${row.sprint.name}. It is now the active sprint.`);
                      });
                    }}
                    onDelete={() => {
                      setNotice(undefined);
                      deleteOrigin.current = row.sprint.id;
                      setConfirmingDelete(row.sprint);
                    }}
                    onAssign={() => {
                      setAssigning(row.sprint);
                    }}
                    onUnassign={(taskId) => {
                      void sprints.unassign(row.sprint.id, taskId);
                    }}
                  />

                  {assigning?.id === row.sprint.id && (
                    <AssignTasksPanel
                      sprint={row.sprint}
                      available={sprints.state.status === 'ready' ? sprints.state.unassigned : []}
                      busy={sprints.busy}
                      onAssign={(taskIds) => sprints.assign(row.sprint.id, taskIds)}
                      onClose={() => {
                        setAssigning(undefined);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {/* The design's footnote (prototype line 645). It is the only place
              that says what picking a sprint here actually does. */}
          <p className="sprint-footnote">
            Picking a sprint here scopes the board, the timeline and the sprint strip to it. “All
            sprints” on the strip clears the scope and shows every task in the project.
          </p>
        </>
      )}
    </div>
  );
}
