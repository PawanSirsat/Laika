import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { refreshPermissions, type Permissions } from '../../../api/permissions.ts';
import { projectRoleLabel } from '../../../api/members.ts';
import type { Project } from '../../../api/projects.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { GrantsCard } from './GrantsCard.tsx';
import { ScrollRegion } from './ScrollRegion.tsx';
import {
  actionName,
  cellFor,
  explainRole,
  findRows,
  groupRows,
  heldNames,
  mayEditGrants,
  projectLabel,
  rowsFor,
} from './permissions-view.ts';

type PermissionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly view: Permissions;
      /** A re-read failed; the last good view stays, with a Retry (LAI-1194). */
      readonly refreshError: unknown;
    };

/** `12 actions`. */
const actions = (n: number): string => `${String(n)} ${n === 1 ? 'action' : 'actions'}`;

/**
 * One group of held actions, folded to a line by default (LAI-1194, visual
 * audit V8): its name, its role and how many actions it holds. Opening it
 * shows the list.
 *
 * The list is **hidden, not unmounted**, so what the reader holds is always in
 * the document — a find, a screen reader's search, and a test reading the
 * names all see the same list whether or not it is open.
 */
function HeldGroup({
  title,
  chip,
  names,
  query,
  held,
  className,
  dataProject,
}: {
  readonly title: ReactNode;
  readonly chip?: string | undefined;
  readonly names: readonly string[];
  readonly query: string;
  readonly held?: string;
  readonly className: string;
  readonly dataProject?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const needle = query.trim().toLowerCase();
  const shown = needle === '' ? names : names.filter((n) => n.toLowerCase().includes(needle));
  // A find opens every group with a match and hides every group without one.
  if (needle !== '' && shown.length === 0) return null;
  const expanded = open || needle !== '';
  return (
    <li className={className} data-project={dataProject} data-held-group>
      <button
        type="button"
        className="perm-group-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        disabled={needle !== ''}
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        <span className="perm-group-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="perm-project-head">
          <span className="perm-project-name">{title}</span>
          {chip !== undefined && <span className="org-chip perm-role">{chip}</span>}
        </span>
        <span className="perm-group-count" data-held-count>
          {needle === ''
            ? actions(names.length)
            : `${String(shown.length)} of ${actions(names.length)}`}
        </span>
      </button>
      <ul className="perm-held" id={id} data-held={held} hidden={!expanded}>
        {shown.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </li>
  );
}

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

/** `An admin`, `A member`, `A space admin` — the start of a sentence. */
const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'An' : 'A');

/**
 * One role × action table. Rows, columns and every word in them come from the
 * response.
 *
 * LAI-1210: rows sit under a heading per area, the page's find narrows them,
 * and *Explain a role* says in one sentence what a column holds — counted
 * from the cells, never from a rule this client knows.
 */
function Matrix({
  id,
  title,
  roles,
  view,
  scope,
  query,
  action,
  footer,
}: {
  readonly id: string;
  readonly title: string;
  readonly roles: readonly string[];
  readonly view: Permissions;
  readonly scope: 'org' | 'project';
  readonly query: string;
  readonly action?: ReactNode;
  readonly footer?: ReactNode;
}) {
  const [explained, setExplained] = useState<string | undefined>(undefined);
  const roleName = (role: string): string => (scope === 'project' ? projectRoleLabel(role) : role);
  const all = rowsFor(view, scope);
  const shown = findRows(all, query);
  const explanation = explained === undefined ? undefined : explainRole(all, explained);
  const where = scope === 'project' ? 'space' : 'organisation';
  return (
    <section className="org-card perm-card" aria-labelledby={id} data-matrix={scope}>
      <header className="org-card-head">
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      {roles.length > 0 && (
        <div className="perm-explain">
          <span className="perm-explain-label" id={`${id}-explain`}>
            Explain a role
          </span>
          <div className="org-segmented" role="group" aria-labelledby={`${id}-explain`}>
            {roles.map((role) => (
              <button
                key={role}
                type="button"
                className="org-segment"
                data-explain-role={role}
                aria-pressed={explained === role}
                onClick={() => {
                  setExplained((now) => (now === role ? undefined : role));
                }}
              >
                {roleName(role)}
              </button>
            ))}
          </div>
          {explained !== undefined && explanation !== undefined && (
            <p className="perm-explain-text" role="status" data-explain>
              {`${article(roleName(explained))} ${roleName(explained)} can take ${String(explanation.yes)} of ${String(explanation.total)} ${where} actions`}
              {explanation.conditional.length > 0 &&
                `, and ${String(explanation.conditional.length)} more with a condition: ${explanation.conditional.join('; ')}`}
              {explanation.not.length === 0
                ? '. There is nothing here it may not do.'
                : `. Not: ${explanation.not.join(', ')}.`}
            </p>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="org-note perm-none" data-matrix-none>
          No {where} action matches “{query.trim()}”.
        </p>
      ) : (
        <ScrollRegion label={`${title} table`}>
          <table className="perm-table" data-scope={scope}>
            <thead>
              <tr>
                <th scope="col">Action</th>
                {roles.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className="perm-role"
                    data-explained={explained === role || undefined}
                  >
                    {roleName(role)}
                  </th>
                ))}
              </tr>
            </thead>
            {groupRows(shown).map((group) => (
              <tbody key={group.key} data-group={group.key}>
                <tr className="perm-group-row">
                  <th scope="rowgroup" colSpan={roles.length + 1} className="perm-group-head">
                    {group.name}
                    <span className="perm-group-size">{String(group.rows.length)}</span>
                  </th>
                </tr>
                {group.rows.map((row) => (
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
                        <td
                          key={role}
                          className="perm-cell"
                          data-role={role}
                          data-holding={cell.kind}
                          data-explained={explained === role || undefined}
                        >
                          <span className="perm-cell-role" aria-hidden="true">
                            {roleName(role)}
                          </span>
                          <span className="perm-cell-value">{cell.text}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </ScrollRegion>
      )}
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
  /** The find box over what the reader holds. */
  const [query, setQuery] = useState('');
  /** The find over the two role tables. */
  const [tableQuery, setTableQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A re-read after a save keeps the tab on screen; only a first load or a
    // retry from an error shows the skeleton.
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    refreshPermissions(controller.signal)
      .then((view) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', view, refreshError: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) =>
          current.status === 'ready'
            ? { ...current, refreshError: error }
            : { status: 'error', error },
        );
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
  const orgNames = heldNames(view, me.actions);
  const needle = query.trim().toLowerCase();
  const matches = (names: readonly string[]): number =>
    names.filter((n) => n.toLowerCase().includes(needle)).length;
  const anyMatch =
    needle === '' ||
    matches(orgNames) > 0 ||
    me.projects.some((grant) => matches(heldNames(view, grant.actions)) > 0);
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
      {state.refreshError !== null && (
        <div className="org-refresh-error" role="alert" data-refresh-error>
          <span>Couldn’t refresh roles and permissions — what you see may be out of date.</span>
          <button type="button" className="bar-control" onClick={reload}>
            Retry
          </button>
        </div>
      )}
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
            <dt>Spaces this credential reaches</dt>
            <dd>
              {me.project_scope === 'all'
                ? 'all'
                : me.project_scope.map((id) => projectLabel(projects, id)).join(', ')}
            </dd>
          </div>
          {me.implicit_project_role !== null && (
            <div className="perm-me-fact" data-fact="implicit-project-role">
              <dt>Role in every space it reaches</dt>
              <dd className="perm-role">{me.implicit_project_role}</dd>
            </div>
          )}
        </dl>

        {/* A summary first, the inventory on request (LAI-1194, V8). */}
        <p className="perm-summary" data-perm-summary>
          You can take {actions(orgNames.length)} across the organisation
          {me.projects.length > 0
            ? `, and hold a role in ${String(me.projects.length)} ${me.projects.length === 1 ? 'space' : 'spaces'}`
            : ''}
          {me.implicit_project_role !== null
            ? `; every space this credential reaches treats you as ${projectRoleLabel(me.implicit_project_role).toLowerCase()}`
            : ''}
          . Open a group to see each action.
        </p>

        {(orgNames.length > 0 || me.projects.length > 0) && (
          <div className="perm-find">
            <label className="org-people-search">
              <span className="org-people-search-glyph" aria-hidden="true">
                ⌕
              </span>
              <input
                type="search"
                className="org-people-search-input"
                data-perm-find
                placeholder="Find an action, e.g. invite"
                aria-label="Find an action you can take"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </label>
          </div>
        )}

        <h3 className="perm-subhead">In the organisation</h3>
        {me.actions.length === 0 ? (
          <p className="org-note">Nothing on this credential.</p>
        ) : (
          <ul className="perm-groups">
            <HeldGroup
              className="perm-project perm-org-group"
              title="Organisation-wide"
              names={orgNames}
              query={query}
              held="org"
            />
          </ul>
        )}

        {me.projects.length > 0 && (
          <>
            <h3 className="perm-subhead">In your spaces</h3>
            <ul className="perm-projects perm-groups">
              {me.projects.map((grant) => (
                <HeldGroup
                  key={grant.project_id}
                  className="perm-project"
                  dataProject={grant.project_id}
                  title={projectLabel(projects, grant.project_id)}
                  chip={grant.role === null ? undefined : projectRoleLabel(grant.role)}
                  names={heldNames(view, grant.actions)}
                  query={query}
                />
              ))}
            </ul>
          </>
        )}

        {!anyMatch && (
          <div className="org-people-empty" data-perm-no-match>
            <p className="org-people-empty-title">No action matches “{query.trim()}”</p>
            <p className="org-people-empty-body">
              Nothing you hold is called that. The tables below list what every role may do.
            </p>
            <button
              type="button"
              className="org-people-empty-clear"
              onClick={() => {
                setQuery('');
              }}
            >
              Clear the search
            </button>
          </div>
        )}
      </section>

      <GrantsCard orgRoles={view.org_roles} editable={mayEditGrants(me.actions)} onSaved={reload} />

      {/* One find over both tables (LAI-1210); the box above finds what you hold. */}
      <div className="perm-find perm-find-tables">
        <label className="org-people-search">
          <span className="org-people-search-glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            className="org-people-search-input"
            data-matrix-find
            placeholder="Find an action in the tables, e.g. token"
            aria-label="Find an action in the role tables"
            value={tableQuery}
            onChange={(event) => {
              setTableQuery(event.target.value);
            }}
          />
        </label>
      </div>

      <Matrix
        id="perm-org"
        title="Organisation roles"
        roles={view.org_roles}
        view={view}
        scope="org"
        query={tableQuery}
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
        title="Space roles"
        roles={view.project_roles}
        view={view}
        scope="project"
        query={tableQuery}
        footer={
          memberLinks.length > 0 && (
            <p className="org-note perm-members">
              Space roles are set on each space&rsquo;s members:{' '}
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
