import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import {
  OffboardingDialog,
  type ReassignCandidate,
} from '../../../components/OffboardingDialog.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { everyPage } from '../../../api/every-page.ts';
import {
  ROLE_SUMMARY,
  addMember,
  listMembers,
  projectRoleLabel,
  removeMember,
  type ProjectRole,
} from '../../../api/members.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { Gates } from '../../../api/permissions.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { dateTime } from '../../../api/time-label.ts';
import {
  lastUsedLabel,
  listUserTokens,
  revokeUserToken,
  tokenState,
  type TokenView,
} from '../../../api/tokens.ts';
import {
  issueResetLink,
  listAllUsers,
  listMemberships,
  signOutEverywhere,
  updateUser,
  type PersonMembership,
  type ResetLinkView,
} from '../../../api/users.ts';
import type { OrgRole } from '../../../api/invites.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import './admin-panel.css';

/** The person the panel manages, as the profile carries them. */
export interface AdminSubject {
  readonly id: string;
  readonly name: string;
  readonly org_role: string;
  readonly is_active: boolean;
}

export interface AdminPanelProps {
  readonly user: AdminSubject;
  readonly me: MeProfile;
  readonly gates: Gates;
  /** Their role or active state changed: read the profile again. */
  readonly onChanged: () => void;
}

/**
 * The roles the owner may give (D-104 item 2): never Owner — ownership is
 * transferred, which is its own control (LAI-987), not a role in a picker.
 */
const ASSIGNABLE_ROLES: readonly OrgRole[] = ['admin', 'member', 'viewer'];
/** The order the space settings' add control reads in. */
const ADD_ROLES: readonly ProjectRole[] = ['member', 'lead', 'viewer'];

function said(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Nothing changed.';
}

/** What each gate is, per person — computed once so the panel and its tests agree. */
export interface AdminControls {
  readonly role: boolean;
  readonly deactivate: boolean;
  readonly signOut: boolean;
  readonly resetLink: boolean;
  readonly tokens: boolean;
  readonly revokeTokens: boolean;
  readonly spaces: boolean;
}

/**
 * Which controls this reader gets on this person's profile. **Every one is the
 * server's answer** (`GET /permissions`, LAI-970), never a role — except the
 * two D-104 rules that are about the owner as a person: nobody changes the
 * owner's role or deactivates them here (transfer is how ownership moves), and
 * only the owner issues the owner a reset link (`user.reset_password`'s
 * condition, which `/permissions` cannot answer per target).
 *
 * *Sign out everywhere* for somebody else is carried by *Deactivate people and
 * reset access* with `user.deactivate` (LAI-985). `user.sign_out` alone is held
 * by everyone, about themselves, so it cannot be the gate for another person.
 */
export function adminControls(
  gates: Pick<Gates, 'org'>,
  me: Pick<MeProfile, 'id' | 'org_role'>,
  user: AdminSubject,
): AdminControls {
  const other = me.id !== user.id;
  const theOwner = user.org_role === 'owner';
  return {
    role: other && !theOwner && gates.org('user.set_role'),
    deactivate: other && !theOwner && gates.org('user.deactivate'),
    signOut: other && user.is_active && gates.org('user.deactivate') && gates.org('user.sign_out'),
    resetLink:
      other &&
      user.is_active &&
      gates.org('user.reset_password') &&
      (!theOwner || me.org_role === 'owner'),
    tokens: other && gates.org('token.list_any'),
    revokeTokens: other && gates.org('token.list_any') && gates.org('token.revoke_any'),
    spaces: other && gates.org('member_list.read'),
  };
}

export function anyAdminControl(controls: AdminControls): boolean {
  return Object.values(controls).some(Boolean);
}

/**
 * The Admin panel on a member profile (D-104, LAI-988): everything an owner or
 * admin does to one person, on that person's page — their role, their access,
 * their tokens and their spaces. Each control is drawn only when the server
 * says the reader may use it; a reader with none sees no panel at all.
 *
 * Every destructive change asks first. Deactivating and removing from a space
 * go through the offboarding dialog, which asks about their open tasks.
 */
