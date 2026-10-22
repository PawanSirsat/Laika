import { useEffect, useMemo, useState } from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { listMembers } from '../../../api/members.ts';
import type { Org } from '../../../api/org.ts';
import type { Project } from '../../../api/projects.ts';
import { updateUser, type OpenTasksChoice, type OrgUser } from '../../../api/users.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { OrgRole } from '../../../api/invites.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { TransferOwnership } from './TransferOwnership.tsx';
import {
  filterPeople,
  lastSeenLabel,
  peopleCounts,
  peopleQuery,
  ROLE_FILTERS,
  STATUS_FILTERS,
  withPeopleQuery,
  type PeopleQuery,
  type RoleFilter,
  type StatusFilter,
} from './people-model.ts';

/** The roles a picker offers (D-104 item 2): never *Owner* — that is a transfer. */
const PICKABLE: readonly OrgRole[] = ['admin', 'member', 'viewer'];

const ROLE_CHIP: Readonly<Record<RoleFilter, string>> = {
  all: 'All',
  owner: 'Owner',
  admin: 'Admins',
  member: 'Members',
  viewer: 'Viewers',
};

const STATUS_CHIP: Readonly<Record<StatusFilter, string>> = {
  all: 'Everyone',
  active: 'Active',
  off: 'Deactivated',
};

/** What is waiting on a confirmation. */
type Pending =
  | { readonly kind: 'role'; readonly person: OrgUser; readonly role: OrgRole }
  | { readonly kind: 'deactivate'; readonly person: OrgUser };

/** The last role change, while it can still be put back. */
interface Undoable {
  readonly person: OrgUser;
  readonly from: OrgRole;
  readonly to: OrgRole;
}

export interface PeopleTabProps {
  readonly me: MeProfile;
  readonly people: readonly OrgUser[];
  readonly truncated: boolean;
  readonly org: Org | undefined;
  readonly projects: readonly Project[];
  /** Owner only (D-102 rule 5, D-104 item 2) — the one gate that follows the role. */
  readonly canChangeRoles: boolean;
  readonly canDeactivate: boolean;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams) => void;
  readonly reload: () => void;
}

/**
 * Organisation → People (LAI-987): search, chips with counts and a space
 * filter in the Spaces page's language (D-103 item 12); a last sign-in column
 * (LAI-981); role changes and deactivation behind a confirmation, with Undo for
 * a role change; and, for the owner, Transfer ownership (D-104 item 2).
 *
 * **The server's refusal, verbatim.** The one-owner and last-owner rules live
 * there, and this screen re-implements neither: a refusal is shown as the
 * sentence the server gave, inside the dialog that asked.
 */
