import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { PROFILE_KINDS, type ProfileKind } from '../../../api/profiles.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { dateTime } from '../../../api/time-label.ts';
import {
  agentRevokeImpact,
  lastUsedLabel,
  listUserTokens,
  revokeUserToken,
  tokenAgentLabel,
  tokensByKind,
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
import { mayActOnSetupOf, OWNER_SETUP_NOTE, revokeRefusal } from '../../../api/owner-setup.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { InfoTip } from './InfoTip.tsx';
import { adminControls, manageSections, type AdminSubject } from './manage-controls.ts';
import {
  TOKENS_SHOWN,
  groupTokens,
  shownRows,
  tokenSummary,
  tokenUse,
  unusedCount,
  type TokenGroup,
} from './token-groups.ts';
import './admin-panel.css';

/** The profile kinds' words (D-078): the header's chip and the panel's control. */
export const KINDS: Readonly<Record<ProfileKind, { label: string; hint: string }>> = {
  builder: {
    label: 'Builder',
    hint: 'does the work: delivery, current work and the agents they use.',
  },
  manager: {
    label: 'Manager',
    hint: 'reviews and leads: the review queue, review load and decisions.',
  },
};

/** The Builder/Manager control's state, which the profile owns (it redraws the page). */
export interface KindControl {
  readonly value: ProfileKind;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onKind: (kind: ProfileKind) => void;
}

export interface ManageSectionsProps {
  readonly user: AdminSubject;
  readonly me: MeProfile;
  readonly gates: Gates;
  readonly kind: KindControl;
  /** Their role or active state changed: read the profile again. */
  readonly onChanged: () => void;
  /**
   * A reset link is on screen (`true`) or put away: the panel must not be
   * dismissed by a stray click while it is, since it is shown only once.
   */
  readonly onSecret?: ((shown: boolean) => void) | undefined;
}

/**
 * Where focus goes when a question asked from a section closes (LAI-1134
 * review N2): the control named by `selector` inside the sections, or —
 * when there is none, or none any more — the dialog's close button, never
 * `body`.
 */
type FocusBack = (selector?: string) => () => HTMLElement | null;

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

/**
 * Everything an owner or admin does to one person (D-104, LAI-988), as the
 * Manage member panel's sections (LAI-1134, frames 1q–1s): Role, Spaces,
 * Tokens, Security and the Danger zone. Each is drawn only when the server
 * says the reader may use something in it (`manageSections`); the panel is
 * not offered at all to a reader with none.
 *
 * Every destructive change asks first. Deactivating and removing from a space
 * go through the offboarding dialog, which asks about their open tasks.
 */
export function ManageSections({
  user,
  me,
  gates,
  kind,
  onChanged,
  onSecret,
}: ManageSectionsProps) {
  const controls = adminControls(gates, me, user);
  const sections = manageSections(controls);
  const root = useRef<HTMLDivElement>(null);
  const focusBack: FocusBack = useCallback(
    (selector) => () =>
      (selector === undefined ? null : root.current?.querySelector<HTMLElement>(selector)) ??
      root.current
        ?.closest('[role="dialog"]')
        ?.querySelector<HTMLElement>(':scope > header button') ??
      null,
    [],
  );

  return (
    <div className="prof-admin" data-section="admin" ref={root}>
      {sections.map((section) => {
        switch (section) {
          case 'role':
            return (
              <RoleSection
                key={section}
                user={user}
                role={controls.role}
                kind={controls.kind ? kind : undefined}
                onChanged={onChanged}
              />
            );
          case 'spaces':
            return <SpacesBlock key={section} user={user} gates={gates} focusBack={focusBack} />;
          case 'tokens':
            // The list stays here beside the profile's Developer setup tab (LAI-1140).
            return (
              <TokensBlock
                key={section}
                user={user}
                mayRevoke={controls.revokeTokens}
                ownerHeld={
                  gates.org('token.revoke_any') && !mayActOnSetupOf(me.org_role, user.org_role)
                }
              />
            );
          case 'security':
            return (
              <SecuritySection
                key={section}
                user={user}
                resetLink={controls.resetLink}
                signOut={controls.signOut}
                onSecret={onSecret}
              />
            );
          case 'danger':
            return (
              <DangerSection
                key={section}
                user={user}
                onChanged={onChanged}
                focusBack={focusBack}
              />
            );
        }
      })}
    </div>
  );
}

function Block({
  name,
  title,
  danger = false,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly danger?: boolean;
  readonly children: ReactNode;
}) {
  const id = `prof-admin-${name}-title`;
  return (
    <section
      className={danger ? 'prof-admin-block prof-admin-danger' : 'prof-admin-block'}
      data-admin={name}
      aria-labelledby={id}
    >
      <h3 className="prof-admin-title" id={id}>
        {title}
      </h3>
      {children}
    </section>
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

function Notice({ text }: { readonly text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <p className="prof-admin-notice" role="status">
      {text}
    </p>
  );
}

/**
 * One section's request in flight: busy while it runs, its refusal or what it
 * did said once, and whatever question was open put away when it answers.
 */
function useAct<Asking>() {
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
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
  return { asking, setAsking, busy, error, notice, setNotice, act };
}

// -------------------------------------------------------------------- role

function RoleSection({
  user,
  role: mayRole,
  kind,
  onChanged,
}: {
  readonly user: AdminSubject;
  readonly role: boolean;
  readonly kind: KindControl | undefined;
  readonly onChanged: () => void;
}) {
  const { asking, setAsking, busy, error, notice, setNotice, act } = useAct<'role'>();
  const [role, setRole] = useState<string>(user.org_role);

  useEffect(() => {
    setRole(user.org_role);
  }, [user.org_role]);

  return (
    <Block name="role" title="Role">
      {mayRole && (
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

      {kind !== undefined && <KindRow kind={kind} />}

      <Problem text={error} />
      <Notice text={notice} />
    </Block>
  );
}

/**
 * Builder or Manager (D-078) — a label, never a permission: it decides what
 * the profile shows. Moved from the header into the panel (LAI-1134); still a
 * labelled radio group the arrow keys move, and still the server's answer —
 * the radio moves when the `PATCH` comes back, not on the click.
 */
function KindRow({ kind }: { readonly kind: KindControl }) {
  return (
    <div className="prof-admin-row" data-admin-row="kind">
      <span className="prof-kind-text">
        <span className="prof-admin-label" id="prof-kind-label">
          Profile kind
        </span>
        <InfoTip label="What the profile kinds mean">
          <dl className="prof-defs">
            {PROFILE_KINDS.map((k) => (
              <div key={k}>
                <dt>{KINDS[k].label}</dt>
                <dd>{KINDS[k].hint}</dd>
              </div>
            ))}
          </dl>
          <p className="prof-defs-foot">
            It decides what this page shows — never what they may do. Only owners and admins see or
            set it.
          </p>
        </InfoTip>
        {kind.busy && <Spinner size="sm" />}
      </span>
      <div
        className="prof-seg"
        role="radiogroup"
        aria-labelledby="prof-kind-label"
        aria-describedby="prof-kind-note"
        aria-busy={kind.busy}
      >
        {PROFILE_KINDS.map((k) => (
          <label key={k} className="prof-seg-option">
            <input
              type="radio"
              name="profile-kind"
              value={k}
              checked={kind.value === k}
              disabled={kind.busy}
              onChange={() => {
                kind.onKind(k);
              }}
            />
            <span className="prof-seg-face">{KINDS[k].label}</span>
          </label>
        ))}
      </div>
      <p className="prof-admin-muted prof-kind-note" id="prof-kind-note">
        Admin only · a label, never a permission. It decides what this profile shows, not what they
        may do.
      </p>
      {kind.error !== undefined && (
        <p className="prof-admin-error" role="alert">
          {kind.error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- security

function SecuritySection({
  user,
  resetLink,
  signOut,
  onSecret,
}: {
  readonly user: AdminSubject;
  readonly resetLink: boolean;
  readonly signOut: boolean;
  readonly onSecret: ((shown: boolean) => void) | undefined;
}) {
  const { asking, setAsking, busy, error, notice, setNotice, act } = useAct<'sign-out' | 'reset'>();
  /**
   * The reset link, **shown once**: held here while it is on screen and nowhere
   * else, and gone when the panel goes (closed, another person, another page).
   */
  const [link, setLink] = useState<ResetLinkView | undefined>(undefined);
  const shown = link !== undefined;
  useEffect(() => {
    onSecret?.(shown);
  }, [onSecret, shown]);
  // Gone with the section (another person, the grant withdrawn): nothing held.
  useEffect(
    () => () => {
      onSecret?.(false);
    },
    [onSecret],
  );

  return (
    <Block name="security" title="Security">
      {resetLink && (
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

      {signOut && (
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

      <Problem text={error} />
      <Notice text={notice} />
    </Block>
  );
}

// ------------------------------------------------------------------ danger

function DangerSection({
  user,
  onChanged,
  focusBack,
}: {
  readonly user: AdminSubject;
  readonly onChanged: () => void;
  readonly focusBack: FocusBack;
}) {
  const { asking, setAsking, busy, error, notice, setNotice, act } = useAct<'reactivate'>();
  const [offboarding, setOffboarding] = useState(false);

  const loadCandidates = useCallback(
    async (): Promise<readonly ReassignCandidate[]> =>
      (await listAllUsers()).users.map((p) => ({ id: p.id, name: p.name })),
    [],
  );

  return (
    <Block name="danger" title="Danger zone" danger>
      <p className="prof-admin-danger-text" data-admin-row="active">
        {user.is_active
          ? 'Deactivating ends every session and token of theirs now and removes them from every space. They can no longer sign in. Their history stays.'
          : `${user.name} is deactivated. Reactivating lets them sign in again; old sessions and tokens stay ended.`}
      </p>
      {/* One button element either way — Deactivate… becomes Reactivate in
          place, so focus handed back to it survives the redraw. */}
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

      <Problem text={error} />
      <Notice text={notice} />

      {offboarding && (
        <OffboardingDialog
          title={`Deactivate ${user.name}?`}
          verb="Deactivate"
          leavingId={user.id}
          restoreFocus={focusBack('[data-admin="danger"] button[data-action]')}
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
  ownerHeld,
}: {
  readonly user: AdminSubject;
  readonly mayRevoke: boolean;
  /** Revoke is withheld because these are the owner's and the reader is not (D-133). */
  readonly ownerHeld: boolean;
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

  // LAI-321: a long list folds — same-named tokens into one row, the first
  // few rows per kind, the rest one click away. Revoking is per token still.
  const [showAll, setShowAll] = useState<Readonly<Record<string, boolean>>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const now = Date.now();
  const live =
    load.kind === 'ready' ? load.tokens.filter((t) => tokenState(t, now) === 'active') : [];
  const complete = load.kind === 'ready' && !load.truncated;

  /** One token, with its revoke, its question and — for a tool — what revoking stops. */
  const tokenRow = (token: TokenView, inGroup = false) => {
    // Once per row (review N5): the name, the question and the button.
    const label = tokenAgentLabel(token);
    const use = tokenUse(token.last_used_at, now);
    return (
      <li key={token.id} className="prof-admin-item prof-admin-token" data-token={token.id}>
        <span className="prof-admin-item-main">
          {/* In a group the name is its heading; each token is told apart by its prefix. */}
          {inGroup ? (
            <code className="prof-admin-item-name">{token.prefix}…</code>
          ) : (
            <span className="prof-admin-item-name">{label ?? token.name}</span>
          )}
          <span className="prof-admin-item-meta">
            {!inGroup && (
              <>
                <code>{token.prefix}…</code> ·{' '}
              </>
            )}
            {token.scope === 'read_only' ? 'Read only' : 'Full'}
            {use !== 'never' && ` · ${lastUsedLabel(token.last_used_at, now)}`}
            {use !== 'recent' && (
              <span className="prof-admin-chip prof-admin-use" data-use={use}>
                {use === 'never' ? 'Never used' : 'Idle'}
              </span>
            )}
          </span>
        </span>
        {asking === token.id && token.kind === 'agent' && (
          <p className="prof-admin-muted" data-impact>
            {agentRevokeImpact(token, user.name, live, now, complete)}
          </p>
        )}
        {mayRevoke &&
          (asking === token.id ? (
            <Confirm
              question={label === null ? `Revoke ${token.name}?` : `Revoke ${label}’s credential?`}
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
                    setError(revokeRefusal(cause, 'Nothing changed.'));
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
              aria-label={`Revoke ${label ?? token.name}`}
              disabled={busy}
              onClick={() => {
                setAsking(token.id);
              }}
            >
              Revoke
            </button>
          ))}
      </li>
    );
  };

  /** Same-named tokens as one row that opens to each of them. */
  const groupRow = (kind: string, group: TokenGroup) => {
    const key = `${kind}:${group.label}`;
    const isOpen = open.has(key);
    const unused = unusedCount(group, now);
    const listId = `prof-token-group-${kind}-${group.tokens[0]?.id ?? ''}`;
    return (
      <li key={key} className="prof-admin-item prof-admin-group" data-token-group={group.label}>
        <button
          type="button"
          className="prof-admin-group-toggle"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => {
            setOpen((was) => {
              const next = new Set(was);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }}
        >
          <span className="prof-admin-group-chevron" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
          <span className="prof-admin-item-main">
            <span className="prof-admin-item-name">
              {group.label}
              <span className="prof-admin-count">× {group.tokens.length}</span>
            </span>
            <span className="prof-admin-item-meta">
              {group.lastUsedAt === null
                ? 'None used yet'
                : `Latest ${lastUsedLabel(group.lastUsedAt, now).toLowerCase()}`}
              {unused > 0 && group.lastUsedAt !== null && ` · ${String(unused)} unused or idle`}
            </span>
          </span>
        </button>
        {isOpen && (
          <ul className="prof-admin-list prof-admin-sublist" id={listId}>
            {group.tokens.map((token) => tokenRow(token, true))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <Block name="tokens" title="Tokens">
      {ownerHeld && (
        <p className="prof-admin-muted" data-owner-tokens>
          {OWNER_SETUP_NOTE}
        </p>
      )}
      {load.kind === 'loading' && (
        <p className="prof-admin-muted" role="status">
          <Spinner size="sm" /> Reading their tokens…
        </p>
      )}
      {load.kind === 'error' && <Problem text={load.error} />}
      {load.kind === 'ready' && live.length === 0 && (
        <p className="prof-admin-muted">No working tokens.</p>
      )}
      {load.kind === 'ready' && live.length > 0 && (
        <>
          <p className="prof-admin-token-summary" data-token-summary>
            {tokenSummary(live)}
          </p>
          {/* Grouped by kind, as Organisation → Security is (LAI-1046). */}
          {(
            [
              ['personal', 'Personal tokens'],
              ['agent', 'Tool credentials (Tool · Device)'],
            ] as const
          ).map(([kind, heading]) => {
            const tokens = tokensByKind(live)[kind];
            if (tokens.length === 0) return null;
            const groups = groupTokens(tokens);
            const { shown, hidden } = shownRows(groups, showAll[kind] === true);
            return (
              <div key={kind} className="prof-admin-kind" data-kind={kind}>
                <p className="prof-admin-muted prof-admin-kind-head">
                  {heading} · {tokens.length}
                </p>
                <ul className="prof-admin-list">
                  {shown.map((group) =>
                    group.tokens.length === 1 ? tokenRow(group.tokens[0]!) : groupRow(kind, group),
                  )}
                </ul>
                {(hidden > 0 || showAll[kind] === true) && groups.length > TOKENS_SHOWN && (
                  <button
                    type="button"
                    className="prof-admin-btn prof-admin-btn-quiet prof-admin-more"
                    data-action="show-all-tokens"
                    aria-expanded={showAll[kind] === true}
                    onClick={() => {
                      setShowAll((was) => ({ ...was, [kind]: was[kind] !== true }));
                    }}
                  >
                    {showAll[kind] === true ? 'Show fewer' : `Show all ${String(groups.length)}`}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
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

function SpacesBlock({
  user,
  gates,
  focusBack,
}: {
  readonly user: AdminSubject;
  readonly gates: Gates;
  readonly focusBack: FocusBack;
}) {
  const [load, setLoad] = useState<SpacesLoad>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [spaces, setSpaces] = useState<readonly Project[] | undefined>(undefined);
  const [removing, setRemoving] = useState<PersonMembership | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  /** Whether the open removal went through: then its row, and its button, are going. */
  const removed = useRef(false);

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
                      removed.current = false;
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
          restoreFocus={() =>
            removed.current
              ? focusBack()()
              : focusBack(
                  `[data-membership="${removing.slug}"] [data-action="remove-from-space"]`,
                )()
          }
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
            removed.current = true;
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