export function AdminPanel({ user, me, gates, onChanged }: AdminPanelProps) {
  const controls = adminControls(gates, me, user);
  if (!anyAdminControl(controls)) return null;

  return (
    <section
      className="prof-card prof-admin"
      data-section="admin"
      aria-labelledby="prof-admin-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="prof-admin-title">
          Admin
        </h3>
        <span className="prof-card-caption">
          Only people allowed to manage {user.name} see this
        </span>
      </header>

      <div className="prof-admin-grid">
        {(controls.role || controls.deactivate || controls.signOut || controls.resetLink) && (
          <AccessBlock user={user} controls={controls} onChanged={onChanged} />
        )}
        {controls.tokens && <TokensBlock user={user} mayRevoke={controls.revokeTokens} />}
        {controls.spaces && <SpacesBlock user={user} gates={gates} />}
      </div>
    </section>
  );
}

function Block({
  name,
  title,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="prof-admin-block" data-admin={name}>
      <h4 className="prof-admin-title">{title}</h4>
      {children}
    </div>
  );
}

function Confirm({
  question,
  yes,
  busy,
  danger = false,
  onYes,
  onNo,
}: {
  readonly question: string;
  readonly yes: string;
  readonly busy: boolean;
  readonly danger?: boolean;
  readonly onYes: () => void;
  readonly onNo: () => void;
}) {
  return (
    <span className="prof-admin-confirm" role="group" aria-label={question}>
      <span>{question}</span>
      <button
        type="button"
        className={
          danger ? 'prof-admin-btn prof-admin-btn-danger' : 'prof-admin-btn prof-admin-btn-primary'
        }
        data-action="admin-confirm"
        disabled={busy}
        onClick={onYes}
      >
        {busy && <Spinner size="sm" />}
        {yes}
      </button>
      <button type="button" className="prof-admin-btn" disabled={busy} onClick={onNo}>
        Cancel
      </button>
    </span>
  );
}

function Problem({ text }: { readonly text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <p className="prof-admin-error" role="alert">
      {text}
    </p>
  );
}

// ------------------------------------------------------------------ access

type Asking = 'role' | 'reactivate' | 'sign-out' | 'reset' | undefined;