export function PeopleTab({
  me,
  people,
  truncated,
  org,
  projects,
  canChangeRoles,
  canDeactivate,
  params,
  setParams,
  reload,
}: PeopleTabProps) {
  const { theme } = useTheme();
  const query = peopleQuery(params);
  const setQuery = (patch: Partial<PeopleQuery>): void => {
    setParams(withPeopleQuery(params, patch));
  };

  /** The chosen space's member ids, or `undefined` until they have arrived. */
  const [spaceMembers, setSpaceMembers] = useState<ReadonlySet<string> | undefined>(undefined);
  const [spaceError, setSpaceError] = useState(false);
  useEffect(() => {
    setSpaceMembers(undefined);
    setSpaceError(false);
    if (query.space === '') return;
    const controller = new AbortController();
    listMembers(query.space, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setSpaceMembers(new Set(list.members.map((m) => m.user_id)));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSpaceError(true);
      });
    return () => {
      controller.abort();
    };
  }, [query.space]);

  const shown = useMemo(
    () => filterPeople(people, query, spaceMembers),
    [people, query, spaceMembers],
  );
  const counts = useMemo(() => peopleCounts(people, query), [people, query]);
  const filtered =
    query.q !== '' || query.role !== 'all' || query.status !== 'all' || query.space !== '';

  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [undo, setUndo] = useState<Undoable | undefined>(undefined);
  /** Deactivation's open-task choice (D-104 item 5): unassign, pre-selected. */
  const [reassignTo, setReassignTo] = useState<string>('');
  /** Reactivation and Undo ask nothing; their refusal is shown under the list. */
  const [rowError, setRowError] = useState<string | undefined>(undefined);

  const close = (): void => {
    setPending(undefined);
    setError(undefined);
  };

  const refused = (cause: unknown): string =>
    cause instanceof Error ? cause.message : 'That change was refused.';

  const confirm = (): void => {
    if (pending === undefined) return;
    setBusy(true);
    setError(undefined);
    const { person } = pending;
    const openTasks: OpenTasksChoice = reassignTo === '' ? 'unassign' : { reassign_to: reassignTo };
    const patch =
      pending.kind === 'role'
        ? { org_role: pending.role }
        : { is_active: false as const, open_tasks: openTasks };
    updateUser(person.id, patch)
      .then(() => {
        if (pending.kind === 'role') {
          setUndo({ person, from: person.org_role as OrgRole, to: pending.role });
        } else {
          setUndo(undefined);
        }
        setPending(undefined);
        reload();
      })
      .catch((cause: unknown) => {
        setError(refused(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const direct = (person: OrgUser, patch: { org_role?: OrgRole; is_active?: boolean }): void => {
    setBusy(true);
    setRowError(undefined);
    updateUser(person.id, patch)
      .then(() => {
        setUndo(undefined);
        reload();
      })
      .catch((cause: unknown) => {
        setRowError(refused(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const extraOwners = org?.extra_owners ?? [];
  const now = Date.now();

  return (
    <>
      <section className="org-card org-people-card" aria-labelledby="org-people">
        <header className="org-card-head">
          <h2 id="org-people">People</h2>
          <span className="org-count">
            {String(people.length)}
            {truncated ? '+' : ''}
          </span>
        </header>

        <div className="org-toolbar">
          <label className="org-search">
            <svg
              className="org-search-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              className="org-search-input"
              placeholder="Search people by name or email"
              aria-label="Search people"
              value={query.q}
              onChange={(event) => {
                setQuery({ q: event.target.value });
              }}
            />
          </label>

          {projects.length > 0 && (
            <Dropdown
              variant="bare"
              className="org-space-filter"
              aria-label="Filter by space"
              noun="spaces"
              searchable={projects.length > 8}
              value={query.space}
              onChange={(space) => {
                setQuery({ space });
              }}
              options={[
                { value: '', label: 'All spaces' },
                ...projects.map((p) => ({ value: p.slug, label: p.name })),
              ]}
            />
          )}
        </div>

        <div className="org-chips">
          <div className="org-seg" role="group" aria-label="Role">
            {ROLE_FILTERS.map((role) => (
              <button
                key={role}
                type="button"
                className="org-seg-btn"
                data-role-filter={role}
                aria-pressed={query.role === role}
                onClick={() => {
                  setQuery({ role });
                }}
              >
                {ROLE_CHIP[role]}
                <span className="org-seg-count">{counts.role[role]}</span>
              </button>
            ))}
          </div>
          <div className="org-seg" role="group" aria-label="Status">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                className="org-seg-btn"
                data-status-filter={status}
                aria-pressed={query.status === status}
                onClick={() => {
                  setQuery({ status });
                }}
              >
                {STATUS_CHIP[status]}
                <span className="org-seg-count">{counts.status[status]}</span>
              </button>
            ))}
          </div>
        </div>

        {truncated && (
          <p className="org-note" role="status">
            Showing the first pages only — there may be more people than this.
          </p>
        )}

        {undo !== undefined && (
          <div className="org-undo" role="status">
            <span>
              {undo.person.name} is now {orgRoleLabel(undo.to).toLowerCase()}.
            </span>
            <button
              type="button"
              className="org-btn org-undo-btn"
              disabled={busy}
              onClick={() => {
                direct(undo.person, { org_role: undo.from });
              }}
            >
              Undo
            </button>
          </div>
        )}

        <div className="org-people-head" aria-hidden="true">
          <span>Person</span>
          <span>Last sign-in</span>
          <span>Role</span>
        </div>

        {query.space !== '' && spaceError ? (
          <p className="org-note" role="alert">
            Could not read that space’s members.
          </p>
        ) : query.space !== '' && spaceMembers === undefined ? (
          <p className="org-note" role="status">
            Reading that space’s members…
          </p>
        ) : shown.length === 0 ? (
          <p className="org-note org-people-none">
            {filtered ? 'Nobody matches these filters.' : 'Nobody is here yet.'}
          </p>
        ) : (
          <ul className="org-people">
            {shown.map((person) => {
              const ink = avatarColor(person.id, theme);
              const seen = lastSeenLabel(person.last_seen_at, now);
              const mine = person.id === me.id;
              const isOwner = person.org_role === 'owner';
              const showPicker = canChangeRoles && !mine && !isOwner;
              const showDeactivate = canDeactivate && !mine && !isOwner;
              return (
                <li
                  key={person.id}
                  className={`org-person${person.is_active ? '' : ' org-person-inactive'}`}
                >
                  <span
                    className="org-avatar"
                    style={{ background: ink.background, color: ink.foreground }}
                    aria-hidden="true"
                  >
                    {initials(person.name)}
                  </span>
                  <span className="org-person-who">
                    <span className="org-person-name">
                      {/* Their profile, for a reader who may open it (LAI-743). */}
                      <PersonLink
                        userId={person.id}
                        className="org-person-link"
                        label={`Open ${person.name}’s profile`}
                      >
                        {person.name}
                      </PersonLink>
                      {mine && <span className="org-chip org-chip-you">YOU</span>}
                      {!person.is_active && (
                        <span className="org-chip org-chip-off">DEACTIVATED</span>
                      )}
                    </span>
                    <span className="org-person-email">{person.email}</span>
                  </span>

                  <span className="org-person-seen">
                    <span className="visually-hidden">Last sign-in: </span>
                    {seen.iso === '' ? (
                      seen.text
                    ) : (
                      <time dateTime={seen.iso} title={seen.full}>
                        {seen.text}
                      </time>
                    )}
                  </span>

                  {/* **Absent, not disabled**, for somebody who may not manage
                      the org: a greyed control still says "this exists and is
                      yours". An owner's row is text for everyone — the role
                      moves only by Transfer ownership. */}
                  {showPicker ? (
                    <span className="org-person-role-cell">
                      <label className="visually-hidden" htmlFor={`role-${person.id}`}>
                        Org role for {person.name}
                      </label>
                      <Dropdown
                        id={`role-${person.id}`}
                        variant="bare"
                        className="org-role-select"
                        noun="roles"
                        value={person.org_role as OrgRole}
                        disabled={busy}
                        onChange={(role) => {
                          if (role === person.org_role) return;
                          setUndo(undefined);
                          setPending({ kind: 'role', person, role });
                        }}
                        options={PICKABLE.map((r) => ({ value: r, label: orgRoleLabel(r) }))}
                      />
                    </span>
                  ) : (
                    <span className="org-person-role">
                      {orgRoleLabel(person.org_role as OrgRole)}
                    </span>
                  )}

                  {(showPicker || showDeactivate) && (
                    <span className="org-person-controls">
                      {/* **Two verbs, and the copy says which** (D-048). */}
                      {showDeactivate && (
                        <button
                          type="button"
                          className={person.is_active ? 'org-deactivate' : 'org-reactivate'}
                          disabled={busy}
                          onClick={() => {
                            if (person.is_active) {
                              setReassignTo('');
                              setPending({ kind: 'deactivate', person });
                            } else {
                              // Reactivation asks nothing — it takes nobody's access away.
                              direct(person, { is_active: true });
                            }
                          }}
                        >
                          {person.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {rowError !== undefined && (
          <p className="org-error" role="alert">
            {rowError}
          </p>
        )}

        <p className="org-note">
          {canChangeRoles
            ? 'Your own row has no controls. Ownership moves only by Transfer ownership, below. Space roles are managed in each space’s settings.'
            : 'Roles are shown here and changed by the owner. Space roles are managed in each space’s settings.'}
        </p>
      </section>

      {canChangeRoles && extraOwners.length > 0 && (
        <section className="org-card org-extra-owners" aria-labelledby="org-extra-owners">
          <header className="org-card-head">
            <h2 id="org-extra-owners">More than one owner</h2>
            <span className="org-count">{String(extraOwners.length)}</span>
          </header>
          <p className="org-note">
            An organisation has exactly one owner. These people were made owners before that rule;
            nothing has changed for them. Make each an admin when you are ready — or hand the
            organisation to one of them below.
          </p>
          <ul className="org-people">
            {extraOwners.map((extra) => {
              const person = people.find((p) => p.id === extra.id);
              return (
                <li key={extra.id} className="org-person">
                  <span className="org-person-who">
                    <span className="org-person-name">{extra.name}</span>
                    <span className="org-person-email">{extra.email}</span>
                  </span>
                  {person !== undefined && (
                    <button
                      type="button"
                      className="org-btn org-make-admin"
                      disabled={busy}
                      onClick={() => {
                        setUndo(undefined);
                        setPending({ kind: 'role', person, role: 'admin' });
                      }}
                    >
                      Make admin
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {canChangeRoles && <TransferOwnership me={me} people={people} />}

      {pending?.kind === 'role' && (
        <ConfirmDialog
          title={`Make ${pending.person.name} ${article(pending.role)} ${orgRoleLabel(pending.role).toLowerCase()}?`}
          confirmLabel={`Make ${orgRoleLabel(pending.role).toLowerCase()}`}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onClose={close}
        >
          <p>
            {pending.person.name} is {article(pending.person.org_role)}{' '}
            {orgRoleLabel(pending.person.org_role as OrgRole).toLowerCase()} now.{' '}
            {ROLE_CHANGE_NOTE[pending.role]}
          </p>
          <p>You can undo this straight after.</p>
        </ConfirmDialog>
      )}

      {pending?.kind === 'deactivate' && (
        <ConfirmDialog
          title={`Deactivate ${pending.person.name}?`}
          confirmLabel="Deactivate"
          danger
          busy={busy}
          error={error}
          onConfirm={confirm}
          onClose={close}
        >
          <p>
            {pending.person.name} is locked out immediately: every session and every token of theirs
            ends now, and reactivating them later does not bring any back.
          </p>
          <p>
            They leave every space. Their tasks, comments and history stay exactly as they are —
            this is not deletion.
          </p>
          <div className="org-dialog-field">
            <label className="org-dialog-label" htmlFor="org-open-tasks">
              Their open tasks
            </label>
            <Dropdown
              id="org-open-tasks"
              className="org-open-tasks"
              noun="people"
              searchable={people.length > 8}
              value={reassignTo}
              disabled={busy}
              onChange={setReassignTo}
              options={[
                { value: '', label: 'Unassign them' },
                ...people
                  .filter((p) => p.is_active && p.id !== pending.person.id)
                  .map((p) => ({ value: p.id, label: `Reassign to ${p.name}` })),
              ]}
            />
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

/** `an admin`, `a member`. */
function article(role: string): string {
  return /^[aeiou]/i.test(role) ? 'an' : 'a';
}

/** What the new role means, one sentence (§3). */
const ROLE_CHANGE_NOTE: Readonly<Record<OrgRole, string>> = {
  owner: '',
  admin: 'Admins hold whatever the owner grants admins on Roles & permissions.',
  member: 'Members work in the spaces they belong to.',
  viewer: 'Viewers read what they are shown and change nothing; in every space they are viewers.',
};
