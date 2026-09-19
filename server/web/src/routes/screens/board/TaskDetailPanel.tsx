import { useEffect, useRef, useState } from 'react';
import { TagPicker } from './TagPicker.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { describeEvent, statusTransition } from '../../../api/activity.ts';
import { updatedAge } from '../../../api/board-derive.ts';
import { isAgentComment } from '../../../api/comments.ts';
import { useTaskDetail } from '../../../api/use-task-detail.ts';
import { statusLabel } from '../../../api/board-derive.ts';
import { describeActor } from './actor-presentation.ts';
import {
  listWatchers,
  unwatchTask,
  updateTask,
  watchTask,
  type Member,
  type Task,
  type TaskStatus,
} from '../../../api/tasks.ts';
import { TaskMeta } from '../task/TaskMeta.tsx';
import { InlineEdit } from '../task/InlineEdit.tsx';
import { DependenciesSection } from '../task/DependenciesSection.tsx';
import { CommentBody } from '../task/CommentBody.tsx';
import { CommentComposer } from '../task/CommentComposer.tsx';
import {
  demoAgentBuild,
  demoClaimLock,
  DEMO_HANDOFF_ENABLED,
} from '../../../demo/agent-runtime.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { avatarColorSolid } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import '../task/task-panel.css';
import '../../../components/markers.css';
import './task-detail.css';