function AccessBlock({
  user,
  controls,
  onChanged,
}: {
  readonly user: AdminSubject;
  readonly controls: AdminControls;
  readonly onChanged: () => void;
}) {
  const [asking, setAsking] = useState<Asking>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [role, setRole] = useState<string>(user.org_role);
  const [offboarding, setOffboarding] = useState(false);
  /**
   * The reset link, **shown once**: held here while it is on screen and nowhere
   * else, and gone when the panel goes (another person, another page).
   */
  const [link, setLink] = useState<ResetLinkView | undefined>(undefined);

  useEffect(() => {
    setRole(user.org_role);
  }, [user.org_role]);

  const act = (call: () => Promise<void>): void => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    call()
      .catch((cause: unknown) => {
        setError(said(cause));
      })
      .finally(() => {
        setBusy(false);
        setAsking(undefined);
      });
  };

  const loadCandidates = useCallback(
    async (): Promise<readonly ReassignCandidate[]> =>
      (await listAllUsers()).users.map((p) => ({ id: p.id, name: p.name })),
    [],
  );

  return (
    <Block name="access" title="Role and access">
      {controls.role && (
        <div className="prof-admin-row" data-admin-row="role">
          <span className="prof-admin-label" id="prof-admin-role">
            Organisation role
          </span>
          <Dropdown
            aria-labelledby="prof-admin-role"
            noun="roles"
            value={role}
            disabled={busy}
            onChange={(value) => {
              setRole(value);
              setAsking(value === user.org_role ? undefined : 'role');
            }}
            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: orgRoleLabel(r) }))}
          />
          {asking === 'role' && (
            <Confirm
              question={`Make ${user.name} ${orgRoleLabel(role as OrgRole)}?`}
              yes="Change role"
              busy={busy}
              onYes={() => {
                act(async () => {
                  await updateUser(user.id, { org_role: role });
                  setNotice(`${user.name} is now ${orgRoleLabel(role as OrgRole)}.`);
                  onChanged();
                });
              }}
              onNo={() => {
                setRole(user.org_role);
                setAsking(undefined);
              }}
            />
          )}
        </div>
      )}

      {controls.deactivate && (
        <div className="prof-admin-row" data-admin-row="active">
          <span className="prof-admin-label">{user.is_active ? 'Active' : 'Deactivated'}</span>
          {user.is_active ? (
            <button
              type="button"
              className="prof-admin-btn prof-admin-btn-danger-quiet"
              data-action="deactivate"
              disabled={busy}
              onClick={() => {
                setNotice(undefined);
                setOffboarding(true);
              }}
            >
              Deactivate…
            </button>
          ) : asking === 'reactivate' ? (
            <Confirm
              question={`Reactivate ${user.name}?`}
              yes="Reactivate"
              busy={busy}
              onYes={() => {
                act(async () => {
                  await updateUser(user.id, { is_active: true });
                  setNotice(
                    `${user.name} can sign in again. Their old sessions and tokens stay ended.`,
                  );
                  onChanged();
                });
              }}
              onNo={() => {
                setAsking(undefined);
              }}
            />
          ) : (
            <button
              type="button"
              className="prof-admin-btn"
              data-action="reactivate"
              disabled={busy}
              onClick={() => {
                setAsking('reactivate');
              }}
            >
              Reactivate
            </button>
          )}
        </div>
      )}

      {controls.signOut && (
        <div className="prof-admin-row" data-admin-row="sign-out">
          <span className="prof-admin-label">Sessions</span>
          {asking === 'sign-out' ? (
            <Confirm
              question={`Sign ${user.name} out everywhere?`}
              yes="Sign out"
              busy={busy}
              danger
              onYes={() => {
                act(async () => {
                  const done = await signOutEverywhere(user.id);
                  setNotice(
                    done.sessions_ended === 0
                      ? `${user.name} was not signed in anywhere.`
                      : `Ended ${String(done.sessions_ended)} session${done.sessions_ended === 1 ? '' : 's'}. Their tokens still work.`,
                  );
                });
              }}
              onNo={() => {
                setAsking(undefined);
              }}
            />
          ) : (
            <button
              type="button"
              className="prof-admin-btn"
              data-action="sign-out"
              disabled={busy}
              onClick={() => {
                setAsking('sign-out');
              }}
            >
              Sign out everywhere
            </button>
          )}
        </div>
      )}

      {controls.resetLink && (
        <div className="prof-admin-row" data-admin-row="reset">
          <span className="prof-admin-label">Password</span>
          {asking === 'reset' ? (
            <Confirm
              question={`Create a reset link for ${user.name}? Any earlier link stops working.`}
              yes="Create link"
              busy={busy}
              onYes={() => {
                act(async () => {
                  setLink(await issueResetLink(user.id));
                });
              }}
              onNo={() => {
                setAsking(undefined);
              }}
            />
          ) : (
            <button
              type="button"
              className="prof-admin-btn"
              data-action="reset-link"
              disabled={busy || link !== undefined}
              onClick={() => {
                setNotice(undefined);
                setAsking('reset');
              }}
            >
              Create reset link
            </button>
          )}
        </div>
      )}

      {link !== undefined && (
        <ResetLinkBox
          user={user}
          link={link}
          onDone={() => {
            setLink(undefined);
          }}
        />
      )}

      <Problem text={error} />
      {notice !== undefined && (
        <p className="prof-admin-notice" role="status">
          {notice}
        </p>
      )}

      {offboarding && (
        <OffboardingDialog
          title={`Deactivate ${user.name}?`}
          verb="Deactivate"
          leavingId={user.id}
          consequences={
            <>
              <p>{user.name} will not be able to sign in. Their history stays.</p>
              <ul>
                <li>Every session and every token of theirs ends now.</li>
                <li>They are removed from every space.</li>
                <li>Reactivating lets them sign in again; it does not bring those back.</li>
              </ul>
            </>
          }
          loadCandidates={loadCandidates}
          run={async (openTasks) => {
            await updateUser(user.id, {
              is_active: false,
              ...(openTasks === undefined ? {} : { open_tasks: openTasks }),
            });
          }}
          onDone={() => {
            setOffboarding(false);
            setNotice(`${user.name} has been deactivated.`);
            onChanged();
          }}
          onClose={() => {
            setOffboarding(false);
          }}
        />
      )}
    </Block>
  );
}

