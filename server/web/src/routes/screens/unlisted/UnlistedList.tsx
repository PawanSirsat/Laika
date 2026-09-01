import { useState } from 'react';
import {
  dismissUnlisted,
  mayPromote,
  promoteUnlisted,
  unlistedState,
  type UnlistedWork,
} from '../../../api/unlisted.ts';
import '../../../components/markers.css';
import './unlisted.css';

export interface UnlistedListProps {
  readonly rows: readonly UnlistedWork[];
  /**
   * `user_id` → display name.
   *
   * **A name map, not `Member`.** The list only ever reads `.name`, and Capacity
   * knows people's names from `GET /capacity` while knowing nothing about their
   * email, role or join date — so a `Member`-shaped prop could only be satisfied
   * by inventing three fields. Narrowing the prop to what is used is what let
   * that screen pass real names instead of rendering "Someone".
   */
  readonly names: ReadonlyMap<string, string>;
  /** Open a task — a promotion that cannot be reached is a dead end. */
  readonly onOpenTask: (taskKey: string) => void;
  /** Reload the caller's list after a promote or a dismiss. */
  readonly onChanged: () => void;
}

/** A promoted row, remembered so the link survives the list refresh. */
interface PromotionResult {
  readonly unlistedId: string;
  readonly taskKey: string;
}

/**
 * The unlisted rows, with promote and dismiss (SPEC §4.14).
 *
 * **Extracted from `UnlistedScreen` by LAI-439**, which needs the same list on
 * the Capacity screen: §11.4.2 asks for *"unlisted work with one-click promote
 * to a task"* there, and AC5 says the click must not send somebody to another
 * screen and back.
 *
 * Copying it would have been the fourth `initials()` (LAI-215) and the third
 * padlock (LAI-436) — and worse than either, because a second promote form can
 * drift in what it sends rather than only in how it looks.
 *
 * The **loading**, the dismissed-toggle and the empty state stay with the
 * caller: the two screens genuinely differ there. `UnlistedScreen` shows the
 * whole org's queue with a toggle; Capacity shows one person's, already filtered
 * by the caller.
 */
export function UnlistedList({ rows, names, onOpenTask, onChanged }: UnlistedListProps) {
  const [promoting, setPromoting] = useState<UnlistedWork | undefined>(undefined);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [justPromoted, setJustPromoted] = useState<PromotionResult | undefined>(undefined);

  const promote = (): void => {
    if (promoting === undefined) return;
    setBusy(true);
    setActionError(undefined);

    promoteUnlisted(promoting.id, { project_slug: slug.trim(), title: title.trim() })
      .then((result) => {
        // Kept so the link to the new task survives the refresh below — the
        // row's own `promoted_task_id` is an id, and a person needs the key.
        setJustPromoted({ unlistedId: promoting.id, taskKey: result.task.key });
        setPromoting(undefined);
        setSlug('');
        setTitle('');
        onChanged();
      })
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : 'Could not promote that note.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const dismiss = (row: UnlistedWork): void => {
    if (
      !window.confirm(
        `Dismiss this note from ${row.repo}? It stays on record — turn on “Show dismissed” to find it again.`,
      )
    ) {
      return;
    }
    dismissUnlisted(row.id)
      .then(() => {
        onChanged();
      })
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : 'Could not dismiss that note.');
      });
  };

  return (
    <>
      {actionError !== undefined && (
        <p className="unl-error" role="alert">
          {actionError}
        </p>
      )}

      <ul className="unl-list">
        {rows.map((row) => {
          const state = unlistedState(row);
          const who = names.get(row.user_id);
          const promotedKey =
            justPromoted?.unlistedId === row.id ? justPromoted.taskKey : undefined;

          return (
            <li key={row.id} className={`unl-row unl-row-${state}`}>
              <div className="unl-row-head">
                <code className="unl-repo">{row.repo}</code>
                {/* `token_id` is what makes it an agent's note rather than a
                    person's — §4.14 carries it for exactly this. */}
                {row.token_id !== null && <span className="marker marker-agent">agent</span>}
                <span className="unl-when">{new Date(row.created_at).toLocaleString()}</span>
                <span className="unl-who">{who ?? 'Someone'}</span>
              </div>

              <p className="unl-note">{row.note}</p>

              <div className="unl-row-actions">
                {state === 'promoted' ? (
                  /* Already promoted. The server answers 409 to a second
                     attempt, so this shows the result instead of offering a
                     control that is guaranteed to fail. */
                  <button
                    type="button"
                    className="unl-link"
                    onClick={() => {
                      onOpenTask(promotedKey ?? row.promoted_task_id ?? '');
                    }}
                  >
                    {promotedKey === undefined ? 'Open the task it became' : `Open ${promotedKey}`}
                  </button>
                ) : state === 'dismissed' ? (
                  <span className="unl-state">Dismissed</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="unl-promote"
                      onClick={() => {
                        setPromoting(row);
                        setTitle(row.note.slice(0, 120));
                        setActionError(undefined);
                      }}
                    >
                      Promote to task
                    </button>
                    <button
                      type="button"
                      className="unl-dismiss"
                      onClick={() => {
                        dismiss(row);
                      }}
                    >
                      Dismiss
                    </button>
                  </>
                )}
              </div>

              {promoting?.id === row.id && mayPromote(row) && (
                <div className="unl-form">
                  <label className="unl-field">
                    <span className="unl-label">Project</span>
                    <input
                      className="unl-input"
                      value={slug}
                      placeholder="laika-core"
                      onChange={(event) => {
                        setSlug(event.target.value);
                      }}
                    />
                  </label>
                  <label className="unl-field unl-field-wide">
                    <span className="unl-label">Task title</span>
                    <input
                      className="unl-input"
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                      }}
                    />
                  </label>
                  <div className="unl-form-actions">
                    <button
                      type="button"
                      className="bar-control"
                      onClick={() => {
                        setPromoting(undefined);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="bar-control bar-control-primary"
                      disabled={busy || slug.trim() === '' || title.trim() === ''}
                      onClick={promote}
                    >
                      {busy ? 'Creating…' : 'Create task'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
