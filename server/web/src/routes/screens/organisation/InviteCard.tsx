import { useState, type Ref } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import {
  createInvite,
  INVITE_EXPIRY_DAYS,
  reissueInvite,
  revokeInvite,
  type InviteExpiryDays,
  type OrgRole,
  type PendingInvite,
  type ProjectRole,
} from '../../../api/invites.ts';
import { projectRoleLabel } from '../../../api/members.ts';
import type { Project } from '../../../api/projects.ts';
import { invitableRoles, orgRoleLabel } from '../invite-roles.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { parseEmails, spaceRolesFor } from './people-model.ts';

const DAY = 86_400_000;

/** `in 6 days`, `today`, or `expired` — the invite's own clock. */
function expiryLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `in ${String(days)} ${days === 1 ? 'day' : 'days'}`;
  return 'today';
}

const EXPIRY_LABEL: Readonly<Record<InviteExpiryDays, string>> = {
  1: 'Expires in 1 day',
  7: 'Expires in 7 days',
  30: 'Expires in 30 days',
};

/** One row of a send: a link to copy, or the server's refusal for that address. */
type Issued =
  | { readonly key: string; readonly email: string | null; readonly url: string }
  | { readonly key: string; readonly email: string | null; readonly error: string };

export interface InviteCardProps {
  readonly actorRole: string;
  readonly invites: readonly PendingInvite[];
  readonly invitesError: unknown;
  readonly projects: readonly Project[];
  readonly reload: () => void;
  /** The address box, for *+ Invite people* to focus. */
  readonly inputRef: Ref<HTMLTextAreaElement>;
}

const message = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

/**
 * Invites (LAI-987, D-104): paste one address or many — each gets its own
 * result line — or leave it blank for a link anyone may use; optionally into
 * a space with a space role; with a chosen lifetime. Every link is shown
 * **once**, with Copy, because the server keeps only a hash. A lost link is
 * not recoverable, so each pending invite has **Re-issue**: a new link for
 * the same person and roles, the old one revoked in the same step.
 */
