import { useState } from 'react';
import type { OrgOwnerInvite } from '../../../api/org.ts';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { expiryLabel } from './people-derive.ts';

export interface OwnerInvitesProps {
  /** `GET /org`'s `owner_invites_pending` — served to the owner alone (LAI-982). */
  readonly invites: readonly OrgOwnerInvite[];
  /** Rejects with the server's refusal, which the dialog shows in its own words. */
  readonly onRevoke: (id: string) => Promise<void>;
}

/**
 * Owner invites made before D-104 (LAI-181): nobody can accept them any more —
 * the server refuses with `use_transfer` — but each still sits in the
 * organisation until it expires. The owner revokes them here, one at a time,
 * behind a confirmation; *Transfer ownership* is the way to a new owner.
 */
export function OwnerInvites({ invites, onRevoke }: OwnerInvitesProps) {
  const [asking, setAsking] = useState<OrgOwnerInvite | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const now = Date.now();
  const who = (invite: OrgOwnerInvite): string => invite.email ?? 'A link with no address';

  return (
    <section className="org-card org-owner-invites" aria-labelledby="org-owner-invites">
      <header className="org-card-head">
        <h2 id="org-owner-invites">Pending owner invites</h2>
        <span className="org-count">{String(invites.length)}</span>
      </header>
      <p className="org-note">
        Sent before an organisation could have only one owner. They can no longer be accepted, but
        they stay until they expire. Revoke them — to hand the organisation over, use Transfer
        ownership below.
      </p>
      <ul className="org-invites">
        {invites.map((invite) => (
          <li key={invite.id} data-owner-invite={invite.id}>
            <span className="org-invite-who">
              <span className="org-person-name">{who(invite)}</span>
              <span className="org-person-email">
                Owner · expires {expiryLabel(invite.expires_at, now)}
              </span>
            </span>
            <button
              type="button"
              className="org-invite-reissue org-owner-invite-revoke"
              disabled={busy}
              onClick={() => {
                setError(undefined);
                setAsking(invite);
              }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>

      {asking !== undefined && (
        <ConfirmDialog
          title={`Revoke the owner invite for ${who(asking)}?`}
          confirmLabel="Revoke"
          danger
          busy={busy}
          error={error}
          onConfirm={() => {
            setBusy(true);
            setError(undefined);
            onRevoke(asking.id)
              .then(() => {
                setAsking(undefined);
              })
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : 'The invite was not revoked.');
              })
              .finally(() => {
                setBusy(false);
              });
          }}
          onClose={() => {
            setAsking(undefined);
          }}
        >
          <p>The link stops working at once.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
