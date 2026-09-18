import { useEffect, useState } from 'react';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { canManageOrg, createInvite, revokeInvite, ORG_ROLES } from '../../../api/invites.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { getOrg, type Org } from '../../../api/org.ts';
import { updateUser } from '../../../api/users.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { useOrganisation } from './use-organisation.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { OrgRole } from '../../../api/invites.ts';
import './organisation.css';

export interface OrganisationScreenProps {
  readonly me: MeProfile;
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
 * The design also shows a **monthly cap** and a **danger zone** (rotate webhook
 * secret, revoke all agent tokens, delete the org). None of those has an
 * endpoint, and the monthly cap has no column either, so they are absent rather
 * than present-and-inert.
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
 */
export function OrganisationScreen({ me }: OrganisationScreenProps) {
  const canManage = canManageOrg(me.org_role);
  const { state, reload } = useOrganisation(canManage);

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

  if (state.status === 'loading') {
    return (
      <div className="org">
        <ScreenHeader title="Organisation" />
        <LoadingState shape="row" count={4} label="Loading the organisation" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="org">
        <ScreenHeader title="Organisation" />
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

  return (
    <div className="org">
      {/*
        The org's name is served now (`GET /api/v1/org`, LAI-447) and it is in
        the card below, not in this title. One source, and one place: the title
        would have to flicker from `Organisation` to the name as the fetch
        lands, and the nav item next to it says `Organisation` regardless.
      */}
      <ScreenHeader
        title="Organisation"
        context={`${String(state.people.length)}${state.truncated ? '+' : ''} ${
          state.people.length === 1 && !state.truncated ? 'person' : 'people'
        }${active === state.people.length ? '' : ` · ${String(active)} active`}`}
      />

      {org !== undefined && (
        <section className="org-card" aria-labelledby="org-name">
          <header className="org-card-head">
            <h2 id="org-name">{org.name}</h2>
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
                        The key itself is never shown — §12 stores it encrypted and nothing decrypts
                        it to build this page.
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
                    {person.name}
                    {person.id === me.id && <span className="org-chip org-chip-you">YOU</span>}
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
                    <select
                      id={`role-${person.id}`}
                      className="org-role-select"
                      value={person.org_role}
                      disabled={changing === person.id}
                      onChange={(event) => {
                        change(person.id, { org_role: event.target.value });
                      }}
                    >
                      {/* Their current role is always an option even when
                          this actor could not grant it — an Admin looking at an
                          Owner must see what that person *is*, and a `<select>`
                          whose value is not among its options renders blank. */}
                      {(grantable.includes(person.org_role as OrgRole)
                        ? grantable
                        : [person.org_role as OrgRole, ...grantable]
                      ).map((r) => (
                        <option key={r} value={r}>
                          {orgRoleLabel(r)}
                        </option>
                      ))}
                    </select>

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
              <select
                value={role}
                disabled={busy}
                onChange={(event) => {
                  setRole(event.target.value as OrgRole);
                }}
              >
                {ORG_ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>
                    {orgRoleLabel(r)}
                  </option>
                ))}
              </select>
            </label>

            <Button type="submit" busy={busy} busyLabel="Sending…">
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
                This link is shown once — the server stores only a hash of it. Send it now; if it is
                lost, revoke this invite and create another.
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
    </div>
  );
}
