import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { PageTabs } from '../../../components/PageTabs.tsx';
import { useProjects } from '../../../api/use-projects.ts';
import type { PageTab } from '../../page-tabs.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { canManageOrg, createInvite, revokeInvite, ORG_ROLES } from '../../../api/invites.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { getOrg, updateOrg, type Org } from '../../../api/org.ts';
import { revokeUserToken, type TokenView } from '../../../api/tokens.ts';
import { Switch } from '../../../components/Switch.tsx';
import { TokenRow } from '../../../components/TokenRow.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { useUserTokens } from './use-user-tokens.ts';
import { updateUser } from '../../../api/users.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { useOrganisation } from './use-organisation.ts';
import { GithubWebhookSection } from './GithubWebhookSection.tsx';
import { ModelPricesSection } from './ModelPricesSection.tsx';
import { TimeModeFact } from './TimeModeFact.tsx';
import { OrgSpaces } from './OrgSpaces.tsx';
import { RolesPermissionsSection } from './RolesPermissionsSection.tsx';
import { OrgActivity } from './OrgActivity.tsx';
import { PermissionDenied } from '../../../components/PermissionDenied.tsx';
import type { MeProfile } from '../../../api/me.ts';
import type { OrgRole } from '../../../api/invites.ts';
import './organisation.css';

export interface OrganisationScreenProps {
  readonly me: MeProfile;
  /** The tabs this reader is offered — Security is an owner's or an admin's. */
  readonly tabs: readonly PageTab[];
  /** The open tab: `overview`, `people`, `roles`, `integrations`, `security` or `activity`. */
  readonly tab: string;
  /**
   * The address named `tab` and this reader may not open it — the not-allowed
   * state, rather than another tab (LAI-951, `refusedTab`).
   */
  readonly refused?: boolean;
  /** The address's query — Activity keeps its filters there (LAI-951). */
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams) => void;
  readonly onNavigate: (to: string) => void;
}

/** `3 Mar 2026` — when the organisation was made, in the reader's own calendar. */
function createdLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const DAY = 86_400_000;

/**
 * The roles this actor may **grant**, from §3.1's *"(not to Owner)"* caveat.
 *
 * An Admin may set any role except Owner — `can()` reads `targetOrgRole` for
 * exactly this, and without the caveat an Admin promotes themselves and the
 * Owner/Admin distinction is decorative. So Owner is **absent** from an Admin's
 * dropdown rather than present and answering `403`.
 *
 * **This is a mirror of a rule the server states, not a rule invented here.**
 * The last-owner invariant is the other kind — it depends on how many active
 * Owners exist, which this screen cannot know — and that one is left to the
 * server and shown verbatim when it fires.
 */
function grantableRoles(actorRole: string): readonly OrgRole[] {
  return actorRole === 'owner' ? ORG_ROLES : ORG_ROLES.filter((r) => r !== 'owner');
}

/** `in 6 days`, `today`, or `expired` — the invite's own clock. */
function expiryLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `in ${String(days)} ${days === 1 ? 'day' : 'days'}`;
  return 'today';
}

