import { useState } from 'react';
import { updateOrg, type Org } from '../../../api/org.ts';

export interface OrgNameFactProps {
  readonly org: Org;
  /** `org.settings.edit` — *Change organisation settings* (D-104 item 7). */
  readonly canEdit: boolean;
  readonly onSaved: (org: Org) => void;
}

/**
 * The organisation's name on Overview (LAI-987, D-104 item 7): a field and
 * Save for whoever holds *Change organisation settings*, the name as text for
 * everyone else. 1–80 characters; the server trims it and refuses an empty one.
 */
export function OrgNameFact({ org, canEdit, onSaved }: OrgNameFactProps) {
  const [draft, setDraft] = useState(org.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const trimmed = draft.trim();
  const changed = trimmed !== org.name;

  return (
    <div className="org-fact" data-fact="name">
      <dt id="org-name-label">Name</dt>
      <dd>
        {canEdit ? (
          <form
            className="org-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!changed || trimmed === '' || busy) return;
              setBusy(true);
              setError(undefined);
              updateOrg({ name: trimmed })
                .then((saved) => {
                  setDraft(saved.name);
                  onSaved(saved);
                })
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : 'That name was refused.');
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            <input
              className="input org-name-input"
              aria-labelledby="org-name-label"
              maxLength={80}
              value={draft}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
            <button
              type="submit"
              className="org-btn org-btn-primary org-name-save"
              disabled={!changed || trimmed === '' || busy}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        ) : (
          <span>{org.name}</span>
        )}
        {error !== undefined && (
          <span className="org-fact-error" role="alert">
            {error}
          </span>
        )}
      </dd>
    </div>
  );
}
