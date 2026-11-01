import { useState } from 'react';
import type { OrgOwnerRef } from '../../../api/org.ts';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';

export interface ExtraOwnersProps {
  /** `GET /org`'s `extra_owners` — served to the owner alone (LAI-982). */
  readonly owners: readonly OrgOwnerRef[];
  /** Resolves `true` when the server took it. */
  readonly onMakeAdmin: (id: string) => Promise<boolean>;
}

/**
 * Owners besides the recorded one (D-104 item 2, LAI-999 from LAI-987): made
 * before the role picker lost *Owner*. **Reported, never demoted silently** —
 * the owner decides, one at a time, behind a confirmation.
 */
export function ExtraOwners({ owners, onMakeAdmin }: ExtraOwnersProps) {
  const [asking, setAsking] = useState<OrgOwnerRef | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  return (
    <section className="org-card org-extra-owners" aria-labelledby="org-extra-owners">
      <header className="org-card-head">
        <h2 id="org-extra-owners">More than one owner</h2>
        <span className="org-count">{String(owners.length)}</span>
      </header>
      <p className="org-note">
        An organisation has exactly one owner. These people were made owners before that rule, and
        nothing has changed for them. Make each an admin when you are ready — or hand the
        organisation to one of them below.
      </p>
      <ul className="org-invites">
        {owners.map((owner) => (
          <li key={owner.id} data-extra-owner={owner.id}>
            <span className="org-invite-who">
              <span className="org-person-name">{owner.name}</span>
              <span className="org-person-email">{owner.email}</span>
            </span>
            <button
              type="button"
              className="org-invite-reissue org-make-admin"
              disabled={busy}
              onClick={() => {
                setAsking(owner);
              }}
            >
              Make admin
            </button>
          </li>
        ))}
      </ul>

      {asking !== undefined && (
        <ConfirmDialog
          title={`Make ${asking.name} an admin?`}
          confirmLabel="Make admin"
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            void onMakeAdmin(asking.id).finally(() => {
              setBusy(false);
              setAsking(undefined);
            });
          }}
          onClose={() => {
            setAsking(undefined);
          }}
        >
          <p>
            {asking.name} stops being an owner and holds what the owner grants admins. A refusal is
            shown under the People table.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