/**
 * The organisation screen (LAI-086, design screen `10a`).
 *
 * ## What is deliberately not here
 *
 * The design also shows a **monthly cap** and a **danger zone** (revoke all
 * agent tokens, delete the org). None of those has an endpoint, and the
 * monthly cap has no column either, so they are absent rather than
 * present-and-inert. **Rotating the webhook secret has one now** (LAI-753),
 * and lives in its own *GitHub webhook* card rather than a danger zone: it is
 * how the webhook is set up in the first place.
 *
 * **AI provider was in that list until LAI-459 and is not any more** — `GET /org`
 * exists (LAI-447) and carries it, gated field-level on `org.settings.edit`.
 * The paragraph saying it had no endpoint outlived the endpoint by a week, which
 * is the direction documentation drifts in: understating what works is the one
 * nobody checks.
 *
 * The result is a screen that reads the org and its people, changes an org role,
 * deactivates and reactivates somebody, manages invites, and says plainly what
 * it cannot yet do.
 *
 * ## Four tabs (LAI-796)
 *
 * The owner's reorganisation grouped the same sections: **Overview** — the
 * figures, the workspace switches and the spaces; **People** — members and
 * invites; **Integrations** — GitHub, the AI provider and model prices;
 * **Security** — everyone's tokens, for an owner or an admin. Nothing moved
 * out of reach and no section gained or lost a control. What the reference
 * showed that Laika has no data for — a plan badge, an admin activity log, a
 * token lifetime limit, a danger zone — is not drawn.
 *
 * **Roles & permissions** joined them in LAI-950, once `GET /permissions`
 * served the matrix `can()` computes: it was on that list until then.
 *
 * **Activity** (LAI-951) is the admin activity log that reference showed, now
 * that `GET /activity/history` serves it: an owner's or an admin's.
 */
