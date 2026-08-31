import { useEffect, useRef, useState } from 'react';
import { AssignControl } from './AssignControl.tsx';
import { TagPicker } from './TagPicker.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { describeEvent, statusTransition } from '../../../api/activity.ts';
import { isAgentComment } from '../../../api/comments.ts';
import { useTaskDetail } from '../../../api/use-task-detail.ts';
import {
  BOARD_COLUMNS,
  COLUMN_LABELS,
  blockedState,
  type BoardColumn,
} from '../../../api/board-derive.ts';
import { describeActor } from './actor-presentation.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import './task-detail.css';

export interface TaskDetailPanelProps {
  readonly slug: string;
  readonly task: Task;
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly moving: boolean;
  readonly moveError: string | undefined;
  /** The same call the board uses — not a second implementation (LAI-056). */
  readonly onMove: (taskId: string, to: BoardColumn) => void;
  readonly onClose: () => void;
  /** The signed-in user's id, for Claim. */
  readonly meId?: string | undefined;
  /** False for a Viewer — `task.assign_other` is member+ (§3.2). */
  readonly mayAssign?: boolean | undefined;
  /**
   * False for a Viewer — editing a task is member+ (§3.2).
   *
   * A Viewer still **sees** the tags: they are part of reading the task, and
   * filtering the board by one is a read. They simply get no way to change
   * them, rather than a control that answers `403`.
   */
  readonly mayEdit?: boolean | undefined;
  /** The board reloads so the card's chips follow the panel. */
  readonly onTagsChanged: (tags: readonly string[]) => void;
  /** Reload the board after an assignment so the card's avatar follows. */
  readonly onAssigned: () => void;
}

function personName(id: string | null, members: ReadonlyMap<string, Member>): string {
  if (id === null) return 'someone';
  return members.get(id)?.name ?? id;
}

/**
 * The panel a card opens into (SPEC §11.4.2.1).
 *
 * A slide-over on the Board, not a route — §11.4.2 calls it a Board sub-view,
 * and giving it a URL would make it a screen the sidebar has to explain.
 *
 * **Comments read oldest-first and activity newest-first, in the same panel.**
 * That is deliberate and it will look like a bug: a thread is a conversation, so
 * it runs forward; a feed is scanned from the top, so it runs backward. Both
 * orders come from the server (LAI-047, LAI-055) and neither is re-sorted here.
 */
