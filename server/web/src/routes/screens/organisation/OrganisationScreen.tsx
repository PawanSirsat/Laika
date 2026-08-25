import { useState } from 'react';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { canManageOrg, createInvite, revokeInvite, ORG_ROLES } from '../../../api/invites.ts';
import { orgRoleLabel } from '../invite-roles.ts';
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
 * The design also shows **AI provider**, a **monthly cap** and a **danger zone**
 * (rotate webhook secret, revoke all agent tokens, delete the org). None of
 * those has an endpoint, and one — the monthly cap — has no column either. The
 * task's own first criterion says to build what the existing endpoints support
 * **rather than stubbing**, so they are absent rather than present-and-inert.
 * LAI-222 carries the org endpoint and role management.
 *
 * The result is a screen that reads the org's people and manages its invites,
 * and says plainly what it cannot yet do.
 */
export function OrganisationScreen({ me }: OrganisationScreenProps) {
  const canManage = canManageOrg(me.org_role);
  const { state, reload } = useOrganisation(canManage);
  const { theme } = useTheme();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [issued, setIssued] = useState<{ url: string; email: string | null } | undefined>(
    undefined,
  );

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

  return (
    <div className="org">
      {/*
        No org name in the title: nothing serves it. `GET /api/v1/org` is in
        SPEC §6.4 and is not mounted, and `/me` carries no org either — so the
        signed-in app genuinely cannot learn which organisation it is looking
        at. A hardcoded name here would be the fixture CLAUDE.md §5.1 forbids.
      */}
      <ScreenHeader
        title="Organisation"
        context={`${String(state.people.length)}${state.truncated ? '+' : ''} ${
          state.people.length === 1 && !state.truncated ? 'person' : 'people'
        }${active === state.people.length ? '' : ` · ${String(active)} active`}`}
      />

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
              <li key={person.id} className={person.is_active ? '' : 'org-person-inactive'}>
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
                <span className="org-person-role">{orgRoleLabel(person.org_role as OrgRole)}</span>
              </li>
            );
          })}
        </ul>

        {/*
          The design's role dropdowns are "live". Ours are not rendered at all:
          no endpoint writes `org_role` or `is_active` — PATCH and DELETE on
          /users/:id both answer 404. A dropdown that cannot save is worse than
          none, because it looks like it did.
        */}
        <p className="org-note">
          Roles are read-only here. Changing an org role or deactivating someone needs an endpoint
          that does not exist yet (LAI-222). Project roles are managed on each project&rsquo;s
          members screen.
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
