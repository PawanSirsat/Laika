import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { addTasksToSprint, removeTaskFromSprint, type Sprint } from '../../../api/sprints.ts';
import { copyText } from '../../../components/CopyButton.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { describeEvent, statusTransition, type ActivityEvent } from '../../../api/activity.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { isAgentComment, type Comment } from '../../../api/comments.ts';
import { useTaskDetail } from '../../../api/use-task-detail.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import { describeActor } from './actor-presentation.ts';
import {
  getTask,
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
import { TaskMarkdown } from '../task/TaskMarkdown.tsx';
import { DependenciesSection } from '../task/DependenciesSection.tsx';
import { SubtasksSection } from '../task/SubtasksSection.tsx';
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
  /**
   * The board's columns, so a status reads as the column that owns it.
   *
   * A renamed column is what people expect to see on the task (LAI-617); the
   * stored status stays the enum the API and the agent tools depend on.
   */
  readonly columns: readonly BoardColumn[];
  /** Every sprint on the project, for the panel's sprint control. */
  readonly sprints: readonly Sprint[];
  /** False for a Viewer — assigning to a sprint is member+ (§3.2). */
  readonly maySetSprint: boolean;
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
  /**
   * Open another task in this same drawer — the parent in the breadcrumb, a
   * subtask row, where this was discovered. The board's `openTaskInUrl`, so it
   * is a history entry Back undoes (LAI-252).
   */
  readonly onOpen: (taskId: string) => void;
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
  columns,
  sprints,
  maySetSprint,
  meId,
  mayAssign = false,
  mayEdit = false,
  onTagsChanged,
  onTaskEdited,
  onAssigned,
  onOpen,
}: TaskDetailPanelProps) {
  const detail = useTaskDetail(slug, task.id);

  /*
   * **The parent, from the project's set when it is in it, from the server
   * when it is not** (D-066). Since LAI-724 `byId` is the whole project's, so
   * a filter no longer hides the parent from it; only a parent past the page
   * cap does. A breadcrumb that reads *"a task outside this page"* for a task
   * that plainly exists is the wrong answer; one `GET /tasks/:id` is the right
   * one.
   */
  const parentOnPage = task.parent_task_id === null ? undefined : byId.get(task.parent_task_id);
  const [parentFetched, setParentFetched] = useState<Task | undefined>(undefined);
  useEffect(() => {
    setParentFetched(undefined);
    if (task.parent_task_id === null || parentOnPage !== undefined) return;
    const controller = new AbortController();
    getTask(task.parent_task_id, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) setParentFetched(found);
      })
      .catch(() => {
        // The breadcrumb then says the parent is outside this page.
      });
    return () => {
      controller.abort();
    };
  }, [task.parent_task_id, parentOnPage]);
  const parent = parentOnPage ?? parentFetched;

  /* Open children on this page — for the rail's "n subtasks still open". */
  const openSubtasks = [...byId.values()].filter(
    (t) => t.parent_task_id === task.id && t.status !== 'done' && t.status !== 'cancelled',
  ).length;

  const [sprintBusy, setSprintBusy] = useState(false);
  const [sprintError, setSprintError] = useState<string | undefined>(undefined);

  /*
   * **One request to move, one to clear** (LAI-619). Measured against the
   * server rather than assumed: `POST /sprints/:id/tasks` on a task that is
   * already in another sprint **reassigns** it and returns the updated task —
   * it does not refuse, and it does not need the old sprint removing first.
   * Only clearing needs the delete, because there is no sprint to post to.
   */
  const changeSprint = useCallback(
    async (sprintId: string | null): Promise<void> => {
      setSprintError(undefined);
      setSprintBusy(true);
      try {
        if (sprintId === null) {
          if (task.sprint_id !== null) await removeTaskFromSprint(task.sprint_id, task.id);
        } else {
          await addTasksToSprint(sprintId, [task.id]);
        }
        onTaskEdited();
      } catch (cause) {
        // The server's reason, not a guess — a closed sprint refuses with one.
        setSprintError(
          cause instanceof ApiError ? cause.message : 'That sprint change could not be saved.',
        );
      } finally {
        setSprintBusy(false);
      }
    },
    [task.id, task.sprint_id, onTaskEdited],
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [handoff, setHandoff] = useState<string | undefined>(undefined);
  const statusRef = useRef<HTMLButtonElement | null>(null);
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
  const named = (watchers ?? [])
    .map((id) => members.get(id)?.name)
    .filter((n): n is string => n !== undefined);

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
  const [tab, setTab] = useState<'all' | 'comments' | 'history' | 'changes'>('all');
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [acceptanceOpen, setAcceptanceOpen] = useState(true);

  /*
   * **All** is the thread and the history in one timeline, oldest first — a
   * conversation's order, with what happened between the messages. Neither
   * list is re-sorted on its own tab; this merge is the only place the two
   * meet, and it is by `created_at` with the comment first on a tie.
   */
  const everything: readonly (
    | { readonly kind: 'comment'; readonly at: number; readonly comment: Comment }
    | { readonly kind: 'event'; readonly at: number; readonly event: ActivityEvent }
  )[] =
    detail.status === 'ready'
      ? [
          ...detail.comments.map((comment) => ({
            kind: 'comment' as const,
            at: comment.created_at,
            comment,
          })),
          ...detail.activity.map((event) => ({
            kind: 'event' as const,
            at: event.created_at,
            event,
          })),
        ].sort((a, b) => a.at - b.at || (a.kind === 'comment' ? -1 : 1))
      : [];

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

  /** One comment, as the thread draws it — used by the All and Comments tabs alike. */
  const renderComment = (comment: Comment) => {
    const agent = isAgentComment(comment);
    const who = personName(comment.author_id, members);
    const ink = comment.author_id === null ? undefined : avatarColorSolid(comment.author_id, theme);
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
            The bot mark rides on the avatar, as it does on a card and a
            presence chip — one treatment for one fact, everywhere.
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
              **`Mira Kellner's agent`, not `Mira Kellner`.** An agent comment
              was written *by a tool running as* somebody; the possessive is
              the honest attribution and it is what the design writes.
            */}
            <span className="cmt-who">{agent ? `${who}'s agent` : who}</span>
            {agent && <span className="cmt-agent">AGENT</span>}
            {comment.edited_at !== null && <span className="cmt-edited">edited</span>}
            {/*
              Short and relative, beside the name — the design reads `5d ago`,
              not a timestamp to the second. The exact time stays in the `title`.
            */}
            <time
              className="cmt-when"
              dateTime={timeLabel(comment.created_at, now).iso}
              title={timeLabel(comment.created_at, now).full}
            >
              {timeLabel(comment.created_at, now).text}
            </time>
          </p>

          <CommentBody body={comment.body_md} />
        </div>
      </li>
    );
  };

  /** One activity row — the History tab's shape, reused inside All. */
  const renderEvent = (event: ActivityEvent) => {
    const move = statusTransition(event);
    // Not `personName`: on an activity row a null actor is the system by
    // CHECK constraint, and "someone edited this task" reads as an
    // unidentified human (LAI-411).
    const actor = describeActor(event, members);
    return (
      <li key={`${event.id}-${String(event.seq)}`} className="panel-event">
        <span className="panel-event-who">{actor.name}</span>
        {/* The word itself, not a colour — an `agent` and a `system` marker
            must be told apart by someone who cannot separate violet from
            grey (AC3). */}
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
        <time className="panel-time" dateTime={new Date(event.created_at).toISOString()}>
          {new Date(event.created_at).toLocaleString()}
        </time>
      </li>
    );
  };

  const composer = (
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
  );

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
          **A breadcrumb and plain icons** (D-066), as the owner's screenshot
          has it. The crumb says where this task sits — its parent's key, then
          its own — and nothing else; the status and the priority left the
          header for the rail, where they are fields a reader changes.
        */}
        <nav className="panel-crumbs" aria-label="Where this task sits">
          {task.parent_task_id !== null && (
            <>
              {parent === undefined ? (
                <span className="panel-crumb panel-crumb-quiet">a task outside this page</span>
              ) : (
                <button
                  type="button"
                  className="panel-crumb panel-crumb-parent"
                  title={parent.title}
                  onClick={() => {
                    onOpen(parent.id);
                  }}
                >
                  <span aria-hidden="true">↳</span> {parent.key}
                </button>
              )}
              <span className="panel-crumb-sep" aria-hidden="true">
                /
              </span>
            </>
          )}
          <span className="panel-key" aria-current="page">
            {task.key}
          </span>
        </nav>

        <div className="panel-head-actions">
          {/* Watch, as an eye with the count — the design's icon row. */}
          {meId !== undefined && (
            <button
              type="button"
              className={
                watching
                  ? 'panel-head-action panel-head-watch on'
                  : 'panel-head-action panel-head-watch'
              }
              aria-pressed={watching}
              aria-label={watching ? 'Unwatch' : 'Watch'}
              title={
                watchers === undefined
                  ? 'Watching'
                  : `${String(watchers.length)} watching${named.length > 0 ? `: ${named.join(', ')}` : ''}`
              }
              disabled={watchBusy}
              onClick={() => {
                void toggleWatch();
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span className="panel-head-count">{watchers?.length ?? '–'}</span>
            </button>
          )}

          <button
            type="button"
            className="panel-head-action"
            aria-label="Copy link to this task"
            title="Copy link"
            onClick={() => {
              // Through the one clipboard implementation (CopyButton's), not a
              // second call site of its own.
              void copyText(window.location.href);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="2" />
              <path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>

          <button
            type="button"
            className="panel-head-action"
            aria-expanded={overflowOpen}
            aria-label="More actions"
            onClick={() => {
              setOverflowOpen((open) => !open);
            }}
          >
            <span aria-hidden="true">⋯</span>
          </button>

          {overflowOpen && (
            <ul className="panel-overflow">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    void copyText(task.key);
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
                    void copyText(window.location.href);
                    setOverflowOpen(false);
                  }}
                >
                  Copy link to this task
                </button>
              </li>
              {mayEdit === true && task.parent_task_id !== null && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setOverflowOpen(false);
                      void updateTask(task.id, { parent_task_id: null }).then(onTaskEdited);
                    }}
                  >
                    Detach from parent
                  </button>
                </li>
              )}
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

          {/*
            The byline — provenance, tags, the two times — is gone from under
            the title (D-066): each is a field on the rail now, where Jira keeps
            them, and the document column keeps to the document.
          */}
          {moveError !== undefined && (
            <p className="panel-alert" role="alert">
              {moveError}
            </p>
          )}

          <section className="panel-section">
            <button
              type="button"
              className="panel-fold"
              aria-expanded={descriptionOpen}
              onClick={() => {
                setDescriptionOpen((open) => !open);
              }}
            >
              <span
                className={descriptionOpen ? 'meta-chevron meta-chevron-open' : 'meta-chevron'}
              />
              Description
            </button>
            {descriptionOpen && (
              /*
                Click to edit, and **rendered as markdown** when not editing
                (LAI-709). It was plain text until the owner asked. The renderer
                builds elements, never HTML, and `TaskMarkdown` says why that
                is safe for text anyone on the project writes.
              */
              <InlineEdit
                render={(source) => <TaskMarkdown source={source} />}
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
            )}
          </section>

          {/*
            **Acceptance, which nothing has ever shown.** `acceptance_md` is a
            real column and a real part of how this team writes a task — it
            gets its own section, because "what counts as done" is read at a
            different moment from the description.
          */}
          {task.acceptance_md !== null && task.acceptance_md !== '' && (
            <section className="panel-section">
              <button
                type="button"
                className="panel-fold"
                aria-expanded={acceptanceOpen}
                onClick={() => {
                  setAcceptanceOpen((open) => !open);
                }}
              >
                <span
                  className={acceptanceOpen ? 'meta-chevron meta-chevron-open' : 'meta-chevron'}
                />
                Acceptance
              </button>
              {acceptanceOpen && (
                <blockquote className="panel-acceptance">
                  <div className="panel-acceptance-body">
                    <TaskMarkdown source={task.acceptance_md} />
                  </div>
                </blockquote>
              )}
            </section>
          )}

          {/*
            Subtasks sit above the linked tasks, for a task that is not itself
            a subtask (one level, D-066).
          */}
          {task.parent_task_id === null && (
            <SubtasksSection
              slug={slug}
              task={task}
              byId={byId}
              members={members}
              theme={theme}
              mayAssign={mayAssign === true}
              meId={meId}
              columns={columns}
              mayEdit={mayEdit === true}
              onOpen={onOpen}
              onChanged={onTaskEdited}
            />
          )}

          <DependenciesSection
            task={task}
            byId={byId}
            members={members}
            theme={theme}
            mayEdit={mayEdit === true}
            onChanged={onTaskEdited}
          />

          <section className="panel-section panel-activity-section">
            <h3 className="panel-section-title">Activity</h3>
            {detail.status === 'loading' ? (
              <LoadingState shape="row" count={3} label="Loading comments and activity" />
            ) : detail.status === 'error' ? (
              <ApiErrorState error={detail.error} resource="this task" onRetry={detail.reload} />
            ) : (
              <>
                {/*
                  **Four tabs, as Jira has them.** *All* is the thread and the
                  history merged in time; *History* is the audit trail; *Changes*
                  is the commits — `webhook.commit` activity rows, which the
                  GitHub webhook writes. All three filters are over rows this
                  panel already loaded, so no tab can disagree with the one
                  beside it. The composer sits under the tabs, where Jira puts it.
                */}
                <div className="panel-tabs" role="tablist" aria-label="Task activity">
                  {(
                    [
                      ['all', 'All', everything.length],
                      ['comments', 'Comments', detail.comments.length],
                      ['history', 'History', detail.activity.length],
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

                {/*
                  **Only the showing tab is in the DOM.** A hidden tabpanel
                  still holds its rows, and the thread's comments would then
                  exist twice — once under All, once under Comments — for
                  anything that counts them.
                */}
                {(tab === 'all' || tab === 'comments') && composer}

                {tab === 'all' && (
                  <section
                    className="panel-section"
                    id="panel-all"
                    role="tabpanel"
                    aria-labelledby="tab-all"
                  >
                    {everything.length === 0 ? (
                      <p className="cmt-none">Nothing yet</p>
                    ) : (
                      <ul className="cmt-list panel-everything">
                        {everything.map((item) =>
                          item.kind === 'comment'
                            ? renderComment(item.comment)
                            : renderEvent(item.event),
                        )}
                      </ul>
                    )}
                  </section>
                )}

                {tab === 'comments' && (
                  <section
                    className="panel-section"
                    id="panel-comments"
                    role="tabpanel"
                    aria-labelledby="tab-comments"
                  >
                    {detail.comments.length === 0 ? (
                      /*
                       * **One quiet line, not a full empty state** (LAI-605).
                       * `EmptyState` is built for a screen with nothing on it,
                       * and here it sat above a composer already inviting a
                       * comment.
                       */
                      <p className="cmt-none">No comments yet</p>
                    ) : (
                      <ul className="cmt-list">{detail.comments.map(renderComment)}</ul>
                    )}
                  </section>
                )}

                {tab === 'history' && (
                  <section
                    className="panel-section"
                    id="panel-history"
                    role="tabpanel"
                    aria-labelledby="tab-history"
                  >
                    {detail.activity.length === 0 ? (
                      <p className="panel-muted">Nothing recorded yet.</p>
                    ) : (
                      <ol className="panel-activity">{detail.activity.map(renderEvent)}</ol>
                    )}
                  </section>
                )}

                {tab === 'changes' && (
                  <section
                    className="panel-section"
                    id="panel-changes"
                    role="tabpanel"
                    aria-labelledby="tab-changes"
                  >
                    {changes.length === 0 ? (
                      <p className="panel-muted">
                        No commits recorded against this task. Laika learns about them from the
                        GitHub webhook, so a space with no repo wired has none.
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
                )}
              </>
            )}
          </section>
        </div>

        {/*
          **The rail** (LAI-285, reshaped by D-066): the status control, the
          Details card, Development when there is any, and the two dates at
          the foot — so they stay in view while somebody reads the thread.
        */}
        <div className="panel-side">
          <TaskMeta
            slug={slug}
            byId={byId}
            columns={columns}
            sprints={sprints}
            maySetSprint={maySetSprint}
            sprintBusy={sprintBusy}
            sprintError={sprintError}
            onSprintChange={(sprintId) => {
              void changeSprint(sprintId);
            }}
            task={task}
            members={members}
            theme={theme}
            meId={meId}
            mayAssign={mayAssign === true}
            mayEdit={mayEdit === true}
            moving={moving}
            watchers={watchers}
            claimLock={claimLock}
            agentBuild={agentBuild}
            parent={parent}
            openSubtasks={openSubtasks}
            changesCount={changes.length}
            onMove={onMove}
            onAssigned={onAssigned}
            onTaskEdited={onTaskEdited}
            onTagsChanged={onTagsChanged}
            onOpen={onOpen}
            statusRef={statusRef}
          />

          {DEMO_HANDOFF_ENABLED && (
            <div className="panel-side-actions">
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
              {handoff !== undefined && (
                <p className="panel-alert" role="status">
                  {handoff}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
