import { useEffect, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { ORG_ROLES, revokeInvite, type OrgRole, type PendingInvite } from '../../../api/invites.ts';
import type { CapacityView } from '../../../api/presence.ts';
import type { OrgUser } from '../../../api/users.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import { initials } from '../../../theme/initials.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import {
  SORT_LABELS,
  expiryLabel,
  filterPeople,
  invitedLabel,
  lastActive,
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
  readonly canManage: boolean;
  /** Only an owner changes roles (LAI-958); any other manager reads them as text. */
  readonly canChangeRoles: boolean;
  /** Whose row is being changed, so two clicks cannot race. */
  readonly changing: string | undefined;
  /** The server's refusal, verbatim. */
  readonly roleError: string | undefined;
  readonly onChange: (
    id: string,
    patch: { org_role?: string; is_active?: boolean },
  ) => Promise<void>;
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
  ['pending', 'Pending'],
];

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
  canManage,
  canChangeRoles,
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
  const head = useRef<HTMLInputElement | null>(null);
  const now = Date.now();

  const entries = new Map((capacity?.people ?? []).map((e) => [e.user_id, e]));
  const counts = roleCounts(people, invites);
  const shown = sortPeople(
    filterPeople(people, filter, query),
    sort,
    meId,
    (id) => entries.get(id)?.last_seen,
  );
  // A manager may deactivate, reactivate and open tokens for anyone but
  // themselves; the role picker is the owner's alone (`canChangeRoles`).
  const editable = (p: OrgUser): boolean => canManage && p.id !== meId;
  const selectable = shown.filter((p) => editable(p) && p.is_active);
  const live = new Set([...selected].filter((id) => selectable.some((p) => p.id === id)));
  const allTicked = selectable.length > 0 && selectable.every((p) => live.has(p.id));
  const someTicked = live.size > 0;
  const busy = changing !== undefined || bulk !== undefined;

  useEffect(() => {
    if (head.current !== null) head.current.indeterminate = someTicked && !allTicked;
  }, [someTicked, allTicked]);

  const runBulk = async (label: string, patch: { org_role?: string; is_active?: boolean }) => {
    const ids = selectable.filter((p) => live.has(p.id)).map((p) => p.id);
    if (ids.length === 0) return;
    if (
      patch.is_active === false &&
      !window.confirm(
        `Deactivate ${String(ids.length)} ${ids.length === 1 ? 'person' : 'people'}? They are locked out immediately. Their tasks, comments and history stay exactly as they are — this is not deletion.`,
      )
    ) {
      return;
    }
    setBulk(label);
    try {
      for (const id of ids) await onChange(id, patch);
    } finally {
      setBulk(undefined);
      setSelected(new Set());
    }
  };

  const filters = FILTERS.filter(
    ([key]) => (key !== 'viewer' || counts.viewer > 0) && (key !== 'pending' || canManage),
  );

  return (
    <section className="org-card org-people-card" aria-labelledby="org-people">
      <header className="org-card-head org-people-head">
        <h2 id="org-people">People</h2>
        <p className="org-people-seats" data-seat-line>
          {seatLine(people, invites, truncated, canManage)}
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

      {canManage && someTicked && (
        <div className="org-bulk" role="group" aria-label="Selected people" data-people-bulk>
          <strong>{String(live.size)} selected</strong>
          {canChangeRoles && (
            <>
              <button
                type="button"
                className="org-bulk-action"
                disabled={busy}
                onClick={() => {
                  void runBulk('Making admins', { org_role: 'admin' });
                }}
              >
                Make Admin
              </button>
              <button
                type="button"
                className="org-bulk-action"
                disabled={busy}
                onClick={() => {
                  void runBulk('Making members', { org_role: 'member' });
                }}
              >
                Make Member
              </button>
            </>
          )}
          <button
            type="button"
            className="org-bulk-action org-bulk-danger"
            disabled={busy}
            onClick={() => {
              void runBulk('Deactivating', { is_active: false });
            }}
          >
            Deactivate
          </button>
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
            <ApiErrorState error={inviteError} resource="this invite" verb="revoke" />
          )}
          {invites.length === 0 && invitesError === null ? (
            <p className="org-pending-empty">No pending invites.</p>
          ) : (
            <ul className="org-invites">
              {invites.map((invite) => {
                const by = people.find((p) => p.id === invite.created_by)?.name;
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
                        {invite.email === null
                          ? `expires ${expiryLabel(invite.expires_at, now)}`
                          : `invited ${invitedLabel(invite.created_at, now)}${by === undefined ? '' : ` by ${by}`} · expires ${expiryLabel(invite.expires_at, now)}`}
                        {/* SMTP is unconfigured (LAI-206), so nothing has been emailed.
                            Saying so beats letting someone assume it was. */}
                        {!invite.email_sent && ' · not emailed — send the link yourself'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="org-invite-revoke"
                      onClick={() => {
                        setInviteError(null);
                        revokeInvite(invite.id)
                          .then(onReload)
                          .catch((cause: unknown) => {
                            setInviteError(cause);
                          });
                      }}
                    >
                      Revoke
                    </button>
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
                  {canManage && selectable.length > 0 && (
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
                <span role="columnheader" className="visually-hidden">
                  Actions
                </span>
              </div>

              {shown.map((person) => {
                const ink = avatarColor(person.id, theme);
                const entry = entries.get(person.id);
                const seen = lastActive(entry, capacity?.enabled, person.is_active, now);
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
                          {/* Every role, Owner included: the owner grants any, and
                              whether this one is the last owner is the server's
                              to say (D-102 rule 5, LAI-958). */}
                          <Dropdown
                            id={`role-${person.id}`}
                            variant="bare"
                            className="org-role-select"
                            noun="roles"
                            value={person.org_role}
                            disabled={busy}
                            onChange={(value) => {
                              void onChange(person.id, { org_role: value });
                            }}
                            options={ORG_ROLES.map((r) => ({ value: r, label: orgRoleLabel(r) }))}
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
                    <span role="cell" className="org-people-actions">
                      {mine && person.is_active && (
                        <>
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
                          {/* **Two verbs, and the copy says which** (D-048). */}
                          <button
                            type="button"
                            className="org-deactivate"
                            disabled={busy}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Deactivate ${person.name}? They are locked out immediately. Their tasks, comments and history stay exactly as they are — this is not deletion.`,
                                )
                              ) {
                                return;
                              }
                              void onChange(person.id, { is_active: false });
                            }}
                          >
                            Deactivate
                          </button>
                        </>
                      )}
                      {mine && !person.is_active && (
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
                  {canManage && (
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
              {canManage
                ? 'Your own row has no controls — changing your own role or locking yourself out is not something this screen offers. Project roles are managed on each project’s members screen.'
                : 'Roles are shown here and changed by an admin. Project roles are managed on each project’s members screen.'}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