export function InviteCard({
  actorRole,
  invites,
  invitesError,
  projects,
  reload,
  inputRef,
}: InviteCardProps) {
  const roles = invitableRoles(actorRole);
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [space, setSpace] = useState('');
  const [spaceRole, setSpaceRole] = useState<ProjectRole>('member');
  const [expiry, setExpiry] = useState<InviteExpiryDays>(7);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<readonly Issued[]>([]);
  const [listError, setListError] = useState<unknown>(null);
  const [revoking, setRevoking] = useState<PendingInvite | undefined>(undefined);
  const [revokeError, setRevokeError] = useState<string | undefined>(undefined);

  const parsed = parseEmails(emails);
  const spaceRoles = spaceRolesFor(role);
  const effectiveSpaceRole = spaceRoles.includes(spaceRole) ? spaceRole : spaceRoles[0];
  const projectName = (id: string | null): string | undefined =>
    id === null ? undefined : (projects.find((p) => p.id === id)?.name ?? 'a space');

  const send = async (): Promise<void> => {
    setBusy(true);
    setListError(null);
    const into = space === '' ? {} : { project_id: space, project_role: effectiveSpaceRole };
    const targets: (string | null)[] = parsed.valid.length === 0 ? [null] : [...parsed.valid];
    const results: Issued[] = [];
    // One at a time, in the order pasted: each is its own answer, and one
    // refused address (already a member, already invited) must not stop the rest.
    for (const email of targets) {
      const key = `${email ?? 'link'}-${String(Date.now())}-${String(results.length)}`;
      try {
        const created = await createInvite({
          email,
          org_role: role,
          expires_in_days: expiry,
          ...into,
        });
        results.push({ key, email, url: created.accept_url });
      } catch (cause: unknown) {
        results.push({ key, email, error: message(cause, 'That invite was refused.') });
      }
    }
    setIssued(results);
    // Keep only what failed in the box, so a retry is one click.
    setEmails(
      results
        .filter((r) => 'error' in r && r.email !== null)
        .map((r) => r.email)
        .join('\n'),
    );
    setBusy(false);
    reload();
  };

  const reissue = (invite: PendingInvite): void => {
    setListError(null);
    reissueInvite(invite.id)
      .then((created) => {
        setIssued([
          {
            key: `${created.invite.id}-reissued`,
            email: created.invite.email,
            url: created.accept_url,
          },
        ]);
        reload();
      })
      .catch((cause: unknown) => {
        setListError(cause);
      });
  };

  const now = Date.now();

  return (
    <section className="org-card" aria-labelledby="org-invites">
      <header className="org-card-head">
        <h2 id="org-invites">Invite people</h2>
      </header>

      <form
        className="org-invite-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || parsed.invalid.length > 0) return;
          void send();
        }}
      >
        <label className="org-invite-email">
          <span className="org-field-label">Email addresses</span>
          <textarea
            ref={inputRef}
            className="input org-invite-emails"
            rows={2}
            placeholder="name@company.com — paste several, one per line or separated by commas. Leave blank for a link anyone may use."
            value={emails}
            disabled={busy}
            onChange={(event) => {
              setEmails(event.target.value);
            }}
          />
          {parsed.invalid.length > 0 ? (
            <span className="org-field-error" role="alert">
              Not an email address: {parsed.invalid.join(', ')}
            </span>
          ) : (
            <span className="org-field-hint">
              {parsed.valid.length === 0
                ? 'One link, for whoever you send it to.'
                : `${String(parsed.valid.length)} ${parsed.valid.length === 1 ? 'invite' : 'invites'}, one link each.`}
            </span>
          )}
        </label>

        <div className="org-invite-options">
          <label className="org-invite-field">
            <span className="org-field-label">Organisation role</span>
            <Dropdown
              className="org-invite-role"
              noun="roles"
              value={role}
              disabled={busy}
              onChange={setRole}
              options={roles.map((r) => ({ value: r, label: orgRoleLabel(r) }))}
            />
          </label>

          {projects.length > 0 && (
            <label className="org-invite-field">
              <span className="org-field-label">Space</span>
              <Dropdown
                className="org-invite-space"
                noun="spaces"
                searchable={projects.length > 8}
                value={space}
                disabled={busy}
                onChange={setSpace}
                options={[
                  { value: '', label: 'No space' },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </label>
          )}

          {space !== '' && effectiveSpaceRole !== undefined && (
            <label className="org-invite-field">
              <span className="org-field-label">Space role</span>
              <Dropdown
                className="org-invite-space-role"
                noun="roles"
                value={effectiveSpaceRole}
                disabled={busy || spaceRoles.length === 1}
                onChange={setSpaceRole}
                options={spaceRoles.map((r) => ({
                  value: r,
                  label: r === 'lead' ? 'Space admin' : projectRoleLabel(r),
                }))}
              />
            </label>
          )}

          <label className="org-invite-field">
            <span className="org-field-label">Lifetime</span>
            <Dropdown
              className="org-invite-expiry"
              noun="lifetimes"
              value={String(expiry)}
              disabled={busy}
              onChange={(value) => {
                setExpiry(Number(value) as InviteExpiryDays);
              }}
              options={INVITE_EXPIRY_DAYS.map((d) => ({
                value: String(d),
                label: EXPIRY_LABEL[d],
              }))}
            />
          </label>

          <button
            type="submit"
            className="org-btn org-btn-primary org-invite-send"
            disabled={busy || parsed.invalid.length > 0}
          >
            {busy
              ? 'Sending…'
              : parsed.valid.length > 1
                ? `Create ${String(parsed.valid.length)} invites`
                : parsed.valid.length === 1
                  ? 'Create invite'
                  : 'Create link'}
          </button>
        </div>
      </form>

      {issued.length > 0 && (
        <div className="org-issued" role="status">
          <p className="org-issued-head">
            {issued.length === 1 ? 'Invite' : 'Invites'} — each link is shown once
          </p>
          <p className="org-issued-body">
            The server stores only a hash, and Laika sends no email. Copy each link and send it now;
            if one is lost, Re-issue it below.
          </p>
          <ul className="org-issued-list">
            {issued.map((row) => (
              <li key={row.key} className="org-issued-row" data-ok={'url' in row}>
                <span className="org-issued-who">{row.email ?? 'Anyone with the link'}</span>
                {'url' in row ? (
                  <>
                    <code className="org-issued-url">{row.url}</code>
                    <CopyButton
                      text={row.url}
                      label="Copy link"
                      what={`the invite link for ${row.email ?? 'anyone'}`}
                    />
                  </>
                ) : (
                  <span className="org-issued-error">{row.error}</span>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="org-btn"
            onClick={() => {
              setIssued([]);
            }}
          >
            Done
          </button>
        </div>
      )}

      <header className="org-card-head org-card-subhead">
        <h3 id="org-pending">Pending invites</h3>
        <span className="org-count">{String(invites.length)}</span>
      </header>

      {invitesError !== null && (
        <ApiErrorState
          error={invitesError}
          resource="pending invites"
          scope="organisation"
          onRetry={reload}
        />
      )}
      {listError !== null && (
        <ApiErrorState error={listError} resource="this invite" verb="update" />
      )}

      {invites.length === 0 ? (
        <p className="org-note">No invites are waiting to be accepted.</p>
      ) : (
        <ul className="org-invites" aria-labelledby="org-pending">
          {invites.map((invite) => {
            const into = projectName(invite.project_id);
            return (
              <li key={invite.id}>
                <span className="org-invite-who">
                  <span className="org-person-name">
                    {invite.email ?? 'Anyone with the link'}
                    <span className="org-chip">{orgRoleLabel(invite.org_role)}</span>
                  </span>
                  <span className="org-person-email">
                    {into !== undefined &&
                      `into ${into}${invite.project_role === null ? '' : ` as ${invite.project_role === 'lead' ? 'space admin' : invite.project_role}`} · `}
                    expires {expiryLabel(invite.expires_at, now)}
                    {!invite.email_sent && ' · not emailed — send the link yourself'}
                  </span>
                </span>
                <span className="org-invite-actions">
                  <button
                    type="button"
                    className="org-btn org-reissue"
                    title="A new link for the same person and roles; the old one stops working"
                    onClick={() => {
                      reissue(invite);
                    }}
                  >
                    Re-issue
                  </button>
                  <button
                    type="button"
                    className="org-btn org-btn-danger-quiet org-revoke"
                    onClick={() => {
                      setRevokeError(undefined);
                      setRevoking(invite);
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

      {revoking !== undefined && (
        <ConfirmDialog
          title={`Revoke the invite for ${revoking.email ?? 'anyone with the link'}?`}
          confirmLabel="Revoke invite"
          danger
          busy={busy}
          error={revokeError}
          onConfirm={() => {
            setBusy(true);
            revokeInvite(revoking.id)
              .then(() => {
                setRevoking(undefined);
                reload();
              })
              .catch((cause: unknown) => {
                setRevokeError(message(cause, 'Could not revoke that invite.'));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
          onClose={() => {
            setRevoking(undefined);
          }}
        >
          <p>
            The link stops working at once. Nobody has joined through it yet; to invite them again,
            create a new invite.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