export function OrganisationScreen({
  me,
  tabs,
  tab,
  refused = false,
  params,
  setParams,
  onNavigate,
}: OrganisationScreenProps) {
  const canManage = canManageOrg(me.org_role);
  const { state, reload } = useOrganisation(canManage);
  const projects = useProjects();
  /** *Invite people* opens People with the address field focused. */
  const inviteRef = useRef<HTMLInputElement | null>(null);
  const [focusInvite, setFocusInvite] = useState(false);
  useEffect(() => {
    if (!focusInvite || tab !== 'people' || state.status !== 'ready') return;
    inviteRef.current?.focus();
    setFocusInvite(false);
  }, [focusInvite, tab, state.status]);

  const { theme } = useTheme();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [org, setOrg] = useState<Org | undefined>(undefined);
  /** The person whose row is being changed, so two clicks cannot race. */
  const [changing, setChanging] = useState<string | undefined>(undefined);
  /**
   * The server's refusal, verbatim.
   *
   * **The last-owner invariant lives on the server**, and this screen does not
   * re-implement it. If demoting the final owner is refused, what a person sees
   * is the sentence the server gave — not a rule the client invented, which
   * could disagree with the real one in either direction.
   */
  const [roleError, setRoleError] = useState<string | undefined>(undefined);

  const [issued, setIssued] = useState<{ url: string; email: string | null } | undefined>(
    undefined,
  );

  /** D-079's organisation switch, while its change is in flight, and why it failed. */
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState<string | undefined>(undefined);

  const setInsights = (on: boolean): void => {
    setInsightsBusy(true);
    setInsightsError(undefined);
    updateOrg({ developer_insights: on })
      .then(setOrg)
      .catch((cause: unknown) => {
        setInsightsError(cause instanceof Error ? cause.message : 'That change was refused.');
      })
      .finally(() => {
        setInsightsBusy(false);
      });
  };

  /** Whose token panel is open, or `undefined` for none. One at a time. */
  const [tokensFor, setTokensFor] = useState<string | undefined>(undefined);
  const { state: tokens, reload: reloadTokens } = useUserTokens(tokensFor);
  const [tokenError, setTokenError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    getOrg(controller.signal)
      .then(setOrg)
      .catch(() => {
        // The org card is absent rather than an error: the people and invites
        // below are the screen's point, and losing the org's name should not
        // lose them.
      });
    return () => {
      controller.abort();
    };
  }, []);

  const revoke = (owner: { id: string; name: string }, token: TokenView): void => {
    if (
      !window.confirm(
        `Revoke “${token.name}” for ${owner.name}? Anything using it — an agent, a script, ` +
          `their editor — stops working immediately, and the token cannot be restored. ` +
          `They can mint a new one themselves.`,
      )
    ) {
      return;
    }

    setTokenError(undefined);
    // **The owner's id, not just the token's.** The service refuses a token that
    // does not belong to the user in the path, which is what stops an admin
    // revoking anybody's token through anybody's URL — passing the id this token
    // was listed under is what keeps that check meaningful rather than a formality.
    revokeUserToken(owner.id, token.id)
      .then(() => {
        reloadTokens();
      })
      .catch((cause: unknown) => {
        setTokenError(cause instanceof Error ? cause.message : 'Could not revoke that token.');
      });
  };

  const change = (id: string, patch: { org_role?: string; is_active?: boolean }): void => {
    setChanging(id);
    setRoleError(undefined);
    updateUser(id, patch)
      .then(() => {
        reload();
      })
      .catch((cause: unknown) => {
        setRoleError(cause instanceof Error ? cause.message : 'That change was refused.');
      })
      .finally(() => {
        setChanging(undefined);
      });
  };

  const tabStrip = (
    <PageTabs
      label="Organisation sections"
      path="/organisation"
      tabs={tabs}
      current={tab}
      counts={{
        people: state.status === 'ready' && !state.truncated ? state.people.length : undefined,
      }}
      onNavigate={onNavigate}
    />
  );

  const header = (context?: ReactNode) => (
    <ScreenHeader
      variant="page"
      title={org?.name ?? 'Organisation'}
      lead={
        org === undefined ? undefined : (
          <span className="org-mark" aria-hidden="true">
            {initials(org.name)}
          </span>
        )
      }
      description={context}
      below={tabStrip}
    >
      {canManage && (
        <button
          type="button"
          className="bar-control bar-control-primary"
          onClick={() => {
            setFocusInvite(true);
            onNavigate('/organisation?tab=people');
          }}
        >
          + Invite people
        </button>
      )}
    </ScreenHeader>
  );

  if (state.status === 'loading') {
    return (
      <div className="org">
        {header()}
        <LoadingState shape="row" count={4} label="Loading the organisation" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="org">
        {header()}
        <ApiErrorState
          error={state.error}
          resource="this organisation"
          scope="organisation"
          onRetry={reload}
        />
      </div>
    );
  }

  const now = Date.now();
  const active = state.people.filter((p) => p.is_active).length;
  const grantable = grantableRoles(me.org_role);

  const people = `${String(state.people.length)}${state.truncated ? '+' : ''} ${
    state.people.length === 1 && !state.truncated ? 'person' : 'people'
  }${active === state.people.length ? '' : ` · ${String(active)} active`}`;
  const owners = state.people.filter((p) => p.org_role === 'owner' && p.is_active);
  const admins = state.people.filter((p) => p.org_role === 'admin' && p.is_active).length;
  const context = [
    owners.length === 0
      ? undefined
      : `${owners.length === 1 ? 'Owner' : 'Owners'} · ${owners.map((p) => p.name).join(', ')}`,
    org === undefined ? undefined : `Created ${createdLabel(org.created_at)}`,
    people,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');

  return (
    <div className="org">
      {header(context)}

      <div className="org-body" data-tab={tab}>
        {tab === 'overview' && (
          <>
            {/* The figures (LAI-796) — each a count the page already holds. */}
            <dl className="org-stats">
              <div className="org-stat">
                <dt>Members</dt>
                <dd>
                  <span className="org-stat-value">
                    {String(active)}
                    {state.truncated ? '+' : ''}
                  </span>
                  <span className="org-stat-sub">
                    {admins} {admins === 1 ? 'admin' : 'admins'}
                    {active === state.people.length
                      ? ''
                      : ` · ${String(state.people.length - active)} deactivated`}
                  </span>
                </dd>
              </div>
              <div className="org-stat">
                <dt>Spaces</dt>
                <dd>
                  <span className="org-stat-value">
                    {projects.status === 'ready'
                      ? `${String(projects.projects.length)}${projects.nextCursor === null ? '' : '+'}`
                      : '—'}
                  </span>
                  <span className="org-stat-sub">
                    {projects.status === 'ready'
                      ? `${String(projects.projects.filter((p) => p.archived_at === null).length)} active`
                      : 'reading'}
                  </span>
                </dd>
              </div>
              {canManage && (
                <div className="org-stat">
                  <dt>Pending invites</dt>
                  <dd>
                    <span className="org-stat-value">{String(state.invites.length)}</span>
                    <span className="org-stat-sub">waiting to be accepted</span>
                  </dd>
                </div>
              )}
            </dl>

            {org !== undefined && (
              <section className="org-card" aria-labelledby="org-name">
                <header className="org-card-head">
                  <h2 id="org-name">Workspace settings</h2>
                </header>

                <dl className="org-facts">
                  <div className="org-fact">
                    <dt>Presence</dt>
                    <dd>
                      {org.presence_enabled ? 'recorded' : 'off'}
                      <span className="org-fact-note">
                        {org.presence_enabled
                          ? 'Sessions appear on Capacity and the board.'
                          : 'Nobody’s sessions are recorded. Capacity says so rather than showing an empty list.'}
                      </span>
                    </dd>
                  </div>

                  {/* D-079 (LAI-751): the organisation's half of local activity
                      sharing. A switch for an owner or admin, a word for everyone
                      else — they are who it is about, so they can always read it. */}
                  <div className="org-fact" data-fact="developer-insights">
                    <dt id="org-insights-label">Developer insights</dt>
                    <dd>
                      {canManage ? (
                        <Switch
                          checked={org.developer_insights}
                          labelledBy="org-insights-label"
                          describedBy="org-insights-note"
                          disabled={insightsBusy}
                          onChange={setInsights}
                        >
                          {org.developer_insights ? 'On' : 'Off'}
                        </Switch>
                      ) : (
                        <span>{org.developer_insights ? 'on' : 'off'}</span>
                      )}
                      <span className="org-fact-note" id="org-insights-note">
                        When on, every connected machine’s local activity is collected: daily counts
                        of prompts to agents, agent sessions, and commits pushed or not yet pushed,
                        and agents’ token counts. They appear on that person’s profile as activity,
                        and each person is told so on Developer access and Connect — never prompt
                        text, file or repository names, branches or commit messages. Off stops it
                        for everyone at once.
                      </span>
                      {insightsError !== undefined && (
                        <span className="org-fact-error" role="alert">
                          {insightsError}
                        </span>
                      )}
                    </dd>
                  </div>

                  {/* D-088 (LAI-787): the organisation's half of time — off, typed
                      entries only, or drafts too. Controls for an owner or admin, a
                      word for everyone else, as Developer insights above. */}
                  <TimeModeFact canManage={canManage} />
                </dl>
              </section>
            )}

            <OrgSpaces projects={projects} onNavigate={onNavigate} />
          </>
        )}

        {tab === 'people' && (
          <>
            <section className="org-card" aria-labelledby="org-people">
              <header className="org-card-head">
                <h2 id="org-people">People</h2>
                <span className="org-count">
                  {String(state.people.length)}
                  {state.truncated ? '+' : ''}
                </span>
              </header>

              {state.truncated && (
                <p className="org-note" role="status">
                  Showing the first pages only — there may be more people than this.
                </p>
              )}

              <ul className="org-people">
                {state.people.map((person) => {
                  const ink = avatarColor(person.id, theme);
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
                          {/* Their profile, for a reader who may open it (LAI-743);
                              plain text for anyone else. */}
                          <PersonLink
                            userId={person.id}
                            className="org-person-link"
                            label={`Open ${person.name}’s profile`}
                          >
                            {person.name}
                          </PersonLink>
                          {person.id === me.id && (
                            <span className="org-chip org-chip-you">YOU</span>
                          )}
                          {!person.is_active && (
                            <span className="org-chip org-chip-off">DEACTIVATED</span>
                          )}
                        </span>
                        <span className="org-person-email">{person.email}</span>
                      </span>
                      {canManage && person.id !== me.id ? (
                        /* **Absent, not disabled**, for somebody who may not manage
                           the org — the rest of this app hides what `can()` refuses,
                           and a greyed control still says "this exists and is yours",
                           which is the thing that is not true. */
                        <span className="org-person-controls">
                          <label className="visually-hidden" htmlFor={`role-${person.id}`}>
                            Org role for {person.name}
                          </label>
                          {/* Their current role is always an option even when this
                              actor could not grant it — an Admin looking at an Owner
                              must see what that person *is*, and a control whose
                              value is not among its options shows nothing. */}
                          <Dropdown
                            id={`role-${person.id}`}
                            variant="bare"
                            className="org-role-select"
                            noun="roles"
                            value={person.org_role}
                            disabled={changing === person.id}
                            onChange={(value) => {
                              change(person.id, { org_role: value });
                            }}
                            options={(grantable.includes(person.org_role as OrgRole)
                              ? grantable
                              : [person.org_role as OrgRole, ...grantable]
                            ).map((r) => ({ value: r, label: orgRoleLabel(r) }))}
                          />

                          {/* **Two verbs, and the copy says which** (D-048).
                              `user.deactivated` and `user.reactivated` answer different
                              questions, and one button labelled "deactivate" doing both
                              would be worse than either. */}
                          <button
                            type="button"
                            className={person.is_active ? 'org-deactivate' : 'org-reactivate'}
                            disabled={changing === person.id}
                            onClick={() => {
                              if (
                                person.is_active &&
                                !window.confirm(
                                  `Deactivate ${person.name}? They are locked out immediately. Their tasks, comments and history stay exactly as they are — this is not deletion.`,
                                )
                              ) {
                                return;
                              }
                              change(person.id, { is_active: !person.is_active });
                            }}
                          >
                            {person.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </span>
                      ) : (
                        <span className="org-person-role">
                          {orgRoleLabel(person.org_role as OrgRole)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {roleError !== undefined && (
                /* **The server's refusal, verbatim.** The last-owner invariant lives
                   there; a client rule invented to pre-empt it could disagree in
                   either direction, and the direction that lets somebody lock the last
                   owner out is the one that matters. */
                <p className="org-error" role="alert">
                  {roleError}
                </p>
              )}

              <p className="org-note">
                {canManage
                  ? 'Your own row has no controls — changing your own role or locking yourself out is not something this screen offers. Project roles are managed on each project’s members screen.'
                  : 'Roles are shown here and changed by an admin. Project roles are managed on each project’s members screen.'}
              </p>
            </section>

            {canManage && (
              <section className="org-card" aria-labelledby="org-invites">
                <header className="org-card-head">
                  <h2 id="org-invites">Pending invites</h2>
                  <span className="org-count">{String(state.invites.length)}</span>
                </header>

                {state.invitesError !== null && (
                  <ApiErrorState
                    error={state.invitesError}
                    resource="pending invites"
                    scope="organisation"
                    onRetry={reload}
                  />
                )}

                <form
                  className="org-invite-form"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (busy) return;
                    setBusy(true);
                    setFormError(null);

                    const trimmed = email.trim();
                    createInvite({ email: trimmed === '' ? null : trimmed, org_role: role })
                      .then((created) => {
                        // Shown once, because the server keeps only a hash. Losing it
                        // means issuing a new invite, so it is not tucked into a toast.
                        setIssued({ url: created.accept_url, email: created.invite.email });
                        setEmail('');
                        reload();
                      })
                      .catch((cause: unknown) => {
                        setFormError(cause);
                      })
                      .finally(() => {
                        setBusy(false);
                      });
                  }}
                >
                  <label className="org-invite-email">
                    <span className="visually-hidden">Email address</span>
                    <input
                      ref={inviteRef}
                      type="email"
                      className="input"
                      placeholder="name@company.com — or leave blank for a link"
                      value={email}
                      disabled={busy}
                      onChange={(event) => {
                        setEmail(event.target.value);
                      }}
                    />
                  </label>

                  <label className="org-invite-role">
                    <span className="visually-hidden">Role</span>
                    <Dropdown
                      variant="bare"
                      className="org-role-select"
                      noun="roles"
                      value={role}
                      disabled={busy}
                      onChange={(value) => {
                        setRole(value);
                      }}
                      options={ORG_ROLES.filter((r) => r !== 'owner').map((r) => ({
                        value: r,
                        label: orgRoleLabel(r),
                      }))}
                    />
                  </label>

                  <Button type="submit" busy={busy}>
                    Send invite
                  </Button>
                </form>

                {formError !== null && (
                  <ApiErrorState error={formError} resource="this invite" verb="create" />
                )}

                {issued !== undefined && (
                  <div className="org-issued" role="status">
                    <p className="org-issued-head">
                      Invite created{issued.email === null ? ' as a link' : ` for ${issued.email}`}
                    </p>
                    <p className="org-issued-body">
                      This link is shown once — the server stores only a hash of it. Send it now; if
                      it is lost, revoke this invite and create another.
                    </p>
                    <code className="org-issued-url">{issued.url}</code>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setIssued(undefined);
                      }}
                    >
                      Done
                    </Button>
                  </div>
                )}

                {state.invites.length === 0 ? (
                  <p className="org-note">No invites are waiting to be accepted.</p>
                ) : (
                  <ul className="org-invites">
                    {state.invites.map((invite) => (
                      <li key={invite.id}>
                        <span className="org-invite-who">
                          <span className="org-person-name">
                            {invite.email ?? 'Anyone with the link'}
                            <span className="org-chip">{orgRoleLabel(invite.org_role)}</span>
                          </span>
                          <span className="org-person-email">
                            expires {expiryLabel(invite.expires_at, now)}
                            {/* SMTP is unconfigured (LAI-206), so nothing has been
                                emailed. Saying so beats letting someone assume it was. */}
                            {!invite.email_sent && ' · not emailed — send the link yourself'}
                          </span>
                        </span>
                        <Button
                          variant="danger"
                          onClick={() => {
                            revokeInvite(invite.id)
                              .then(reload)
                              .catch((cause: unknown) => {
                                setFormError(cause);
                              });
                          }}
                        >
                          Revoke
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}

        {tab === 'roles' && (
          <RolesPermissionsSection
            canManage={canManage}
            projects={projects.projects}
            onNavigate={onNavigate}
          />
        )}

        {tab === 'integrations' && (
          <>
            {/* Owners and admins on a web session (§3.1 *Configure webhooks*):
                absent, not null, for anyone else, so the card is simply not here. */}
            {org?.github_webhook !== undefined && (
              <GithubWebhookSection
                webhook={org.github_webhook}
                onChanged={(configured) => {
                  setOrg((current) =>
                    current?.github_webhook === undefined
                      ? current
                      : { ...current, github_webhook: { ...current.github_webhook, configured } },
                  );
                }}
              />
            )}

            {/* LAI-773: the prices every cost on Usage is computed with — read by
                anyone who may view the organisation, set by an owner or admin. */}
            <ModelPricesSection />

            {/* AI provider: absent for a reader without `org.settings.edit`,
                as it was on the single page — so is its card. */}
            {org?.ai !== undefined && (
              <section className="org-card" aria-labelledby="org-ai">
                <header className="org-card-head">
                  <h2 id="org-ai">AI provider</h2>
                </header>
                <dl className="org-facts">
                  {/* **Absent, not null**, for a reader without `org.settings.edit`
                      — so the question is whether the key is there, never whether it
                      is `null`. Somebody who may not see the AI settings is shown no
                      row at all rather than an empty one, which would tell them a
                      provider is unconfigured when they simply may not be told. */}
                  {org.ai !== undefined && (
                    <div className="org-fact">
                      <dt>AI provider</dt>
                      <dd>
                        {org.ai.configured ? (
                          <>
                            {/* The wrapper is load-bearing: `dd` is a flex column, so
                                without it the key tail is its own row. See
                                `.org-ai` in the stylesheet. */}
                            <span className="org-ai">
                              {org.ai.provider ?? 'configured'}
                              {org.ai.key_last4 !== null && (
                                <span className="org-key">···{org.ai.key_last4}</span>
                              )}
                            </span>
                            <span className="org-fact-note">
                              The key itself is never shown — §12 stores it encrypted and nothing
                              decrypts it to build this page.
                            </span>
                          </>
                        ) : (
                          <>
                            none
                            <span className="org-fact-note">
                              Meeting reviews need one; without it a transcript is accepted and no
                              proposals come back.
                            </span>
                          </>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
          </>
        )}

        {tab === 'activity' &&
          (refused ? (
            <PermissionDenied
              resource="the organisation’s activity"
              requiredRole="admin"
              scope="organisation"
            />
          ) : (
            <OrgActivity
              people={state.people}
              params={params}
              setParams={setParams}
              onNavigate={onNavigate}
            />
          ))}

        {tab === 'security' && canManage && (
          <section className="org-card" aria-labelledby="org-security">
            <header className="org-card-head">
              <h2 id="org-security">Tokens by person</h2>
            </header>
            <p className="org-note">
              Every token anyone holds, person by person — revoke one and whatever uses it stops at
              once. Your own are on Developer access.
            </p>
            <ul className="org-people">
              {state.people.map((person) => (
                <li
                  key={person.id}
                  className={`org-person${person.is_active ? '' : ' org-person-inactive'}`}
                >
                  <span className="org-person-who">
                    <span className="org-person-name">
                      {person.name}
                      {person.id === me.id && <span className="org-chip org-chip-you">YOU</span>}
                    </span>
                    <span className="org-person-email">{person.email}</span>
                  </span>
                  {/* **`token.list_any`** — Owner and Admin (§3.1), the same
                      grade as this tab's own gate. Not on the reader's own
                      row, as it never was: theirs are on Developer access. */}
                  <span className="org-person-controls">
                    {person.id === me.id ? (
                      <a
                        className="org-person-role"
                        href="/developer"
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                            return;
                          }
                          event.preventDefault();
                          onNavigate('/developer');
                        }}
                      >
                        On Developer access
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="org-tokens-toggle"
                        aria-expanded={tokensFor === person.id}
                        aria-controls={`tokens-${person.id}`}
                        onClick={() => {
                          setTokenError(undefined);
                          setTokensFor((open) => (open === person.id ? undefined : person.id));
                        }}
                      >
                        {tokensFor === person.id ? 'Hide tokens' : 'Tokens'}
                      </button>
                    )}
                  </span>

                  {tokensFor === person.id && (
                    <div className="org-tokens" id={`tokens-${person.id}`}>
                      <p className="org-tokens-head">
                        {person.name}&rsquo;s tokens
                        {/* Said on the screen, not only in a doc comment. An admin
                            arriving to revoke a departed colleague's access is
                            exactly the person who will look for the value, and the
                            answer is that §4.9 stores a hash and there has never
                            been one to show. */}
                        <span className="org-tokens-note">
                          The token itself is never shown — Laika stores only a hash of it. The
                          prefix is there to tell them apart.
                        </span>
                      </p>

                      {tokens?.status === 'loading' && (
                        <LoadingState
                          shape="row"
                          count={2}
                          label={`Loading ${person.name}'s tokens`}
                        />
                      )}

                      {tokens?.status === 'error' && (
                        <ApiErrorState
                          error={tokens.error}
                          resource="these tokens"
                          scope="organisation"
                          onRetry={reloadTokens}
                        />
                      )}

                      {tokens?.status === 'ready' &&
                        (tokens.tokens.length === 0 ? (
                          <p className="org-tokens-empty">
                            No tokens. Nothing of theirs is signed in to the API.
                          </p>
                        ) : (
                          <ul className="tok-list org-tokens-list">
                            {tokens.tokens.map((token) => (
                              <TokenRow
                                key={token.id}
                                token={token}
                                now={now}
                                onRevoke={(revoked) => {
                                  revoke(person, revoked);
                                }}
                              />
                            ))}
                          </ul>
                        ))}

                      {tokenError !== undefined && (
                        <p className="org-error" role="alert">
                          {tokenError}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
