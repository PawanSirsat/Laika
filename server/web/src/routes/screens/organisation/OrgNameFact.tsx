import { useState } from 'react';
import { updateOrg, type Org } from '../../../api/org.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { SaveStatus, useSaveStatus } from '../../../components/SaveStatus.tsx';
import { useAction } from '../../../components/toast/use-action.ts';

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
 * Beside Save, *Saving… / Saved / Couldn't save — Retry* (`SaveStatus`,
 * LAI-1129), *Saved* only on the server's answer. A refusal also toasts
 * (LAI-1310): the status beside Save is easy to miss; success does not, since
 * *Saved* is already said where the person is looking.
 */
export function OrgNameFact({ org, canEdit, onSaved }: OrgNameFactProps) {
  const [draft, setDraft] = useState(org.name);
  const [error, setError] = useState<string | undefined>(undefined);
  const status = useSaveStatus();
  const { run } = useAction();
  const busy = status.state.kind === 'saving';
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
              const name = trimmed;
              // The whole save — its answer handled too — is what Retry runs again.
              void run({
                do: () =>
                  status.run(() => {
                    setError(undefined);
                    return updateOrg({ name }).then(
                      (saved) => {
                        setDraft(saved.name);
                        onSaved(saved);
                      },
                      (cause: unknown) => {
                        setError(cause instanceof Error ? cause.message : 'That name was refused.');
                        throw cause;
                      },
                    );
                  }),
                // *Saved* beside the button says it; a toast as well would be twice.
                success: null,
                failure: 'Couldn’t rename the organisation',
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
                status.reset();
              }}
            />
            <span className="org-name-save" data-org-name-save>
              <Button type="submit" disabled={!changed || trimmed === ''} busy={busy}>
                Save
              </Button>
            </span>
            <SaveStatus state={status.state} onRetry={status.retry} />
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
