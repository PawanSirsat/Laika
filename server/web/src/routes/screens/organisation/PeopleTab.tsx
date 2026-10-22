import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { OffboardingDialog } from '../../../components/OffboardingDialog.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import {
  reissueInvite,
  revokeInvite,
  type OrgRole,
  type PendingInvite,
} from '../../../api/invites.ts';
import type { CapacityView } from '../../../api/presence.ts';
import type { Project } from '../../../api/projects.ts';
import type { OpenTasksChoice } from '../../../api/offboarding.ts';
import { updateUser, type OrgUser } from '../../../api/users.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import { initials } from '../../../theme/initials.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import {
  SORT_LABELS,
  expiryLabel,
  filterPeople,
  invitedLabel,
  lastActive,
  lastSignIn,
  nextSort,
  roleCounts,
  seatLine,
  sortPeople,
  type PeopleFilter,
  type PeopleSort,
} from './people-derive.ts';

export interface PeopleTabProps {
  readonly meId: string;
  readonly theme: Theme;
  readonly people: readonly OrgUser[];
  readonly truncated: boolean;
  readonly invites: readonly PendingInvite[];
  readonly invitesError: unknown;
  /** `GET /capacity`, or `null` when it could not be read. */
  readonly capacity: CapacityView | null;
  /**
   * The server's answers (LAI-970), never the role: `user.invite`,
   * `user.deactivate` and `token.list_any`, each denied until it is known.
   */
  readonly canInvite: boolean;
  readonly canDeactivate: boolean;
  readonly canListTokens: boolean;
  /** Only an owner changes roles (LAI-958); any other manager reads them as text. */
  readonly canChangeRoles: boolean;
  /** The spaces, for the space filter and an invite's *into* line (LAI-999). */
  readonly projects: readonly Project[];
  /** Whose row is being changed, so two clicks cannot race. */
  readonly changing: string | undefined;
  /** The server's refusal, verbatim. */
  readonly roleError: string | undefined;
  /** Resolves `true` when the server took it; a refusal is shown as `roleError`. */
  readonly onChange: (
    id: string,
    patch: { org_role?: string; is_active?: boolean; open_tasks?: OpenTasksChoice },
  ) => Promise<boolean>;
  readonly onTokens: (id: string) => void;
  readonly onInvite: (initialText?: string) => void;
  readonly onReload: () => void;
}

const FILTERS: readonly (readonly [PeopleFilter, string])[] = [
  ['all', 'All'],
  ['owner', 'Owner'],
  ['admin', 'Admin'],
  ['member', 'Member'],
  ['viewer', 'Viewer'],
  ['off', 'Deactivated'],
  ['pending', 'Pending'],
];

/** The roles a picker offers (D-104 item 2): never *Owner* — that is Transfer ownership. */
const PICKABLE: readonly OrgRole[] = ['admin', 'member', 'viewer'];

/** `an admin`, `a member`. */
const article = (role: string): string => (/^[aeiou]/i.test(role) ? 'an' : 'a');

/** What is waiting on a confirmation (LAI-999, from LAI-987). */
type Pending =
  | { readonly kind: 'role'; readonly person: OrgUser; readonly role: OrgRole }
  | { readonly kind: 'bulk-role'; readonly ids: readonly string[]; readonly role: OrgRole }
  | { readonly kind: 'bulk-off'; readonly ids: readonly string[] }
  | { readonly kind: 'revoke'; readonly invite: PendingInvite };

/**
 * The People tab as the owner's "Laika App v3" design draws it (LAI-893): a
 * seat line, a search, the role filters with their counts, a sort, and a
 * table — avatar with a presence dot, name, YOU, email, role, spaces, agents,
 * last active, Tokens and Deactivate — with a bar of bulk actions for the
 * rows ticked, and a Pending filter that lists the invites.
 *
 * **Every figure is the server's.** Spaces, agents and last active come from
 * `GET /capacity`, which anyone signed in may read; when it cannot be read the
 * columns show a dash, and when presence is off they say so. A reader who may
 * not manage the organisation gets the table with no controls at all —
 * absent, not disabled (the rule this screen has kept since LAI-086).
 */