export function TaskDetailPanel({
  slug,
  task,
  byId,
  members,
  moving,
  moveError,
  onMove,
  onClose,
  meId,
  mayAssign = false,
  mayEdit = false,
  onTagsChanged,
  onAssigned,
}: TaskDetailPanelProps) {
  const detail = useTaskDetail(slug, task.id);
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  /**
   * Focus moves into the panel on open and **back to the card on close**.
   *
   * The restore has to be explicit. I first assumed the browser would return
   * focus once the dialog unmounted; it does not — focus falls to `<body>`, so
   * a keyboard user who pressed Escape lands at the top of the document and has
   * to tab the whole sidebar again. Verified in a browser, which is the only
   * way this shows up.
   */
  useEffect(() => {
    const opener = document.activeElement;
    panelRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [task.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const blocked = blockedState(task, byId);
  const discoveredFrom = task.discovered_from === null ? undefined : byId.get(task.discovered_from);

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} aria-hidden="true" />

      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${task.key} — ${task.title}`}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="panel-head">
          <div>
            <span className="panel-key">{task.key}</span>
            <h2 className="panel-title">{task.title}</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose}>
            <span className="visually-hidden">Close</span>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="panel-body">
          <section className="panel-section">
            <div className="panel-controls">
              <label className="panel-control">
                <span className="visually-hidden">Status</span>
                <select
                  value={task.status}
                  disabled={moving}
                  onChange={(event) => {
                    const to = event.target.value as BoardColumn;
                    if (to !== task.status) onMove(task.id, to);
                  }}
                >
                  {BOARD_COLUMNS.map((c) => (
                    <option key={c} value={c}>
                      {COLUMN_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>

              <span className={`panel-priority panel-priority-${task.priority}`}>
                {task.priority}
              </span>

              {task.ready && <span className="marker marker-ready">ready</span>}
              {blocked === true && <span className="marker marker-blocked">blocked</span>}

              <AssignControl
                task={task}
                members={members}
                meId={meId}
                mayAssign={mayAssign}
                onChanged={onAssigned}
              />
            </div>

            {moveError !== undefined && (
              <p className="panel-alert" role="alert">
                {moveError}
              </p>
            )}
          </section>

          <section className="panel-section">
            {/* Tags before description: they are what someone came here to
                change, and the description is read far more than it is edited. */}
            <TagPicker
              slug={slug}
              taskId={task.id}
              tags={task.tags}
              mayEdit={mayEdit}
              onChanged={onTagsChanged}
            />
          </section>

          <section className="panel-section">
            <h3 className="panel-section-title">Description</h3>
            {task.description_md === null || task.description_md === '' ? (
              <p className="panel-muted">No description yet.</p>
            ) : (
              // Plain text, not rendered markdown: a renderer is a dependency
              // this task may not add, and raw HTML would be an injection.
              <p className="panel-description">{task.description_md}</p>
            )}
          </section>

          <section className="panel-section">
            <h3 className="panel-section-title">Provenance</h3>
            <dl className="panel-facts">
              <div>
                <dt>Created via</dt>
                <dd>
                  <code>{task.created_via}</code>
                  {task.created_via === 'mcp' && <span className="marker marker-agent">agent</span>}
                </dd>
              </div>
              <div>
                <dt>Created by</dt>
                <dd>{personName(task.created_by, members)}</dd>
              </div>
              {discoveredFrom !== undefined && (
                <div>
                  <dt>Discovered from</dt>
                  <dd>
                    <code>{discoveredFrom.key}</code> {discoveredFrom.title}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="panel-section">
            <h3 className="panel-section-title">Blocked by</h3>
            {task.dependencies.length === 0 ? (
              <p className="panel-muted">
                Nothing. This task can start whenever someone picks it up.
              </p>
            ) : (
              <ul className="panel-deps">
                {task.dependencies.map((id) => {
                  const dep = byId.get(id);
                  if (dep === undefined) {
                    return (
                      <li key={id} className="panel-dep">
                        <span className="marker marker-unknown">not loaded</span>
                        <code>{id}</code>
                      </li>
                    );
                  }
                  const finished = dep.status === 'done' || dep.status === 'cancelled';
                  return (
                    <li key={id} className={finished ? 'panel-dep panel-dep-done' : 'panel-dep'}>
                      {/* Finished blockers must look different from open ones —
                          that difference is the only reason this list exists. */}
                      <span className={finished ? 'marker marker-ready' : 'marker marker-blocked'}>
                        {finished
                          ? 'done'
                          : (COLUMN_LABELS[dep.status as BoardColumn] ?? dep.status)}
                      </span>
                      <code>{dep.key}</code>
                      <span className="panel-dep-title">{dep.title}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {detail.status === 'loading' ? (
            <LoadingState shape="row" count={3} label="Loading comments and activity" />
          ) : detail.status === 'error' ? (
            <ApiErrorState error={detail.error} resource="this task" onRetry={detail.reload} />
          ) : (
            <>
              <section className="panel-section">
                <h3 className="panel-section-title">
                  Comments <span className="panel-count">{detail.comments.length}</span>
                </h3>

                {detail.comments.length === 0 ? (
                  <EmptyState headline="No comments yet" />
                ) : (
                  <ul className="panel-comments">
                    {detail.comments.map((comment) => (
                      <li key={comment.id} className="panel-comment">
                        <div className="panel-comment-head">
                          <span className="panel-comment-author">
                            {personName(comment.author_id, members)}
                          </span>
                          {isAgentComment(comment) && (
                            <span className="marker marker-agent">agent</span>
                          )}
                          {comment.edited_at !== null && (
                            <span className="panel-muted panel-edited">edited</span>
                          )}
                          <time
                            className="panel-time"
                            dateTime={new Date(comment.created_at).toISOString()}
                          >
                            {new Date(comment.created_at).toLocaleString()}
                          </time>
                        </div>
                        <p className="panel-comment-body">{comment.body_md}</p>
                      </li>
                    ))}
                  </ul>
                )}

                <form
                  className="panel-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = draft.trim();
                    if (body === '') return;
                    void detail.post(body).then(() => {
                      setDraft('');
                    });
                  }}
                >
                  <label className="visually-hidden" htmlFor="comment-draft">
                    Add a comment
                  </label>
                  <textarea
                    id="comment-draft"
                    className="panel-textarea"
                    rows={3}
                    value={draft}
                    disabled={detail.posting}
                    placeholder="Add a comment"
                    onChange={(event) => {
                      setDraft(event.target.value);
                    }}
                  />
                  {detail.postError !== null && (
                    <ApiErrorState error={detail.postError} resource="this comment" />
                  )}
                  <Button
                    type="submit"
                    busy={detail.posting}
                    busyLabel="Posting…"
                    disabled={draft.trim() === ''}
                  >
                    Comment
                  </Button>
                </form>
              </section>

              <section className="panel-section">
                <h3 className="panel-section-title">Activity</h3>
                {detail.activity.length === 0 ? (
                  <p className="panel-muted">Nothing recorded yet.</p>
                ) : (
                  <ol className="panel-activity">
                    {detail.activity.map((event) => {
                      const move = statusTransition(event);
                      // Not `personName`: on an activity row a null actor is the
                      // system by CHECK constraint, and "someone edited this
                      // task" reads as an unidentified human (LAI-411).
                      const actor = describeActor(event, members);
                      return (
                        <li key={event.id} className="panel-event">
                          <span className="panel-event-who">{actor.name}</span>
                          {/* The word itself, not a colour — an `agent` and a
                              `system` marker must be told apart by someone who
                              cannot separate violet from grey (AC3). */}
                          {actor.badge !== undefined && (
                            <span className={`marker marker-${actor.badge}`}>{actor.badge}</span>
                          )}
                          <span className="panel-event-what">
                            {describeEvent(event)}
                            {move !== undefined && (
                              <>
                                {' '}
                                <code>{move.from}</code> → <code>{move.to}</code>
                              </>
                            )}
                          </span>
                          <time
                            className="panel-time"
                            dateTime={new Date(event.created_at).toISOString()}
                          >
                            {new Date(event.created_at).toLocaleString()}
                          </time>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
