import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import {
  dismissUnlisted,
  listUnlisted,
  mayPromote,
  promoteUnlisted,
  unlistedState,
  type UnlistedWork,
} from '../../../api/unlisted.ts';
import type { Member } from '../../../api/tasks.ts';
import './unlisted.css';

export interface UnlistedScreenProps {
  /** Open a task — a promotion that cannot be reached is a dead end (AC2). */
  readonly onOpenTask: (taskKey: string) => void;
  readonly members: ReadonlyMap<string, Member>;
}

/** A promoted row, remembered so the link survives the list refresh. */
interface PromotionResult {
  readonly unlistedId: string;
  readonly taskKey: string;
}

/**
 * Unlisted work triage (SPEC §4.14, LAI-413).
 *
 * `log_unlisted_work` is the one MCP tool with no REST twin, and without this
 * screen it was write-only: an agent recorded what it noticed outside any
 * project and the rows accumulated where nobody looked.
 *
 * Admin-up only — these are audit rows and §4.14 borrows `audit_log.export`
 * rather than inventing a permission. The nav entry is **absent** for everyone
 * else (LAI-082), so this screen is not reached by anyone it would refuse.
 */
export function UnlistedScreen({ onOpenTask, members }: UnlistedScreenProps) {
  const [rows, setRows] = useState<readonly UnlistedWork[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [includeDismissed, setIncludeDismissed] = useState(false);

  const [promoting, setPromoting] = useState<UnlistedWork | undefined>(undefined);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [justPromoted, setJustPromoted] = useState<PromotionResult | undefined>(undefined);

  const load = (signal?: AbortSignal): void => {
    listUnlisted({ includeDismissed }, signal)
      .then((page) => {
        setRows(page.data);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [includeDismissed]);

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
        load();
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
        load();
      })
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : 'Could not dismiss that note.');
      });
  };

  return (
    <div className="unl">
      <ScreenHeader
        title="Unlisted work"
        context={rows === undefined ? undefined : `${String(rows.length)} in the queue`}
      >
        <label className="unl-toggle">
          <input
            type="checkbox"
            checked={includeDismissed}
            onChange={(event) => {
              setIncludeDismissed(event.target.checked);
            }}
          />
          {/* AC3's other half: dismissing is not deleting, so there has to be a
              way back to what was dismissed. */}
          <span>Show dismissed</span>
        </label>
      </ScreenHeader>

      <p className="unl-sub">
        Work an agent noticed outside any project — a stale dependency, a broken script, something
        nobody had filed. Promote what matters into a task; dismiss the rest.
      </p>

      {actionError !== undefined && (
        <p className="unl-error" role="alert">
          {actionError}
        </p>
      )}

      {error !== null ? (
        <ApiErrorState error={error} resource="the unlisted queue" scope="organisation" />
      ) : rows === undefined ? (
        <LoadingState shape="row" count={3} label="Loading unlisted work" />
      ) : rows.length === 0 ? (
        <EmptyState
          headline="Nothing unlisted"
          body={
            includeDismissed
              ? 'No agent has logged work outside a project yet.'
              : 'Nothing is waiting to be triaged. Agents log work here when they notice something outside any project.'
          }
        />
      ) : (
        <ul className="unl-list">
          {rows.map((row) => {
            const state = unlistedState(row);
            const who = members.get(row.user_id);
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
                  <span className="unl-who">{who?.name ?? 'Someone'}</span>
                </div>

                <p className="unl-note">{row.note}</p>

                <div className="unl-row-actions">
                  {state === 'promoted' ? (
                    /* AC4: already promoted. The server answers 409 to a second
                       attempt, so this shows the result instead of offering a
                       control that is guaranteed to fail. */
                    <button
                      type="button"
                      className="unl-link"
                      onClick={() => {
                        onOpenTask(promotedKey ?? row.promoted_task_id ?? '');
                      }}
                    >
                      {promotedKey === undefined
                        ? 'Open the task it became'
                        : `Open ${promotedKey}`}
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
      )}
    </div>
  );
}
