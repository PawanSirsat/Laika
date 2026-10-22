import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  getOrgPermissions,
  setOrgPermissions,
  type Grants,
  type OrgPermissions,
} from '../../../api/permissions.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { actionName, lockedRoles, sameGrants, withGrant } from './permissions-view.ts';

type GrantsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly view: OrgPermissions };

export interface GrantsCardProps {
  /** Every org role, from `GET /permissions` — the ones no grant reaches are the locked columns. */
  readonly orgRoles: readonly string[];
  /** Switches and Save, or the same grid as text. The server's answer (`mayEditGrants`). */
  readonly editable: boolean;
  /** A save landed: whatever else on the tab is `can()`'s answer is stale. */
  readonly onSaved: () => void;
}

/** `22 Oct 2026, 14:05` — when the grid last changed, in the reader's own clock. */
function changedLabel(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Organisation → Roles & permissions → **Who can do what** (LAI-960, D-102
 * rule 6), from `GET` and `PUT /api/v1/org/permissions`.
 *
 * Capabilities × the grantable roles, as switches for the owner and as text
 * for everyone else. The roles no grant reaches — the owner — are a column
 * that is on and cannot be switched, and the owner-locked actions are listed
 * beneath. **Every capability, role and label is the response's.**
 *
 * Save sends the **whole** matrix, which is what `PUT` takes, and a refusal is
 * shown here in the server's words. The tables below this card are `can()`'s
 * answer under these grants, so a save asks for them again.
 */
export function GrantsCard({ orgRoles, editable, onSaved }: GrantsCardProps) {
  const [state, setState] = useState<GrantsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Grants | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    getOrgPermissions(controller.signal)
      .then((view) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', view });
        setDraft(view.grants);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const head = (
    <header className="org-card-head">
      <h2 id="perm-grants">Who can do what</h2>
    </header>
  );

  if (state.status === 'loading') {
    return (
      <section className="org-card perm-card" data-card="grants" aria-labelledby="perm-grants">
        {head}
        <LoadingState shape="table" count={5} label="Loading who can do what" />
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="org-card perm-card" data-card="grants" aria-labelledby="perm-grants">
        {head}
        <ApiErrorState
          error={state.error}
          resource="who can do what"
          scope="organisation"
          onRetry={reload}
        />
      </section>
    );
  }

  const { view } = state;
  const shown = draft ?? view.grants;
  const unchanged = sameGrants(shown, view.grants);
  const locked = lockedRoles(orgRoles, view.roles);

  const save = () => {
    setBusy(true);
    setError(undefined);
    setOrgPermissions(shown)
      .then((saved) => {
        setState({ status: 'ready', view: saved });
        setDraft(saved.grants);
        onSaved();
      })
      .catch((cause: unknown) => {
        // The server's refusal, verbatim: which cell, and why.
        setError(cause instanceof ApiError ? cause.message : 'The change did not save.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="org-card perm-card" data-card="grants" aria-labelledby="perm-grants">
      {head}
      <p className="org-note">
        {editable
          ? 'Switch a capability on or off for a role, then save. The owner holds every one.'
          : 'Set by the owner, who holds every one.'}
      </p>

      <table className="perm-table perm-grants" data-scope="grants">
        <thead>
          <tr>
            <th scope="col">Capability</th>
            {[...locked, ...view.roles].map((role) => (
              <th key={role} scope="col" className="perm-role">
                {role}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.capabilities.map((capability) => (
            <tr key={capability.id} data-capability={capability.id}>
              <th scope="row" className="perm-action">
                <span className="perm-action-name">{capability.label}</span>
                {/* What it lets a role do, in the server's words (LAI-985, LAI-989). */}
                {capability.description !== '' && (
                  <span className="perm-action-description">{capability.description}</span>
                )}
              </th>
              {locked.map((role) => (
                <td key={role} className="perm-cell" data-role={role} data-holding="yes">
                  <span className="perm-cell-role" aria-hidden="true">
                    {role}
                  </span>
                  {editable ? (
                    <Switch checked disabled onChange={() => undefined}>
                      <span className="visually-hidden">
                        {capability.label}: {role}, always
                      </span>
                    </Switch>
                  ) : (
                    <span className="perm-cell-value">Yes</span>
                  )}
                </td>
              ))}
              {view.roles.map((role) => {
                const on = shown[role]?.[capability.id] ?? false;
                return (
                  <td
                    key={role}
                    className="perm-cell"
                    data-role={role}
                    data-holding={on ? 'yes' : 'no'}
                  >
                    <span className="perm-cell-role" aria-hidden="true">
                      {role}
                    </span>
                    {editable ? (
                      <Switch
                        checked={on}
                        disabled={busy}
                        onChange={(next) => {
                          setDraft(withGrant(shown, role, capability.id, next));
                        }}
                      >
                        <span className="visually-hidden">
                          {capability.label}: {role}
                        </span>
                      </Switch>
                    ) : (
                      <span className="perm-cell-value">{on ? 'Yes' : 'No'}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {view.owner_locked.length > 0 && (
        <>
          <h3 className="perm-subhead">Only the owner, whatever is switched on</h3>
          <ul className="perm-held perm-locked">
            {view.owner_locked.map((item) => (
              <li key={item.action}>{actionName(item)}</li>
            ))}
          </ul>
        </>
      )}

      {view.updated_at !== null && (
        <p className="org-note" data-fact="updated">
          Last changed {changedLabel(view.updated_at)}
        </p>
      )}

      {editable && (
        <>
          {error !== undefined && (
            <p className="org-fact-error" role="alert">
              {error}
            </p>
          )}
          <div className="perm-grants-actions">
            <Button busy={busy} disabled={unchanged} onClick={save}>
              Save
            </Button>
            <Button
              variant="secondary"
              disabled={unchanged || busy}
              onClick={() => {
                setDraft(view.grants);
                setError(undefined);
              }}
            >
              Discard
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
