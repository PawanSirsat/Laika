import { Spinner } from '../../../components/Spinner.tsx';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import { useGates } from '../../../api/permissions.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import {
  dismissUnlisted,
  firstLine,
  mayPromote,
  promoteBlocker,
  promoteUnlisted,
  unlistedState,
  type UnlistedWork,
} from '../../../api/unlisted.ts';
import { timeLabel } from '../../../api/time-label.ts';
import '../../../components/markers.css';
import './unlisted.css';

export interface UnlistedListProps {
  /** Already in the order to show — newest first is the caller's. */
  readonly rows: readonly UnlistedWork[];
  /**
   * `user_id` → display name.
   *
   * **A name map, not `Member`.** The list only ever reads `.name`, so the
   * prop asks for nothing it would have to invent.
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
 * The unlisted rows, **one line each** (LAI-754), with promote and dismiss
 * (SPEC §4.14).
 *
 * The owner's words about the card list this replaces: *"this Unlisted work
 * list is too big"*. Each note is a line — repo, who, when, its first line —
 * and a click opens the full text with the actions under it. Nothing a card
 * offered is lost; it is one click further away, which is the trade a long
 * queue wants.
 *
 * Only the Unlisted screen uses it now: Capacity carried the same list from
 * LAI-439 until LAI-754 took it off.
 */
export function UnlistedList({ rows, names, onOpenTask, onChanged }: UnlistedListProps) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [promoting, setPromoting] = useState<UnlistedWork | undefined>(undefined);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [justPromoted, setJustPromoted] = useState<PromotionResult | undefined>(undefined);
  const now = Date.now();
  const formId = useId();

  /*
   * The spaces this reader may create a task in (B15, LAI-1128): every space
   * they can see, narrowed by `task.create` from `GET /permissions`. It was a
   * free-text box whose placeholder was a fixture's slug, so a typo was only
   * found out when the server refused it. Read the first time a promote form
   * opens, not with the queue.
   */
  const gates = useGates();
  const [visible, setVisible] = useState<readonly Project[] | null | undefined>(undefined);
  const [spacesAsked, setSpacesAsked] = useState(0);
  const wantSpaces = promoting !== undefined || spacesAsked > 0;
  useEffect(() => {
    if (!wantSpaces) return;
    const controller = new AbortController();
    setVisible(undefined);
    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        if (!controller.signal.aborted) setVisible(items.filter(isProject));
      })
      .catch(() => {
        if (!controller.signal.aborted) setVisible(null);
      });
    return () => {
      controller.abort();
    };
  }, [wantSpaces, spacesAsked]);
  const spaces: readonly Project[] | null | undefined =
    visible === undefined || visible === null
      ? visible
      : !gates.settled
        ? undefined
        : gates.failed
          ? null
          : visible
              .filter((space) => gates.project(space.id, 'task.create'))
              .sort((a, b) => a.name.localeCompare(b.name));
  // One space to choose from is no choice: take it.
  const onlySlug = spaces?.length === 1 ? spaces[0]?.slug : undefined;
  const chosen = slug === '' && onlySlug !== undefined ? onlySlug : slug;
  const blocker = promoteBlocker(spaces, chosen, title);

  const retrySpaces = (): void => {
    if (gates.failed) gates.refresh();
    setSpacesAsked((n) => n + 1);
  };

  const promote = (): void => {
    if (promoting === undefined || blocker !== undefined || busy) return;
    setBusy(true);
    setActionError(undefined);

    promoteUnlisted(promoting.id, { project_slug: chosen, title: title.trim() })
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
    void confirm({
      title: 'Dismiss this note?',
      body: 'It stays on record — turn on “Show dismissed” to find it again.',
      confirmLabel: 'Dismiss',
      icon: 'warning',
      detail: row.repo,
    }).then((yes) => {
      if (yes) dismissNow(row);
    });
  };

  const dismissNow = (row: UnlistedWork): void => {
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
          const who = names.get(row.user_id) ?? 'Someone';
          const when = timeLabel(row.created_at, now);
          const open = expanded === row.id;
          const promotedKey =
            justPromoted?.unlistedId === row.id ? justPromoted.taskKey : undefined;

          return (
            <li key={row.id} className={`unl-row unl-row-${state}${open ? ' unl-row-open' : ''}`}>
              <button
                type="button"
                className="unl-line"
                aria-expanded={open}
                onClick={() => {
                  setExpanded(open ? undefined : row.id);
                }}
              >
                <span className="unl-repo" title={row.repo}>
                  {row.repo}
                </span>
                <span className="unl-who" title={who}>
                  {who}
                </span>
                <time className="unl-when" dateTime={when.iso} title={when.full}>
                  {when.text}
                </time>
                <span className="unl-first">{firstLine(row.note)}</span>
                {/* Decided rows say so on the line, so the queue can be read
                    without opening anything. */}
                {state !== 'pending' && (
                  <span className={`unl-tag unl-tag-${state}`}>
                    {state === 'promoted' ? 'Promoted' : 'Dismissed'}
                  </span>
                )}
                <span className="unl-caret" aria-hidden="true" />
              </button>

              {open && (
                <div className="unl-detail">
                  <p className="unl-note">{row.note}</p>

                  <div className="unl-row-actions">
                    {/* `token_id` is what makes it an agent's note rather than a
                        person's — §4.14 carries it for exactly this. */}
                    {row.token_id !== null && <span className="marker marker-agent">agent</span>}
                    <span className="unl-at">{when.full}</span>
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
                            setTitle(firstLine(row.note).slice(0, 120));
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
                    <form
                      className="unl-form"
                      aria-label="Promote to task"
                      onSubmit={(event: FormEvent) => {
                        // Enter in the title submits, as a form does.
                        event.preventDefault();
                        promote();
                      }}
                    >
                      <div className="unl-field">
                        <span className="unl-label" id={`${formId}-space`}>
                          Space
                        </span>
                        <Dropdown
                          className="unl-space"
                          aria-labelledby={`${formId}-space`}
                          value={chosen}
                          placeholder={spaces === undefined ? 'Loading spaces…' : 'Choose a space'}
                          disabled={spaces === undefined || spaces === null || spaces.length === 0}
                          noun="spaces"
                          options={(spaces ?? []).map((space) => ({
                            value: space.slug,
                            label: space.name,
                            detail: space.prefix,
                          }))}
                          onChange={setSlug}
                        />
                      </div>
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
                        {blocker !== undefined && (
                          <p className="unl-hint" id={`${formId}-why`}>
                            {blocker}
                            {spaces === null && (
                              <>
                                {' '}
                                <button type="button" className="unl-link" onClick={retrySpaces}>
                                  Try again
                                </button>
                              </>
                            )}
                          </p>
                        )}
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
                          type="submit"
                          className="bar-control bar-control-primary"
                          disabled={busy || blocker !== undefined}
                          aria-describedby={blocker === undefined ? undefined : `${formId}-why`}
                        >
                          {busy && <Spinner size="sm" />}
                          Create task
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
