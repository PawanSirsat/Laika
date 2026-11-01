import { useState } from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { transferOwnership } from '../../../api/org.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { OrgRole } from '../../../api/invites.ts';
import type { OrgUser } from '../../../api/users.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { newOwnerCandidates } from './people-derive.ts';

export interface TransferOwnershipProps {
  readonly me: MeProfile;
  readonly people: readonly OrgUser[];
  /**
   * After the server has answered — the reader is an admin now, so the page
   * starts again from their new role. A full load by default: `me`, the gates
   * and every cached answer change at once, and nothing should survive that
   * still believing they own the organisation.
   */
  readonly onTransferred?: () => void;
}

const reloadPage = (): void => {
  window.location.assign('/organisation?tab=people');
};

/**
 * Transfer ownership (D-104 item 2, LAI-982): the owner names an active admin
 * or member and types that person's email. The server makes them owner and the
 * reader an admin in one transaction, and checks the email itself — the typed
 * confirmation here is what it will ask, not the only check.
 */
export function TransferOwnership({
  me,
  people,
  onTransferred = reloadPage,
}: TransferOwnershipProps) {
  const candidates = newOwnerCandidates(people, me.id);
  const [chosen, setChosen] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const target = candidates.find((p) => p.id === chosen);

  return (
    <section className="org-card org-transfer" aria-labelledby="org-transfer">
      <header className="org-card-head">
        <h2 id="org-transfer">Transfer ownership</h2>
      </header>
      <p className="org-note">
        An organisation has exactly one owner. Handing it over makes them the owner and you an
        admin, at once. Only they can hand it back.
      </p>
      {candidates.length === 0 ? (
        <p className="org-note">
          Nobody can take it yet: ownership goes to an active admin or member.
        </p>
      ) : (
        <div className="org-transfer-row">
          <Dropdown
            className="org-transfer-pick"
            aria-label="New owner"
            noun="people"
            placeholder="Choose the new owner"
            searchable={candidates.length > 8}
            value={chosen}
            onChange={setChosen}
            options={candidates.map((p) => ({
              value: p.id,
              label: p.name,
              detail: `${orgRoleLabel(p.org_role as OrgRole)} · ${p.email}`,
            }))}
          />
          <span className="org-transfer-open" data-transfer-open>
            <Button
              variant="danger"
              disabled={target === undefined}
              onClick={() => {
                setError(undefined);
                setOpen(true);
              }}
            >
              Transfer ownership…
            </Button>
          </span>
        </div>
      )}

      {open && target !== undefined && (
        <ConfirmDialog
          title={`Make ${target.name} the owner?`}
          confirmLabel="Transfer ownership"
          danger
          typed={{ label: `Type ${target.email} to confirm`, expected: target.email }}
          busy={busy}
          error={error}
          onConfirm={(typed) => {
            setBusy(true);
            setError(undefined);
            transferOwnership(target.id, typed.trim())
              .then(() => {
                setOpen(false);
                onTransferred();
              })
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : 'The transfer was refused.');
              })
              .finally(() => {
                setBusy(false);
              });
          }}
          onClose={() => {
            setOpen(false);
          }}
        >
          <p>
            {target.name} becomes the organisation’s owner, with every power that carries — changing
            roles and permissions, and handing it on. You become an admin, with what the owner
            grants admins.
          </p>
          <p>This cannot be undone from your side.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
