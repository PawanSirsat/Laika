import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getPermissions, type Permissions } from '../../../api/permissions.ts';
import type { Project } from '../../../api/projects.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { GrantsCard } from './GrantsCard.tsx';
import {
  actionName,
  cellFor,
  heldNames,
  mayEditGrants,
  projectLabel,
  rowsFor,
} from './permissions-view.ts';

type PermissionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly view: Permissions };

export interface RolesPermissionsSectionProps {
  /** The owner — the one reader who may change an org role on People (D-102 rule 5). */
  readonly canChangeRoles: boolean;
  /** The projects the reader can see, to name a membership and link its Members. */
  readonly projects: readonly Project[];
  readonly onNavigate: (to: string) => void;
}

/** A link inside the app: a plain anchor that navigates without a reload. */
function InAppLink({
  to,
  onNavigate,
  children,
}: {
  readonly to: string;
  readonly onNavigate: (to: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <a
      className="org-head-action"
      href={to}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** One role × action table. Rows, columns and every word in them come from the response. */
function Matrix({
  id,
  title,
  roles,
  view,
  scope,
  action,
  footer,
}: {
  readonly id: string;
  readonly title: string;
  readonly roles: readonly string[];
  readonly view: Permissions;
  readonly scope: 'org' | 'project';
  readonly action?: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <section className="org-card perm-card" aria-labelledby={id}>
      <header className="org-card-head">
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      <table className="perm-table" data-scope={scope}>
        <thead>
          <tr>
            <th scope="col">Action</th>
            {roles.map((role) => (
              <th key={role} scope="col" className="perm-role">
                {role}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowsFor(view, scope).map((row) => (
            <tr key={row.action} data-action={row.action}>
              <th scope="row" className="perm-action">
                <span className="perm-action-name">{actionName(row)}</span>
                {(row.session_only || row.read_only) && (
                  <span className="perm-marks">
                    {row.session_only && (
                      <span
                        className="org-chip perm-mark"
                        data-mark="session-only"
                        title="No token may do this, only a signed-in session"
                      >
                        Session only
                      </span>
                    )}
                    {row.read_only && (
                      <span
                        className="org-chip perm-mark"
                        data-mark="read-only"
                        title="A read-only token may do this too"
                      >
                        Read
                      </span>
                    )}
                  </span>
                )}
              </th>
              {roles.map((role) => {
                const cell = cellFor(row, role);
                return (
                  <td key={role} className="perm-cell" data-role={role} data-holding={cell.kind}>
                    <span className="perm-cell-role" aria-hidden="true">
                      {role}
                    </span>
                    <span className="perm-cell-value">{cell.text}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </section>
  );
}

/**
 * Organisation → Roles & permissions (LAI-950): who may do what, **as `can()`
 * answers it**, from `GET /api/v1/permissions`.
 *
 * Roles are still assigned where they always were — org roles on People,
 * project roles on each project's Members — and this tab links there rather
 * than growing a second place to change them. **What each role may do** is
 * the owner's to change here (LAI-960), in *Who can do what*; the tables
 * below it are re-read after a save, because they are `can()`'s answer under
 * those grants.
 */
export function RolesPermissionsSection({
  canChangeRoles,
  projects,
  onNavigate,
}: RolesPermissionsSectionProps) {
  const [state, setState] = useState<PermissionsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A re-read after a save keeps the tab on screen; only a first load or a
    // retry from an error shows the skeleton.
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    getPermissions(controller.signal)
      .then((view) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', view });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  if (state.status === 'loading') {
    return <LoadingState shape="table" count={6} label="Loading roles and permissions" />;
  }

  if (state.status === 'error') {
    return (
      <ApiErrorState
        error={state.error}
        resource="roles and permissions"
        scope="organisation"
        onRetry={reload}
      />
    );
  }

  const { view } = state;
  const { me } = view;
  /**
   * Whose Members a project role is changed on: the reader's own projects, or —
   * for an Owner or Admin, who leads every project in reach without being a
   * member — every project they can see that this credential reaches.
   */
  const memberLinks = projects
    .filter(
      (project) =>
        me.projects.some((grant) => grant.project_id === project.id) ||
        (me.implicit_project_role !== null &&
          (me.project_scope === 'all' || me.project_scope.includes(project.id))),
    )
    .map((project) => ({
      id: project.id,
      name: project.name,
      href: `/members?project=${encodeURIComponent(project.slug)}`,
    }));

  return (
    <>
      <section className="org-card perm-card" aria-labelledby="perm-me">
        <header className="org-card-head">
          <h2 id="perm-me">What you can do</h2>
        </header>
        <dl className="perm-me">
          <div className="perm-me-fact" data-fact="org-role">
            <dt>Your organisation role</dt>
            <dd className="perm-role">{me.org_role}</dd>
          </div>
          <div className="perm-me-fact" data-fact="credential">
            <dt>Signed in with</dt>
            <dd>{me.credential}</dd>
          </div>
          <div className="perm-me-fact" data-fact="project-scope">
            <dt>Projects this credential reaches</dt>
            <dd>
              {me.project_scope === 'all'
                ? 'all'
                : me.project_scope.map((id) => projectLabel(projects, id)).join(', ')}
            </dd>
          </div>
          {me.implicit_project_role !== null && (
            <div className="perm-me-fact" data-fact="implicit-project-role">
              <dt>On every project in reach</dt>
              <dd className="perm-role">{me.implicit_project_role}</dd>
            </div>
          )}
        </dl>

        <h3 className="perm-subhead">In the organisation</h3>
        {me.actions.length === 0 ? (
          <p className="org-note">Nothing on this credential.</p>
        ) : (
          <ul className="perm-held" data-held="org">
            {heldNames(view, me.actions).map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}

        {me.projects.length > 0 && (
          <>
            <h3 className="perm-subhead">In your projects</h3>
            <ul className="perm-projects">
              {me.projects.map((grant) => (
                <li key={grant.project_id} className="perm-project" data-project={grant.project_id}>
                  <div className="perm-project-head">
                    <span className="perm-project-name">
                      {projectLabel(projects, grant.project_id)}
                    </span>
                    {grant.role !== null && (
                      <span className="org-chip perm-role">{grant.role}</span>
                    )}
                  </div>
                  <ul className="perm-held">
                    {heldNames(view, grant.actions).map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <GrantsCard orgRoles={view.org_roles} editable={mayEditGrants(me.actions)} onSaved={reload} />

      <Matrix
        id="perm-org"
        title="Organisation roles"
        roles={view.org_roles}
        view={view}
        scope="org"
        action={
          canChangeRoles ? (
            <InAppLink to="/organisation?tab=people" onNavigate={onNavigate}>
              Change someone&rsquo;s role
            </InAppLink>
          ) : undefined
        }
      />

      <Matrix
        id="perm-project"
        title="Project roles"
        roles={view.project_roles}
        view={view}
        scope="project"
        footer={
          memberLinks.length > 0 && (
            <p className="org-note perm-members">
              Project roles are set on each project&rsquo;s Members:{' '}
              {memberLinks.map((link, i) => (
                <span key={link.id}>
                  {i > 0 && ', '}
                  <InAppLink to={link.href} onNavigate={onNavigate}>
                    {link.name}
                  </InAppLink>
                </span>
              ))}
            </p>
          )
        }
      />
      <p className="org-note perm-legend">
        <em>Session only</em> means no API token may do it; <em>Read</em> means a read-only token
        may do it too.
      </p>
    </>
  );
}
