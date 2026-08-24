import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { canAssignToSprints, canManageSprints, type Sprint } from '../../../api/sprints.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import { useSession } from '../../../api/use-session.ts';
import { useRoute } from '../../use-route.ts';
import { AssignTasksPanel } from './AssignTasksPanel.tsx';
import { SprintCard } from './SprintCard.tsx';
import { SprintForm } from './SprintForm.tsx';
import { useSprints } from './use-sprints.ts';
import './sprints.css';

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
  const { params } = useRoute();
  const session = useSession();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [projectError, setProjectError] = useState<unknown>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Sprint | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [assigning, setAssigning] = useState<Sprint | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState<Sprint | undefined>(undefined);

  // The project id is needed for the permission check, and the slug for the API.
  // Resolved together so a screen opened without `?project=` still works.
  useEffect(() => {
    const controller = new AbortController();

    listProjects({}, controller.signal)
      .then((page) => {
        // `isProject`, not `!isTombstone`: a negated guard does not narrow, and
        // a tombstone carries no slug (see `api/projects.ts`).
        const live = page.data.filter(isProject);
        const wanted = slug === undefined ? live[0] : live.find((p) => p.slug === slug);
        setSlug(wanted?.slug);
        setProjectId(wanted?.id);
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

  const me = session.session.status === 'authenticated' ? session.session.user : undefined;
  const canManage =
    me !== undefined &&
    projectId !== undefined &&
    canManageSprints(me.org_role, projectId, me.memberships);
  const canAssign =
    me !== undefined &&
    projectId !== undefined &&
    canAssignToSprints(me.org_role, projectId, me.memberships);

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

  return (
    <div className="sprints">
      <header className="sprints-head">
        <h1 className="sprints-title">Sprints</h1>
        {canManage && !formOpen && (
          <button
            type="button"
            className="sprint-button sprint-button-primary"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            New sprint
          </button>
        )}
      </header>

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

      {formOpen && (
        <SprintForm
          {...(editing === undefined ? {} : { sprint: editing })}
          busy={sprints.busy}
          onSubmit={async (input) => {
            const ok =
              editing === undefined
                ? await sprints.create(input)
                : await sprints.update(editing.id, input);
            if (ok) {
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
        <div className="sprint-confirm" role="alertdialog" aria-label="Delete sprint">
          <p className="sprint-confirm-body">
            Delete <strong>{confirmingDelete.name}</strong>?
          </p>
          {/* §4.15: deleting a sprint releases its tasks rather than destroying
              them. Said before the click, not after — this is the only moment
              the reassurance is worth anything. */}
          <p className="sprint-confirm-note">
            Its tasks are not deleted. They return to no sprint and stay on the board.
          </p>
          <div className="sprint-form-actions">
            <button
              type="button"
              className="sprint-button sprint-button-danger"
              disabled={sprints.busy}
              onClick={() => {
                void sprints.remove(confirmingDelete.id).then((ok) => {
                  if (ok) setConfirmingDelete(undefined);
                });
              }}
            >
              {sprints.busy ? 'Deleting…' : 'Delete sprint'}
            </button>
            <button
              type="button"
              className="sprint-button"
              disabled={sprints.busy}
              onClick={() => {
                setConfirmingDelete(undefined);
              }}
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
              : 'A project lead can plan the first one.'
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
            {sprints.state.rows.map((row) => (
              <li key={row.sprint.id}>
                <SprintCard
                  sprint={row.sprint}
                  tasks={row.tasks}
                  progress={row.progress}
                  canManage={canManage}
                  canAssign={canAssign}
                  busy={sprints.busy}
                  expanded={expanded === row.sprint.id}
                  onToggle={() => {
                    setExpanded(expanded === row.sprint.id ? undefined : row.sprint.id);
                  }}
                  onEdit={() => {
                    setEditing(row.sprint);
                    setFormOpen(true);
                  }}
                  onActivate={() => {
                    void sprints.activate(row.sprint.id);
                  }}
                  onDelete={() => {
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
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