export function PeopleTab({
  meId,
  theme,
  people,
  truncated,
  invites,
  invitesError,
  capacity,
  canInvite,
  canDeactivate,
  canListTokens,
  canChangeRoles,
  projects,
  changing,
  roleError,
  onChange,
  onTokens,
  onInvite,
  onReload,
}: PeopleTabProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [sort, setSort] = useState<PeopleSort>('active');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<string | undefined>(undefined);
  const [inviteError, setInviteError] = useState<unknown>(null);
  /** The space to narrow to, by slug; `''` for every space. */
  const [space, setSpace] = useState('');
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);
  /** The last single role change, while it can be put back. */
  const [undo, setUndo] = useState<
    { readonly person: OrgUser; readonly from: string; readonly to: OrgRole } | undefined
  >(undefined);
  /** Who is being deactivated, through LAI-988's offboarding dialog. */
  const [offboarding, setOffboarding] = useState<OrgUser | undefined>(undefined);
  /** A re-issued link, shown once (LAI-984). */
  const [reissued, setReissued] = useState<
    { readonly email: string | null; readonly url: string } | undefined
  >(undefined);
  const head = useRef<HTMLInputElement | null>(null);
  const now = Date.now();

  const entries = new Map((capacity?.people ?? []).map((e) => [e.user_id, e]));
  const counts = roleCounts(people, invites);
  const shown = sortPeople(
    filterPeople(
      people,
      filter,
      query,
      space === ''
        ? undefined
        : { slug: space, of: (id) => entries.get(id)?.spaces.map((s) => s.slug) },
    ),
    sort,
    meId,
    (id) => entries.get(id)?.last_seen,
  );
  // Whoever may deactivate (or, as owner, change roles) gets controls on
  // anyone's row but their own; each control below asks for its own gate.
  const canManagePeople = canChangeRoles || canDeactivate;
  // An owner's row is text for everyone: the role moves only by Transfer
  // ownership, and the server refuses to deactivate the recorded owner (D-104).
  const editable = (p: OrgUser): boolean =>
    canManagePeople && p.id !== meId && p.org_role !== 'owner';
  const selectable = shown.filter((p) => editable(p) && p.is_active);
  const live = new Set([...selected].filter((id) => selectable.some((p) => p.id === id)));
  const allTicked = selectable.length > 0 && selectable.every((p) => live.has(p.id));
  const someTicked = live.size > 0;
  const busy = changing !== undefined || bulk !== undefined || confirming;

  useEffect(() => {
    if (head.current !== null) head.current.indeterminate = someTicked && !allTicked;
  }, [someTicked, allTicked]);

  const ticked = (): string[] => selectable.filter((p) => live.has(p.id)).map((p) => p.id);

  const runBulk = async (
    label: string,
    ids: readonly string[],
    patch: { org_role?: string; is_active?: boolean; open_tasks?: OpenTasksChoice },
  ) => {
    setBulk(label);
    try {
      for (const id of ids) await onChange(id, patch);
    } finally {
      setBulk(undefined);
      setSelected(new Set());
    }
  };

  const closeConfirm = (): void => {
    setPending(undefined);
    setConfirmError(undefined);
  };

  /** What the dialog's Confirm does; each closes it when the server answers. */
  const confirm = (): void => {
    if (pending === undefined) return;
    if (pending.kind === 'role') {
      const { person, role } = pending;
      setConfirming(true);
      void onChange(person.id, { org_role: role })
        .then((ok) => {
          if (ok) setUndo({ person, from: person.org_role, to: role });
        })
        .finally(() => {
          setConfirming(false);
          closeConfirm();
        });
      return;
    }
    if (pending.kind === 'bulk-role') {
      const { ids, role } = pending;
      closeConfirm();
      void runBulk(role === 'admin' ? 'Making admins' : 'Making members', ids, { org_role: role });
      return;
    }
    if (pending.kind === 'bulk-off') {
      const { ids } = pending;
      closeConfirm();
      // Their open tasks are unassigned — D-104 item 5's pre-selected answer;
      // a reassignment is chosen one person at a time, from their row.
      void runBulk('Deactivating', ids, { is_active: false, open_tasks: 'unassign' });
      return;
    }
    const { invite } = pending;
    setConfirming(true);
    setConfirmError(undefined);
    revokeInvite(invite.id)
      .then(() => {
        closeConfirm();
        onReload();
      })
      .catch((cause: unknown) => {
        setConfirmError(cause instanceof Error ? cause.message : 'Could not revoke that invite.');
      })
      .finally(() => {
        setConfirming(false);
      });
  };

  const reissue = (invite: PendingInvite): void => {
    setInviteError(null);
    reissueInvite(invite.id)
      .then((created) => {
        setReissued({ email: created.invite.email, url: created.accept_url });
        onReload();
      })
      .catch((cause: unknown) => {
        setInviteError(cause);
      });
  };

  const spaceName = (id: string | null): string | undefined =>
    id === null ? undefined : (projects.find((p) => p.id === id)?.name ?? 'a space');

  const filters = FILTERS.filter(
    ([key]) =>
      (key !== 'viewer' || counts.viewer > 0) &&
      (key !== 'off' || counts.off > 0) &&
      (key !== 'pending' || canInvite),
  );
  // Spaces anyone in the table is in, from `GET /capacity` (LAI-999).
  const spaceOptions = projects.filter((p) =>
    (capacity?.people ?? []).some((e) => e.spaces.some((s) => s.slug === p.slug)),
  );

  return (
    <section className="org-card org-people-card" aria-labelledby="org-people">
      <header className="org-card-head org-people-head">
        <h2 id="org-people">People</h2>
        <p className="org-people-seats" data-seat-line>
          {seatLine(people, invites, truncated, canInvite)}
        </p>
      </header>

      {truncated && (
        <p className="org-note org-people-note" role="status">
          Showing the first pages only — there may be more people than this.
        </p>
      )}

      <div className="org-people-tools">
        <label className="org-people-search">
          <span className="org-people-search-glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            className="org-people-search-input"
            data-people-search
            placeholder="Search name or email"
            aria-label="Search name or email"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <div className="org-segmented" role="group" aria-label="Show">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="org-segment"
              data-people-filter={key}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
                setSelected(new Set());
              }}
            >
              {label} <span className="org-segment-count">{String(counts[key])}</span>
            </button>
          ))}
        </div>
        {filter !== 'pending' && spaceOptions.length > 0 && (
          <Dropdown
            variant="bare"
            className="org-people-space"
            aria-label="Filter by space"
            noun="spaces"
            searchable={spaceOptions.length > 8}
            value={space}
            onChange={(next) => {
              setSpace(next);
              setSelected(new Set());
            }}
            options={[
              { value: '', label: 'All spaces' },
              ...spaceOptions.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />
        )}
        <span className="org-people-tools-gap" />
        {filter !== 'pending' && (
          <button
            type="button"
            className="org-people-sort"
            data-people-sort={sort}
            title="Change the order"
            onClick={() => {
              setSort(nextSort(sort));
            }}
          >
            Sort: <strong>{SORT_LABELS[sort]}</strong>
            <span aria-hidden="true">⇅</span>
          </button>
        )}
      </div>

      {canManagePeople && someTicked && (
        <div className="org-bulk" role="group" aria-label="Selected people" data-people-bulk>
          <strong>{String(live.size)} selected</strong>
          {canChangeRoles && (
            <>
              <button
                type="button"
                className="org-bulk-action"
                disabled={busy}
                onClick={() => {
                  setPending({ kind: 'bulk-role', ids: ticked(), role: 'admin' });
                }}
              >
                Make Admin
              </button>
              <button
                type="button"
                className="org-bulk-action"
                disabled={busy}
                onClick={() => {
                  setPending({ kind: 'bulk-role', ids: ticked(), role: 'member' });
                }}
              >
                Make Member
              </button>
            </>
          )}
          {canDeactivate && (
            <button
              type="button"
              className="org-bulk-action org-bulk-danger"
              disabled={busy}
              onClick={() => {
                setPending({ kind: 'bulk-off', ids: ticked() });
              }}
            >
              Deactivate
            </button>
          )}
          {bulk !== undefined && (
            <span className="org-bulk-progress" role="status">
              {bulk}…
            </span>
          )}
          <span className="org-people-tools-gap" />
          <button
            type="button"
            className="org-bulk-clear"
            disabled={busy}
            onClick={() => {
              setSelected(new Set());
            }}
          >
            Clear
          </button>
        </div>
      )}

      {undo !== undefined && (
        <div className="org-undo" role="status" data-people-undo>
          <span>
            {undo.person.name} is now {article(undo.to)} {orgRoleLabel(undo.to).toLowerCase()}.
          </span>
          <button
            type="button"
            className="org-bulk-action org-undo-btn"
            disabled={busy}
            onClick={() => {
              const { person, from } = undo;
              setUndo(undefined);
              void onChange(person.id, { org_role: from });
            }}
          >
            Undo
          </button>
        </div>
      )}

      {filter === 'pending' ? (
        <div className="org-pending" data-people-pending>
          {invitesError !== null && (
            <ApiErrorState
              error={invitesError}
              resource="pending invites"
              scope="organisation"
              onRetry={onReload}
            />
          )}
          {inviteError !== null && (
            <ApiErrorState error={inviteError} resource="this invite" verb="update" />
          )}
          {reissued !== undefined && (
            <div className="org-issued" role="status" data-invite-reissued>
              <p className="org-issued-head">
                New link{reissued.email === null ? '' : ` for ${reissued.email}`} — shown once
              </p>
              <p className="org-issued-body">
                The old link no longer works. The server stores only a hash of this one; send it
                now.
              </p>
              <code className="org-issued-url">{reissued.url}</code>
              <span className="org-issued-actions">
                <CopyButton
                  text={reissued.url}
                  label="Copy link"
                  what={`the invite link for ${reissued.email ?? 'anyone'}`}
                />
                <button
                  type="button"
                  className="org-bulk-clear"
                  onClick={() => {
                    setReissued(undefined);
                  }}
                >
                  Done
                </button>
              </span>
            </div>
          )}
          {invites.length === 0 && invitesError === null ? (
            <p className="org-pending-empty">No pending invites.</p>
          ) : (
            <ul className="org-invites">
              {invites.map((invite) => {
                const by = people.find((p) => p.id === invite.created_by)?.name;
                const into = spaceName(invite.project_id);
                return (
                  <li key={invite.id} data-invite={invite.id}>
                    <span className="org-invite-glyph" aria-hidden="true">
                      {invite.email === null ? '⛓' : '@'}
                    </span>
                    <span className="org-invite-who">
                      <span className="org-person-name">
                        {invite.email ?? 'Anyone with the link'}
                        <span className="org-chip">{orgRoleLabel(invite.org_role)}</span>
                      </span>
                      <span className="org-person-email">
                        {into !== undefined &&
                          `into ${into}${invite.project_role === null ? '' : ` as ${invite.project_role === 'lead' ? 'space admin' : invite.project_role}`} · `}
                        {invite.email === null
                          ? `expires ${expiryLabel(invite.expires_at, now)}`
                          : `invited ${invitedLabel(invite.created_at, now)}${by === undefined ? '' : ` by ${by}`} · expires ${expiryLabel(invite.expires_at, now)}`}
                        {/* SMTP is unconfigured (LAI-206), so nothing has been emailed.
                            Saying so beats letting someone assume it was. */}
                        {!invite.email_sent && ' · not emailed — send the link yourself'}
                      </span>
                    </span>
                    <span className="org-invite-actions">
                      <button
                        type="button"
                        className="org-invite-reissue"
                        data-invite-reissue
                        title="A new link for the same person and roles; the old one stops working"
                        onClick={() => {
                          reissue(invite);
                        }}
                      >
                        Re-issue
                      </button>
                      <button
                        type="button"
                        className="org-invite-revoke"
                        onClick={() => {
                          setConfirmError(undefined);
                          setPending({ kind: 'revoke', invite });
                        }}
                      >
                        Revoke
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="org-people-scroll">
            <div className="org-people-table" role="table" aria-label="People">
              <div className="org-people-row org-people-header" role="row">
                <span role="columnheader" className="org-people-tick">
                  {canManagePeople && selectable.length > 0 && (
                    <input
                      ref={head}
                      type="checkbox"
                      className="org-check"
                      data-people-tick-all
                      checked={allTicked}
                      disabled={busy}
                      aria-label="Select every person shown"
                      onChange={() => {
                        setSelected(allTicked ? new Set() : new Set(selectable.map((p) => p.id)));
                      }}
                    />
                  )}
                </span>
                <span role="columnheader">Person</span>
                <span role="columnheader">Role</span>
                <span role="columnheader">Spaces</span>
                <span role="columnheader">Agents</span>
                <span role="columnheader">Last active</span>
                <span role="columnheader">Last sign-in</span>
                <span role="columnheader" className="visually-hidden">
                  Actions
                </span>
              </div>

              {shown.map((person) => {
                const ink = avatarColor(person.id, theme);
                const entry = entries.get(person.id);
                const seen = lastActive(entry, capacity?.enabled, person.is_active, now);
                const signedIn = lastSignIn(person.last_seen_at, now);
                const online = person.is_active && entry?.status === 'online';
                const agents = entry?.agents.length;
                const running = entry?.agents.some((a) => a.running) === true;
                const mine = editable(person);
                const ticked = live.has(person.id);
                return (
                  <div
                    key={person.id}
                    role="row"
                    className={[
                      'org-people-row',
                      'org-person',
                      person.is_active ? '' : 'org-person-inactive',
                      ticked ? 'org-person-ticked' : '',
                    ]
                      .filter((c) => c !== '')
                      .join(' ')}
                    data-person={person.id}
                  >
                    <span role="cell" className="org-people-tick">
                      {mine && person.is_active && (
                        <input
                          type="checkbox"
                          className="org-check"
                          data-people-tick={person.id}
                          checked={ticked}
                          disabled={busy}
                          aria-label={`Select ${person.name}`}
                          onChange={(event) => {
                            const next = new Set(live);
                            if (event.target.checked) next.add(person.id);
                            else next.delete(person.id);
                            setSelected(next);
                          }}
                        />
                      )}
                    </span>
                    <span role="cell" className="org-people-person">
                      <span className="org-avatar-wrap">
                        <span
                          className="org-avatar"
                          style={{ background: ink.background, color: ink.foreground }}
                          aria-hidden="true"
                        >
                          {initials(person.name)}
                        </span>
                        {online && (
                          <span className="org-presence-dot" title="Active now" data-online />
                        )}
                      </span>
                      <span className="org-person-who">
                        <span className="org-person-name">
                          {/* Their profile, for a reader who may open it (LAI-743);
                              plain text for anyone else. */}
                          <PersonLink
                            userId={person.id}
                            className="org-person-link"
                            label={`Open ${person.name}’s profile`}
                          >
                            {person.name}
                          </PersonLink>
                          {person.id === meId && <span className="org-chip org-chip-you">YOU</span>}
                          {!person.is_active && (
                            <span className="org-chip org-chip-off">DEACTIVATED</span>
                          )}
                        </span>
                        <span className="org-person-email">{person.email}</span>
                      </span>
                    </span>
                    <span role="cell" className="org-people-role">
                      {canChangeRoles && mine && person.is_active ? (
                        <>
                          <label className="visually-hidden" htmlFor={`role-${person.id}`}>
                            Org role for {person.name}
                          </label>
                          {/* Never Owner (D-104 item 2): there is one, and it moves
                              by Transfer ownership. A change asks first. */}
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
                        </>
                      ) : (
                        <span
                          className={
                            person.org_role === 'owner'
                              ? 'org-person-role org-person-role-owner'
                              : 'org-person-role'
                          }
                        >
                          {orgRoleLabel(person.org_role as OrgRole)}
                        </span>
                      )}
                    </span>
                    <span role="cell" className="org-people-num" data-spaces>
                      {entry === undefined ? '—' : String(entry.spaces.length)}
                    </span>
                    <span role="cell" className="org-people-num" data-agents>
                      <span
                        className={running ? 'org-agent-dot org-agent-dot-on' : 'org-agent-dot'}
                        aria-hidden="true"
                      />
                      {agents === undefined ? '—' : String(agents)}
                    </span>
                    <span
                      role="cell"
                      className={`org-people-seen org-people-seen-${seen.tone}`}
                      data-last-active
                      title={seen.note}
                    >
                      {seen.text}
                    </span>
                    <span
                      role="cell"
                      className={`org-people-seen org-people-seen-${signedIn.tone}`}
                      data-last-sign-in
                    >
                      {signedIn.text}
                    </span>
                    <span role="cell" className="org-people-actions">
                      {mine && person.is_active && (
                        <>
                          {canListTokens && (
                            <button
                              type="button"
                              className="org-tokens-open"
                              disabled={busy}
                              onClick={() => {
                                onTokens(person.id);
                              }}
                            >
                              Tokens
                            </button>
                          )}
                          {/* **Two verbs, and the copy says which** (D-048). */}
                          {canDeactivate && (
                            <button
                              type="button"
                              className="org-deactivate"
                              disabled={busy}
                              onClick={() => {
                                setOffboarding(person);
                              }}
                            >
                              Deactivate
                            </button>
                          )}
                        </>
                      )}
                      {mine && !person.is_active && canDeactivate && (
                        <button
                          type="button"
                          className="org-reactivate"
                          disabled={busy}
                          onClick={() => {
                            void onChange(person.id, { is_active: true });
                          }}
                        >
                          Reactivate
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}

              {shown.length === 0 && (
                <div className="org-people-empty" data-people-empty>
                  <p className="org-people-empty-title">
                    {query.trim() === '' ? 'No one here' : `No one matches “${query.trim()}”`}
                  </p>
                  <p className="org-people-empty-body">
                    {query.trim() === ''
                      ? 'Nobody has this role.'
                      : 'Check the spelling, or invite them to the organisation.'}
                  </p>
                  {canInvite && (
                    <button
                      type="button"
                      className="org-people-empty-invite"
                      onClick={() => {
                        onInvite(query.includes('@') ? query.trim() : '');
                      }}
                    >
                      Invite someone
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {roleError !== undefined && (
            /* **The server's refusal, verbatim.** The last-owner invariant lives
               there; a client rule invented to pre-empt it could disagree in
               either direction. */
            <p className="org-error org-people-error" role="alert">
              {roleError}
            </p>
          )}

          <footer className="org-people-foot">
            <span className="org-people-shown" data-people-shown>
              Showing {String(shown.length)} of {String(people.length)}
              {truncated ? '+' : ''}
            </span>
            <span className="org-people-foot-note">
              {canManagePeople
                ? 'Your own row has no controls — changing your own role or locking yourself out is not something this screen offers. Project roles are managed on each project’s members screen.'
                : 'Roles are shown here and changed by an admin. Project roles are managed on each project’s members screen.'}
            </span>
          </footer>
        </>
      )}

      {pending !== undefined && (
        <ConfirmDialog
          {...confirmCopy(pending)}
          busy={confirming}
          error={confirmError}
          onConfirm={confirm}
          onClose={closeConfirm}
        />
      )}

      {offboarding !== undefined && (
        <OffboardingDialog
          title={`Deactivate ${offboarding.name}?`}
          verb="Deactivate"
          leavingId={offboarding.id}
          consequences={
            <>
              <p>
                {offboarding.name} will not be able to sign in. Their tasks, comments and history
                stay exactly as they are — this is not deletion.
              </p>
              <ul>
                <li>Every session and every token of theirs ends now.</li>
                <li>They are removed from every space.</li>
                <li>Reactivating lets them sign in again; it does not bring those back.</li>
              </ul>
            </>
          }
          loadCandidates={() =>
            Promise.resolve(
              people
                .filter((p) => p.is_active && p.id !== offboarding.id)
                .map((p) => ({ id: p.id, name: p.name })),
            )
          }
          run={async (openTasks) => {
            await updateUser(offboarding.id, {
              is_active: false,
              ...(openTasks === undefined ? {} : { open_tasks: openTasks }),
            });
          }}
          onDone={() => {
            setOffboarding(undefined);
            setUndo(undefined);
            onReload();
          }}
          onClose={() => {
            setOffboarding(undefined);
          }}
        />
      )}
    </section>
  );
}

/** The words of each confirmation: who, what changes, what is kept. */
function confirmCopy(pending: Pending): {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  children: ReactNode;
} {
  const many = (n: number): string => `${String(n)} ${n === 1 ? 'person' : 'people'}`;
  switch (pending.kind) {
    case 'role':
      return {
        title: `Make ${pending.person.name} ${article(pending.role)} ${orgRoleLabel(pending.role).toLowerCase()}?`,
        confirmLabel: `Make ${orgRoleLabel(pending.role).toLowerCase()}`,
        children: (
          <p>
            {pending.person.name} is {article(pending.person.org_role)}{' '}
            {orgRoleLabel(pending.person.org_role as OrgRole).toLowerCase()} now. You can undo this
            straight after.
          </p>
        ),
      };
    case 'bulk-role':
      return {
        title: `Make ${many(pending.ids.length)} ${orgRoleLabel(pending.role).toLowerCase()}s?`,
        confirmLabel: `Make ${orgRoleLabel(pending.role).toLowerCase()}`,
        children: <p>Each changes at once; a refusal for anyone is shown under the table.</p>,
      };
    case 'bulk-off':
      return {
        title: `Deactivate ${many(pending.ids.length)}?`,
        confirmLabel: 'Deactivate',
        danger: true,
        children: (
          <>
            <p>
              They are locked out immediately: every session and token of theirs ends, and they
              leave every space. Their tasks, comments and history stay — this is not deletion.
            </p>
            <p>
              Their open tasks are unassigned. To hand one person’s work to someone, deactivate them
              from their own row.
            </p>
          </>
        ),
      };
    case 'revoke':
      return {
        title: `Revoke the invite for ${pending.invite.email ?? 'anyone with the link'}?`,
        confirmLabel: 'Revoke invite',
        danger: true,
        children: <p>The link stops working at once. To invite them again, create a new invite.</p>,
      };
  }
}