/** The link, once: the text to copy, when it expires, and a way to put it away. */
function ResetLinkBox({
  user,
  link,
  onDone,
}: {
  readonly user: AdminSubject;
  readonly link: ResetLinkView;
  readonly onDone: () => void;
}) {
  return (
    <div className="prof-admin-secret" data-reset-link>
      <p className="prof-admin-secret-head">
        <b>Reset link for {user.name}</b> — shown once. Send it to them directly; it expires{' '}
        {dateTime(link.expires_at, Date.now())} and works one time.
      </p>
      <div className="prof-admin-secret-row">
        <code className="prof-admin-secret-text" data-reset-url>
          {link.url}
        </code>
        <CopyButton text={link.url} what="reset link" />
      </div>
      <button type="button" className="prof-admin-btn" data-action="reset-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ tokens

type TokensLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: string }
  | { readonly kind: 'ready'; readonly tokens: readonly TokenView[]; readonly truncated: boolean };

function TokensBlock({
  user,
  mayRevoke,
}: {
  readonly user: AdminSubject;
  readonly mayRevoke: boolean;
}) {
  const [load, setLoad] = useState<TokensLoad>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listUserTokens(user.id, controller.signal, cursor === undefined ? {} : { cursor }),
    ).then(
      (all) => {
        setLoad({ kind: 'ready', tokens: all.items, truncated: all.truncated });
      },
      (cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoad({ kind: 'error', error: said(cause) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [user.id, attempt]);

  const now = Date.now();
  const live =
    load.kind === 'ready' ? load.tokens.filter((t) => tokenState(t, now) === 'active') : [];

  return (
    <Block name="tokens" title="Their tokens">
      {load.kind === 'loading' && (
        <p className="prof-admin-muted" role="status">
          <Spinner size="sm" /> Reading their tokens…
        </p>
      )}
      {load.kind === 'error' && <Problem text={load.error} />}
      {load.kind === 'ready' &&
        (live.length === 0 ? (
          <p className="prof-admin-muted">No working tokens.</p>
        ) : (
          <ul className="prof-admin-list">
            {live.map((token) => (
              <li key={token.id} className="prof-admin-item" data-token={token.id}>
                <span className="prof-admin-item-main">
                  <span className="prof-admin-item-name">{token.name}</span>
                  <span className="prof-admin-item-meta">
                    <code>{token.prefix}…</code> ·{' '}
                    {token.scope === 'read_only' ? 'Read only' : 'Full'} ·{' '}
                    {lastUsedLabel(token.last_used_at, now)}
                  </span>
                </span>
                {mayRevoke &&
                  (asking === token.id ? (
                    <Confirm
                      question={`Revoke ${token.name}?`}
                      yes="Revoke"
                      danger
                      busy={busy}
                      onYes={() => {
                        setBusy(true);
                        setError(undefined);
                        revokeUserToken(user.id, token.id)
                          .then(() => {
                            setAttempt((n) => n + 1);
                          })
                          .catch((cause: unknown) => {
                            setError(said(cause));
                          })
                          .finally(() => {
                            setBusy(false);
                            setAsking(undefined);
                          });
                      }}
                      onNo={() => {
                        setAsking(undefined);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="prof-admin-btn prof-admin-btn-quiet"
                      data-action="revoke-token"
                      aria-label={`Revoke ${token.name}`}
                      disabled={busy}
                      onClick={() => {
                        setAsking(token.id);
                      }}
                    >
                      Revoke
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        ))}
      {load.kind === 'ready' && load.truncated && (
        <p className="prof-admin-muted">Only the first pages are shown.</p>
      )}
      <Problem text={error} />
    </Block>
  );
}

// ------------------------------------------------------------------ spaces

type SpacesLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: string }
  | { readonly kind: 'ready'; readonly memberships: readonly PersonMembership[] };

function SpacesBlock({ user, gates }: { readonly user: AdminSubject; readonly gates: Gates }) {
  const [load, setLoad] = useState<SpacesLoad>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [spaces, setSpaces] = useState<readonly Project[] | undefined>(undefined);
  const [removing, setRemoving] = useState<PersonMembership | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    listMemberships(user.id, controller.signal).then(
      (page) => {
        setLoad({ kind: 'ready', memberships: page.data });
      },
      (cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoad({ kind: 'error', error: said(cause) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [user.id, attempt]);

  // The spaces they could be added to: every live one the reader manages.
  useEffect(() => {
    if (!user.is_active) return;
    const controller = new AbortController();
    everyPage((cursor) =>
      listProjects(cursor === undefined ? {} : { cursor }, controller.signal),
    ).then(
      (all) => {
        setSpaces(all.items.filter(isProject));
      },
      () => {
        setSpaces([]);
      },
    );
    return () => {
      controller.abort();
    };
  }, [user.is_active]);

  const reload = (): void => {
    setAttempt((n) => n + 1);
  };

  const memberships = load.kind === 'ready' ? load.memberships : [];
  const addable = (spaces ?? []).filter(
    (s) =>
      s.archived_at === null &&
      gates.project(s.id, 'project.members.manage') &&
      !memberships.some((m) => m.project_id === s.id),
  );

  return (
    <Block name="spaces" title="Spaces">
      {load.kind === 'loading' && (
        <p className="prof-admin-muted" role="status">
          <Spinner size="sm" /> Reading their spaces…
        </p>
      )}
      {load.kind === 'error' && <Problem text={load.error} />}
      {load.kind === 'ready' &&
        (memberships.length === 0 ? (
          <p className="prof-admin-muted">Not a member of any space you can see.</p>
        ) : (
          <ul className="prof-admin-list">
            {memberships.map((m) => (
              <li key={m.project_id} className="prof-admin-item" data-membership={m.slug}>
                <span className="prof-admin-item-main">
                  <span className="prof-admin-item-name">
                    {m.name}
                    {m.archived && <span className="prof-admin-chip">ARCHIVED</span>}
                  </span>
                  <span className="prof-admin-item-meta">
                    {m.prefix} ·{' '}
                    <span data-membership-role={m.role}>{projectRoleLabel(m.role)}</span>
                  </span>
                </span>
                {gates.project(m.project_id, 'project.members.manage') && (
                  <button
                    type="button"
                    className="prof-admin-btn prof-admin-btn-quiet"
                    data-action="remove-from-space"
                    aria-label={`Remove ${user.name} from ${m.name}`}
                    onClick={() => {
                      setNotice(undefined);
                      setRemoving(m);
                    }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}

      {load.kind === 'ready' && user.is_active && addable.length > 0 && (
        <AddToSpace
          user={user}
          spaces={addable}
          onAdded={(text) => {
            setNotice(text);
            reload();
          }}
        />
      )}

      {notice !== undefined && (
        <p className="prof-admin-notice" role="status">
          {notice}
        </p>
      )}

      {removing !== undefined && (
        <OffboardingDialog
          title={`Remove ${user.name} from ${removing.name}?`}
          verb="Remove"
          leavingId={user.id}
          consequences={
            <p>
              They lose access to {removing.name} unless their organisation role opens every space.
              Their work there stays.
            </p>
          }
          loadCandidates={async () =>
            (await listMembers(removing.slug)).members.map((p) => ({
              id: p.user_id,
              name: p.name,
            }))
          }
          run={async (openTasks) => {
            await removeMember(removing.slug, user.id, openTasks);
          }}
          onDone={() => {
            setNotice(`Removed ${user.name} from ${removing.name}.`);
            setRemoving(undefined);
            reload();
          }}
          onClose={() => {
            setRemoving(undefined);
          }}
        />
      )}
    </Block>
  );
}

function AddToSpace({
  user,
  spaces,
  onAdded,
}: {
  readonly user: AdminSubject;
  readonly spaces: readonly Project[];
  readonly onAdded: (notice: string) => void;
}) {
  const [slug, setSlug] = useState('');
  const [role, setRole] = useState<ProjectRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const space = spaces.find((s) => s.slug === slug);

  return (
    <form
      className="prof-admin-add"
      data-admin-add
      onSubmit={(event) => {
        event.preventDefault();
        if (space === undefined || busy) return;
        setBusy(true);
        setError(undefined);
        addMember(space.slug, user.id, role)
          .then(() => {
            setSlug('');
            onAdded(`Added ${user.name} to ${space.name} as ${projectRoleLabel(role)}.`);
          })
          .catch((cause: unknown) => {
            setError(said(cause));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <span className="prof-admin-label" id="prof-admin-add-label">
        Add to a space
      </span>
      <div className="prof-admin-add-row">
        <Dropdown
          aria-labelledby="prof-admin-add-label"
          noun="spaces"
          searchable
          placeholder="Choose a space"
          value={slug}
          disabled={busy}
          onChange={setSlug}
          options={spaces.map((s) => ({ value: s.slug, label: s.name, keywords: s.prefix }))}
        />
        <Dropdown
          aria-label="Role in the space"
          noun="roles"
          value={role}
          disabled={busy}
          onChange={(value) => {
            setRole(value);
          }}
          options={ADD_ROLES.map((r) => ({
            value: r,
            label: projectRoleLabel(r),
            title: ROLE_SUMMARY[r],
          }))}
        />
        <button
          type="submit"
          className="prof-admin-btn prof-admin-btn-primary"
          data-action="add-to-space"
          disabled={busy || space === undefined}
        >
          {busy && <Spinner size="sm" />}
          Add
        </button>
      </div>
      <Problem text={error} />
    </form>
  );
}