export interface TaskDetailPanelProps {
  readonly slug: string;
  readonly task: Task;
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly moving: boolean;
  readonly moveError: string | undefined;
  /** The same call the board uses — not a second implementation (LAI-056). */
  readonly onMove: (taskId: string, to: TaskStatus) => void;
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
  /**
   * Re-read after an edit — title, description, priority, a dependency.
   *
   * The same call `onAssigned` makes; named separately because a reader of the
   * call site should see *why* the board is being reloaded, and "something on
   * the task changed" and "the assignee changed" are different reasons even
   * when the remedy is the same.
   */
  readonly onTaskEdited: () => void;
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
  onTaskEdited,
  onAssigned,
}: TaskDetailPanelProps) {
  const detail = useTaskDetail(slug, task.id);
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [handoff, setHandoff] = useState<string | undefined>(undefined);
  const statusRef = useRef<HTMLSelectElement | null>(null);
  const { theme } = useTheme();
  const now = Date.now();
  /*
   * The claim's deadline and the agent's build are the only things on this
   * panel Laika cannot answer — see `demo/agent-runtime.ts`. Both are
   * `undefined` in a production build, and every reader below treats that as
   * "no such thing" rather than "not loaded yet".
   */
  const claimLock = demoClaimLock(task, now);

  /**
   * Who is watching, read once and used twice — the header's Watch button and
   * the rail's list. Two independent reads would let the button and the list
   * disagree about whether *you* are on it.
   */
  const [watchers, setWatchers] = useState<readonly string[] | undefined>(undefined);
  const [watchBusy, setWatchBusy] = useState(false);
  const watching = meId !== undefined && watchers?.includes(meId) === true;

  useEffect(() => {
    const controller = new AbortController();
    listWatchers(task.id, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setWatchers(list.watchers);
      })
      .catch(() => {
        // The rail says it could not read rather than claiming nobody watches.
      });
    return () => {
      controller.abort();
    };
  }, [task.id]);

  const toggleWatch = async (): Promise<void> => {
    setWatchBusy(true);
    try {
      await (watching ? unwatchTask(task.id) : watchTask(task.id));
      /*
       * Re-read rather than patch locally. Watching is **implicit as well as
       * explicit** — commenting makes you a watcher — so the server's list is
       * not always ours plus or minus one.
       */
      const list = await listWatchers(task.id);
      setWatchers(list.watchers);
    } catch {
      // The button returns to its previous label; nothing claims to have changed.
    } finally {
      setWatchBusy(false);
    }
  };
  /*
   * **Changes are commits**, filtered out of the activity this panel already
   * loaded — `webhook.commit` is written by the GitHub webhook (§10.1). A
   * second request for the same rows would be a second answer to one question.
   */
  const changes =
    detail.status === 'ready'
      ? detail.activity.filter((event) => event.type.startsWith('webhook.'))
      : [];
  const agentBuild = demoAgentBuild(task.created_by_client, task.id);
  /**
   * Which tab is showing.
   *
   * Local, not in the URL: a tab is a way of looking at the task already
   * identified by `?task=`, and putting it in the address bar would make Back
   * step through tab switches before it closed the drawer — which is the one
   * thing Back has to do here (LAI-252).
   */
  const [tab, setTab] = useState<'comments' | 'activity' | 'changes'>('comments');

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

  /*
   * Escape and the scrim belong to `TaskDrawer` since LAI-252 — the chrome
   * owns dismissal, this owns the task. The `×` in the header stays here
   * because the design draws it beside the key.
   */

  return (
    <div
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-label={`${task.key} — ${task.title}`}
      tabIndex={-1}
      ref={panelRef}
    >
      <header className="panel-head">
        {/*
          **Key, state, priority — and no title** (LAI-285). The design's header
          is a status bar: it says *which task and what state* at a glance, and
          the title belongs in the document below, where it can be as long as it
          needs to be without pushing the actions off the row.
        */}
        <div className="panel-head-main">
          <span className="panel-key">{task.key}</span>
          <span className={`panel-state panel-state-${task.status}`}>
            <span className="panel-state-dot" aria-hidden="true" />
            {statusLabel(task.status)}
          </span>
          <span className={`panel-prio panel-prio-${task.priority}`}>
            <span className="panel-prio-dot" aria-hidden="true" />
            {task.priority.toUpperCase()}
          </span>
        </div>

        <div className="panel-head-actions">
          {/*
            The design's top-bar actions. `Move` focuses the status control
            rather than opening a second one: two ways to move a task is two
            places for the transition rules to be got wrong.
          */}
          {mayEdit === true && (
            <button
              type="button"
              className="panel-head-action"
              onClick={() => {
                statusRef.current?.focus();
              }}
            >
              <span aria-hidden="true">+</span> Move
            </button>
          )}

          {/* Watch is a header action in the design, beside Move — it is a
              thing you do to the task, not a field describing it. */}
          {meId !== undefined && (
            <button
              type="button"
              className="panel-head-action"
              disabled={watchBusy}
              onClick={() => {
                void toggleWatch();
              }}
            >
              {watching ? 'Unwatch' : 'Watch'}
            </button>
          )}

          <button
            type="button"
            className="panel-head-action"
            aria-expanded={overflowOpen}
            onClick={() => {
              setOverflowOpen((open) => !open);
            }}
          >
            <span aria-hidden="true">⋯</span>
            <span className="visually-hidden">More actions</span>
          </button>

          {overflowOpen && (
            <ul className="panel-overflow">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(task.key);
                    setOverflowOpen(false);
                  }}
                >
                  Copy task key
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(window.location.href);
                    setOverflowOpen(false);
                  }}
                >
                  Copy link to this task
                </button>
              </li>
            </ul>
          )}

          <button type="button" className="panel-close" onClick={onClose}>
            <span className="visually-hidden">Close</span>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      <div className="panel-columns">
        <div className="panel-main">
          {/*
            The title as a heading, click to edit — the design writes it as text
            you type into rather than a field.
          */}
          <h2 className="panel-title">
            <InlineEdit
              value={task.title}
              placeholder="Untitled task"
              shape="line"
              label="Task title"
              mayEdit={mayEdit === true}
              onSave={async (next) => {
                await updateTask(task.id, { title: next });
                onTaskEdited();
              }}
            />
          </h2>

          {/* The design's line under the title: where it came from, its tags,
              and when it was opened and last touched. */}
          <div className="panel-byline">
            <span className="panel-via">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect
                  x="4"
                  y="8"
                  width="16"
                  height="12"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="2.2"
                />
                <path d="M12 4v4" stroke="currentColor" strokeWidth="2.2" />
              </svg>
              {task.created_by_client === null
                ? `created via ${task.created_via}`
                : `created via agent · ${task.created_by_client}`}
            </span>
            <span className="panel-byline-times">
              opened {updatedAge(task.created_at, now)} ago · updated{' '}
              {updatedAge(task.updated_at, now)} ago
            </span>
          </div>

          {/*
            **The tag editor stays.** The design draws tags as chips in this
            line and offers no way to change them, because a mockup has nothing
            to change; keeping the picker is the owner's explicit ask, and it
            renders the same chips with a way in.
          */}
          <TagPicker
            slug={slug}
            taskId={task.id}
            tags={task.tags}
            mayEdit={mayEdit}
            onChanged={onTagsChanged}
          />

          {/*
            Status, priority, the assignee and the claim line all moved to the
            meta rail on the right (LAI-285) — the design puts *fields* there and
            keeps this column for the task as a document.
          */}
          {moveError !== undefined && (
            <p className="panel-alert" role="alert">
              {moveError}
            </p>
          )}

          <section className="panel-section">
            <h3 className="panel-section-title">Description</h3>
            {/*
            Click to edit. Still **plain text, not rendered markdown**: a
            renderer is a dependency this task may not add and raw HTML would be
            an injection — the fenced-code handling in a comment is deliberately
            the one exception and is a parser of one construct, not a renderer.
          */}
            <InlineEdit
              value={task.description_md ?? ''}
              placeholder="No description yet. Click to write one."
              shape="block"
              label="Description"
              mayEdit={mayEdit === true}
              onSave={async (next) => {
                await updateTask(task.id, { description_md: next });
                onTaskEdited();
              }}
            />
          </section>

          {/*
            **Acceptance, which nothing has ever shown.** `acceptance_md` is a
            real column and a real part of how this team writes a task — the
            design gives it its own quoted block, because "what counts as done"
            is read at a different moment from the description.
          */}
          {task.acceptance_md !== null && task.acceptance_md !== '' && (
            <blockquote className="panel-acceptance">
              <p className="panel-acceptance-label">Acceptance</p>
              <p className="panel-acceptance-body">{task.acceptance_md}</p>
            </blockquote>
          )}

          {/*
          **Discovered from** — the callout the design draws with a dashed
          border. `discovered_from` is a real field: it is how a task filed
          mid-work points back at the one that turned it up, and nothing in the
          UI has ever shown it.
        */}
          {task.discovered_from !== null && (
            <section className="panel-section">
              <div className="discovered">
                <p className="discovered-label">Discovered from</p>
                {(() => {
                  const source = byId.get(task.discovered_from ?? '');
                  return source === undefined ? (
                    // An id is not a key; the trail is real either way.
                    <p className="discovered-body">
                      A task outside this page. Its id is recorded on this one.
                    </p>
                  ) : (
                    <p className="discovered-body">
                      <span className="discovered-key">{source.key}</span> {source.title}
                      <span className="discovered-note">
                        {' '}
                        — filed while working on it, by {personName(task.created_by, members)}
                      </span>
                    </p>
                  );
                })()}
              </div>
            </section>
          )}

          <DependenciesSection
            task={task}
            byId={byId}
            members={members}
            theme={theme}
            mayEdit={mayEdit === true}
            onChanged={onTaskEdited}
          />

          {/*
            Watchers and provenance are fields, so they live on the meta rail
            too (LAI-285). What stays in this column is the task itself: title,
            description, acceptance, what it waits on, and the conversation.
          */}

          {detail.status === 'loading' ? (
            <LoadingState shape="row" count={3} label="Loading comments and activity" />
          ) : detail.status === 'error' ? (
            <ApiErrorState error={detail.error} resource="this task" onRetry={detail.reload} />
          ) : (
            <>
              {/*
              **Three tabs, as the design has it.** `Changes` is the commits
              this task's work produced — `webhook.commit` activity rows, which
              the GitHub webhook writes. It is a filter over activity rather
              than a second request, so it cannot disagree with the tab beside
              it, and it is empty rather than absent when no repo is wired.
            */}
              <div className="panel-tabs" role="tablist" aria-label="Task detail">
                {(
                  [
                    ['comments', 'Comments', detail.comments.length],
                    ['activity', 'Activity', detail.activity.length],
                    ['changes', 'Changes', changes.length],
                  ] as const
                ).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={`panel-${id}`}
                    className={tab === id ? 'panel-tab panel-tab-on' : 'panel-tab'}
                    onClick={() => {
                      setTab(id);
                    }}
                  >
                    {label} <span className="panel-tab-count">{count}</span>
                  </button>
                ))}
              </div>

              <section
                className="panel-section"
                id="panel-comments"
                role="tabpanel"
                aria-labelledby="tab-comments"
                hidden={tab !== 'comments'}
              >
                {detail.comments.length === 0 ? (
                  /*
                   * **One quiet line, not a full empty state** (LAI-605).
                   *
                   * `EmptyState` is built for a screen with nothing on it — an
                   * icon, a headline and room around both. Here it sat above a
                   * composer that is already inviting a comment, so an
                   * *absence* took more of the panel than several comments
                   * would, and pushed the composer below the fold.
                   */
                  <p className="cmt-none">No comments yet</p>
                ) : (
                  <ul className="cmt-list">
                    {detail.comments.map((comment) => {
                      const agent = isAgentComment(comment);
                      const who = personName(comment.author_id, members);
                      const ink =
                        comment.author_id === null
                          ? undefined
                          : avatarColorSolid(comment.author_id, theme);
                      return (
                        <li key={comment.id} className="cmt">
                          <span
                            className="cmt-avatar"
                            aria-hidden="true"
                            {...(ink === undefined
                              ? {}
                              : { style: { background: ink.background, color: ink.foreground } })}
                          >
                            {initials(who)}
                            {/*
                              The bot mark rides on the avatar, as it does on a
                              card and a presence chip — one treatment for one
                              fact, everywhere.
                            */}
                            {agent && (
                              <span className="cmt-bot" aria-hidden="true">
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
                                  <rect
                                    x="4"
                                    y="8"
                                    width="16"
                                    height="12"
                                    rx="3"
                                    stroke="var(--on-accent)"
                                    strokeWidth="3"
                                  />
                                  <path d="M12 4v4" stroke="var(--on-accent)" strokeWidth="3" />
                                </svg>
                              </span>
                            )}
                          </span>

                          <div className="cmt-body">
                            <p className="cmt-head">
                              {/*
                                **`Mira Kellner's agent`, not `Mira Kellner`.**
                                An agent comment was written *by a tool running
                                as* somebody; the possessive is the honest
                                attribution and it is what the design writes.
                              */}
                              <span className="cmt-who">{agent ? `${who}'s agent` : who}</span>
                              {agent && <span className="cmt-agent">AGENT</span>}
                              {comment.edited_at !== null && (
                                <span className="cmt-edited">edited</span>
                              )}
                              {/*
                                Short and relative, beside the name — the design
                                reads `5d ago`, not a timestamp to the second.
                                The exact time stays in the `title`.
                              */}
                              <time
                                className="cmt-when"
                                dateTime={new Date(comment.created_at).toISOString()}
                                title={new Date(comment.created_at).toLocaleString()}
                              >
                                {updatedAge(comment.created_at, now)} ago
                              </time>
                            </p>

                            <CommentBody body={comment.body_md} />
                          </div>
                        </li>
                      );
                    })}
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
                  {meId !== undefined && (
                    <span
                      className="cmt-avatar cmt-avatar-me"
                      aria-hidden="true"
                      style={{
                        background: avatarColorSolid(meId, theme).background,
                        color: avatarColorSolid(meId, theme).foreground,
                      }}
                    >
                      {initials(personName(meId, members))}
                    </span>
                  )}

                  <CommentComposer
                    slug={slug}
                    value={draft}
                    busy={detail.posting}
                    onChange={setDraft}
                    onSubmit={() => {
                      const body = draft.trim();
                      if (body === '') return;
                      void detail.post(body).then(() => {
                        setDraft('');
                      });
                    }}
                    send={
                      <Button type="submit" busy={detail.posting} disabled={draft.trim() === ''}>
                        Comment
                      </Button>
                    }
                  />
                  {detail.postError !== null && (
                    <ApiErrorState error={detail.postError} resource="this comment" />
                  )}
                </form>
              </section>

              <section
                className="panel-section"
                id="panel-activity"
                role="tabpanel"
                aria-labelledby="tab-activity"
                hidden={tab !== 'activity'}
              >
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

              <section
                className="panel-section"
                id="panel-changes"
                role="tabpanel"
                aria-labelledby="tab-changes"
                hidden={tab !== 'changes'}
              >
                {changes.length === 0 ? (
                  <p className="panel-muted">
                    No commits recorded against this task. Laika learns about them from the GitHub
                    webhook, so a space with no repo wired has none.
                  </p>
                ) : (
                  <ol className="panel-changes">
                    {changes.map((event) => (
                      <li key={`${event.id}-${String(event.seq)}`} className="panel-change">
                        <span className="panel-change-who">
                          {describeActor(event, members).name}
                        </span>
                        <span className="panel-change-what">{describeEvent(event)}</span>
                        <time
                          className="panel-time"
                          dateTime={new Date(event.created_at).toISOString()}
                        >
                          {new Date(event.created_at).toLocaleString()}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>

        {/*
          **The meta rail** (LAI-285): the fields, then the two actions and the
          sentence saying who may use them. The design puts the buttons at the
          foot of *this* column rather than under the comments, so they stay in
          view while somebody reads the thread.
        */}
        <div className="panel-side">
          <TaskMeta
            task={task}
            members={members}
            theme={theme}
            spaceName={slug}
            meId={meId}
            mayAssign={mayAssign === true}
            mayEdit={mayEdit === true}
            moving={moving}
            watchers={watchers}
            claimLock={claimLock}
            agentBuild={agentBuild}
            onMove={onMove}
            onAssigned={onAssigned}
            onTaskEdited={onTaskEdited}
            statusRef={statusRef}
          />

          <div className="panel-side-actions">
            {DEMO_HANDOFF_ENABLED && (
              <button
                type="button"
                className="panel-action panel-action-primary"
                onClick={() => {
                  /*
                    The refusal lives here, not in `demo/`: it is the screen's
                    own explanation, and a sentence in that directory reaches
                    the production bundle — `DEMO_ENABLED` is a runtime value,
                    so the minifier keeps the text even when the behaviour is
                    gone.
                  */
                  setHandoff(
                    'Laika has no endpoint that hands a task to a runtime yet, so nothing was queued. This button is part of the imported design.',
                  );
                }}
              >
                <span aria-hidden="true">▷</span> Hand to my agent
              </button>
            )}

            {mayEdit === true && task.status !== 'review' && task.status !== 'done' && (
              <button
                type="button"
                className="panel-action"
                disabled={moving}
                onClick={() => {
                  onMove(task.id, 'review');
                }}
              >
                Move to Review
              </button>
            )}

            {handoff !== undefined && (
              <p className="panel-alert" role="status">
                {handoff}
              </p>
            )}

            <p className="panel-permission">
              Members can move and comment. Viewers see this panel read-only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
