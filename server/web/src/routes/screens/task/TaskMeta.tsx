import { useState } from 'react';
import { AssignControl } from '../board/AssignControl.tsx';
import { TagPicker } from '../board/TagPicker.tsx';
import { ALL_STATUSES, boardStatusLabel } from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import { dateInputToMs, dateLabel, isOverdue, msToDateInput } from '../../../api/date-only.ts';
import type { Sprint } from '../../../api/sprints.ts';
import { timeLabel } from '../../../api/time-label.ts';
import {
  updateTask,
  PRIORITIES,
  type Member,
  type Task,
  type TaskStatus,
} from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import type { DemoAgentBuild, DemoClaimLock } from '../../../demo/agent-runtime.ts';
import './task-panel.css';

export interface TaskMetaProps {
  readonly slug: string;
  readonly task: Task;
  /** Everything loaded, for naming the parent and offering one. */
  readonly byId: ReadonlyMap<string, Task>;
  /** The board's columns — a renamed column names the status here too. */
  readonly columns: readonly BoardColumn[];
  /** Every sprint on the project, for the sprint control. */
  readonly sprints: readonly Sprint[];
  /** False for a Viewer — assigning to a sprint is member+ (§3.2). */
  readonly maySetSprint: boolean;
  /** `null` clears the sprint. */
  readonly onSprintChange: (sprintId: string | null) => void;
  /** A sprint change is in flight. */
  readonly sprintBusy: boolean;
  /** The server's reason the last sprint change failed. */
  readonly sprintError: string | undefined;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly meId: string | undefined;
  readonly mayAssign: boolean;
  readonly mayEdit: boolean;
  readonly moving: boolean;
  /** Real: who is watching. */
  readonly watchers: readonly string[] | undefined;
  readonly claimLock: DemoClaimLock | undefined;
  readonly agentBuild: DemoAgentBuild | undefined;
  /** The parent, resolved by the panel (it may be outside `byId`). */
  readonly parent: Task | undefined;
  /** How many of this task's subtasks are still open — for the warning under a `done` status. */
  readonly openSubtasks: number;
  /** Commits recorded against the task — the Changes tab's count, for the Development card. */
  readonly changesCount: number;
  readonly onMove: (taskId: string, to: TaskStatus) => void;
  readonly onAssigned: () => void;
  readonly onTaskEdited: () => void;
  readonly onTagsChanged: (tags: readonly string[]) => void;
  /** Open another task in this drawer — the parent, or where this was discovered. */
  readonly onOpen: (taskId: string) => void;
  readonly statusRef: React.RefObject<HTMLSelectElement | null>;
}

/** `4m`, `6d` — the design's short form beside a field. */
function since(at: number | null, now: number): string | undefined {
  if (at === null) return undefined;
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

/** Remember whether a rail card is open, per viewer; a blocked store means "open". */
function readOpen(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(`laika.panel.${key}`);
    return stored === null ? fallback : stored === 'open';
  } catch {
    return fallback;
  }
}

function writeOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(`laika.panel.${key}`, open ? 'open' : 'closed');
  } catch {
    // A viewer convenience only; nothing depends on it.
  }
}

/**
 * The drawer's right-hand rail, laid out as Jira lays out an issue (D-066).
 *
 * **The status is a button at the top, not a row** — it is the one thing a
 * reader changes most, and Jira's coloured control is what the owner pointed
 * at. Under it, a **Details** card of fields, in the owner's order: assignee,
 * priority, parent, due date, labels, sprint, start date, reporter, then what
 * we have that Jira does not draw. A **Development** card when the task has a
 * branch, a PR or commits. The foot says when it was created and updated, in
 * full, the way the screenshot does.
 *
 * Everything LAI-285 put here is still here; what moved is the tag picker
 * (from the title's byline) and the *discovered from* callout (from the main
 * column), both of which are fields rather than parts of the document.
 */
export function TaskMeta({
  slug,
  task,
  byId,
  columns,
  sprints,
  maySetSprint,
  onSprintChange,
  sprintBusy,
  sprintError,
  members,
  theme,
  meId,
  mayAssign,
  mayEdit,
  moving,
  watchers,
  claimLock,
  agentBuild,
  parent,
  openSubtasks,
  changesCount,
  onMove,
  onAssigned,
  onTaskEdited,
  onTagsChanged,
  onOpen,
  statusRef,
}: TaskMetaProps) {
  const now = Date.now();
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const ink = task.assignee_id === null ? undefined : avatarColor(task.assignee_id, theme);
  const reporter = members.get(task.created_by);
  const reporterInk = avatarColor(task.created_by, theme);

  const [detailsOpen, setDetailsOpen] = useState(() => readOpen('details', true));
  const [devOpen, setDevOpen] = useState(() => readOpen('development', false));
  const [error, setError] = useState<string | undefined>(undefined);

  const named = (watchers ?? [])
    .map((id) => members.get(id)?.name)
    .filter((n): n is string => n !== undefined);
  const viewers = (watchers ?? [])
    .map((id) => members.get(id))
    .filter((m) => m?.role === 'viewer')
    .map((m) => m?.name)
    .filter((n): n is string => n !== undefined);

  /** A field edit, with the server's reason shown when it refuses. */
  const edit = async (patch: Parameters<typeof updateTask>[1]): Promise<void> => {
    setError(undefined);
    try {
      await updateTask(task.id, patch);
      onTaskEdited();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that. Try again.');
    }
  };

  /*
   * One level (D-066): a task that has subtasks cannot be given a parent, so
   * the row is absent rather than offering a picker the server refuses.
   */
  const hasChildren = [...byId.values()].some((t) => t.parent_task_id === task.id);
  const parentCandidates = [...byId.values()]
    .filter((t) => t.id !== task.id && t.parent_task_id === null)
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .sort((a, b) => a.number - b.number);

  const discovered = task.discovered_from === null ? undefined : byId.get(task.discovered_from);
  const hasDevelopment = task.branch !== null || task.external_ref !== null || changesCount > 0;
  const externalIsUrl = task.external_ref !== null && /^https?:\/\//.test(task.external_ref);

  return (
    <aside className="panel-meta" aria-label="Task details">
      {/* The status, as Jira's coloured control: the field a reader changes most. */}
      <div className="meta-status-row">
        <label className={`meta-status meta-status-${task.status}`}>
          <span className="visually-hidden">Status</span>
          <select
            ref={statusRef}
            value={task.status}
            disabled={moving || !mayEdit}
            onChange={(event) => {
              const to = event.target.value as TaskStatus;
              if (to !== task.status) onMove(task.id, to);
            }}
          >
            {/*
              **All six, `cancelled` included** (LAI-266). The board never
              resolves a drop to `cancelled` — a mis-drag must not cancel
              somebody's work — so this control is the only way to reach it.
            */}
            {ALL_STATUSES.map((c) => (
              <option key={c} value={c}>
                {boardStatusLabel(c, columns)}
              </option>
            ))}
          </select>
          <span className="meta-status-caret" aria-hidden="true" />
        </label>
        {mayEdit && task.status !== 'review' && task.status !== 'done' && (
          <button
            type="button"
            className="meta-review"
            disabled={moving}
            onClick={() => {
              onMove(task.id, 'review');
            }}
          >
            Move to Review
          </button>
        )}
      </div>
      {/* `started_at` is when it was claimed — the design's second line. */}
      {since(task.started_at, now) !== undefined && (
        <p className="meta-sub meta-status-sub">claimed {since(task.started_at, now)}</p>
      )}
      {/*
        **No coupling, but a sentence** (D-066). A parent may be closed with
        open subtasks — Jira's default — and the rail says so rather than
        refusing or quietly carrying on.
      */}
      {task.status === 'done' && openSubtasks > 0 && (
        <p className="meta-warn" role="status">
          {openSubtasks} {openSubtasks === 1 ? 'subtask is' : 'subtasks are'} still open
        </p>
      )}

      <section className="meta-card">
        <button
          type="button"
          className="meta-card-head"
          aria-expanded={detailsOpen}
          onClick={() => {
            setDetailsOpen((open) => {
              writeOpen('details', !open);
              return !open;
            });
          }}
        >
          <span className={detailsOpen ? 'meta-chevron meta-chevron-open' : 'meta-chevron'} />
          Details
        </button>

        {detailsOpen && (
          <div className="meta-rows">
            <div className="meta-row">
              <p className="meta-label">Assignee</p>
              <div className="meta-value meta-person">
                <span
                  className={
                    assignee === undefined ? 'meta-avatar meta-avatar-empty' : 'meta-avatar'
                  }
                  aria-hidden="true"
                  {...(ink === undefined
                    ? {}
                    : { style: { background: ink.background, color: ink.foreground } })}
                >
                  {assignee === undefined ? '—' : initials(assignee.name)}
                  {/* The bot mark the design puts on an agent-held avatar. */}
                  {claimLock !== undefined && (
                    <span className="meta-avatar-bot" aria-hidden="true" />
                  )}
                </span>
                <AssignControl
                  task={task}
                  members={members}
                  meId={meId}
                  mayAssign={mayAssign}
                  onChanged={onAssigned}
                />
              </div>
              {/*
                **The claim's deadline is invented and the line says so.** The
                claim itself is real — `POST /tasks/:id/claim` is a
                compare-and-swap — but it has no TTL, so an hour here comes
                from `demo/agent-runtime.ts` and cannot reach a production build.
              */}
              {claimLock !== undefined && (
                <p className="meta-sub meta-sub-claim">
                  agent has the claim lock until {claimLock.label}
                  <span className="meta-placeholder">placeholder</span>
                </p>
              )}
            </div>

            <div className="meta-row">
              <p className="meta-label">Priority</p>
              <div className="meta-value">
                <label className={`meta-select meta-prio meta-prio-${task.priority}`}>
                  <span className="visually-hidden">Priority</span>
                  <select
                    value={task.priority}
                    disabled={!mayEdit}
                    onChange={(event) => {
                      void edit({ priority: event.target.value as (typeof PRIORITIES)[number] });
                    }}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {!hasChildren && (
              <ParentRow
                task={task}
                parent={parent}
                candidates={parentCandidates}
                mayEdit={mayEdit}
                onOpen={onOpen}
                onChange={(parentId) => edit({ parent_task_id: parentId })}
              />
            )}

            <DateRow
              id="due"
              label="Due date"
              value={task.due_on}
              overdue={isOverdue(task, now)}
              mayEdit={mayEdit}
              onChange={(ms) => edit({ due_on: ms })}
            />

            <div className="meta-row">
              <p className="meta-label">Labels</p>
              <div className="meta-value meta-tags">
                {/*
                  **The tag editor stays.** It renders the same chips the
                  design draws and offers a way in; it sits here because a
                  label is a field, which is what this card is for.
                */}
                <TagPicker
                  slug={slug}
                  taskId={task.id}
                  tags={task.tags}
                  mayEdit={mayEdit}
                  onChanged={onTagsChanged}
                />
              </div>
            </div>

            <div className="meta-row">
              <p className="meta-label">Sprint</p>
              <div className="meta-value">
                <label className="meta-select">
                  <span className="visually-hidden">Sprint</span>
                  <select
                    value={task.sprint_id ?? ''}
                    disabled={sprintBusy || !maySetSprint}
                    onChange={(event) => {
                      const to = event.target.value === '' ? null : event.target.value;
                      if (to !== (task.sprint_id ?? null)) onSprintChange(to);
                    }}
                  >
                    {/*
                      **`No sprint` is a real option, not an absence** (LAI-619).
                      Backlog work genuinely belongs to no sprint, and without
                      this the only way out of one was the Sprints screen.
                    */}
                    <option value="">No sprint</option>
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {sprintError !== undefined && (
                <p className="meta-sub" role="alert">
                  {sprintError}
                </p>
              )}
            </div>

            <DateRow
              id="start"
              label="Start date"
              value={task.planned_start}
              overdue={false}
              mayEdit={mayEdit}
              onChange={(ms) => edit({ planned_start: ms })}
            />

            <div className="meta-row">
              <p className="meta-label">Reporter</p>
              <div className="meta-value meta-person">
                <span
                  className="meta-avatar"
                  aria-hidden="true"
                  style={{ background: reporterInk.background, color: reporterInk.foreground }}
                >
                  {initials(reporter?.name ?? '?')}
                </span>
                {/* `created_by`, which is what Jira's Reporter is: who filed it. */}
                <span className="meta-reporter">
                  {reporter?.name ?? 'Someone no longer on this project'}
                </span>
              </div>
            </div>

            <div className="meta-row">
              <p className="meta-label">Created via</p>
              <p className="meta-value meta-plain">
                {task.created_by_client === null
                  ? task.created_via
                  : `Agent · ${task.created_by_client}`}
                {agentBuild !== undefined && ` ${agentBuild.version}`}
              </p>
              {agentBuild !== undefined && (
                <p className="meta-sub meta-mono">
                  scope {agentBuild.scope}
                  <span className="meta-placeholder">placeholder</span>
                </p>
              )}
            </div>

            <div className="meta-row">
              <p className="meta-label">Watchers</p>
              {watchers === undefined ? (
                <p className="meta-value meta-plain meta-quiet">Could not read who is watching.</p>
              ) : watchers.length === 0 ? (
                <p className="meta-value meta-plain meta-quiet">Nobody yet.</p>
              ) : (
                <>
                  <p className="meta-value meta-plain">
                    {/* Named where we can; a watcher this page cannot name is
                        still counted, because the count is the server's. */}
                    {named.join(', ')}
                    {named.length < watchers.length && `${named.length > 0 ? ', ' : ''}and others`}
                  </p>
                  <p className="meta-sub">
                    {watchers.length} {watchers.length === 1 ? 'person' : 'people'}
                    {viewers.length > 0 &&
                      ` · ${viewers.join(', ')} ${viewers.length === 1 ? 'is a Viewer' : 'are Viewers'}`}
                  </p>
                </>
              )}
            </div>

            {task.discovered_from !== null && (
              <div className="meta-row">
                <p className="meta-label">Discovered from</p>
                {discovered === undefined ? (
                  // An id is not a key; the trail is real either way.
                  <p className="meta-value meta-plain meta-quiet">A task outside this page.</p>
                ) : (
                  <p className="meta-value meta-plain">
                    <button
                      type="button"
                      className="meta-task-link"
                      onClick={() => {
                        onOpen(discovered.id);
                      }}
                    >
                      <span className="meta-task-key">{discovered.key}</span> {discovered.title}
                    </button>
                  </p>
                )}
              </div>
            )}

            {error !== undefined && (
              <p className="panel-alert meta-alert" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </section>

      {/*
        **Development, only when there is any** (LAI-286 folded in). The branch
        the plugin reported, the PR when one is recorded, and the commits the
        webhook wrote — the three facts Jira's card carries that we hold too.
      */}
      {hasDevelopment && (
        <section className="meta-card">
          <button
            type="button"
            className="meta-card-head"
            aria-expanded={devOpen}
            onClick={() => {
              setDevOpen((open) => {
                writeOpen('development', !open);
                return !open;
              });
            }}
          >
            <span className={devOpen ? 'meta-chevron meta-chevron-open' : 'meta-chevron'} />
            Development
            <span className="meta-card-note">
              {changesCount} {changesCount === 1 ? 'commit' : 'commits'}
            </span>
          </button>
          {devOpen && (
            <div className="meta-rows">
              {task.branch !== null && (
                <div className="meta-row">
                  <p className="meta-label">Branch</p>
                  <p className="meta-value meta-plain meta-mono">{task.branch}</p>
                </div>
              )}
              {task.external_ref !== null && (
                <div className="meta-row">
                  {/* "PR", not the longer word: `endpoint-coverage` reads that word followed by `<` as a client call site. */}
                  <p className="meta-label">PR</p>
                  <p className="meta-value meta-plain">
                    {externalIsUrl ? (
                      <a href={task.external_ref} target="_blank" rel="noreferrer">
                        {task.external_ref}
                      </a>
                    ) : (
                      task.external_ref
                    )}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <div className="panel-side-foot">
        {/* In full, as the screenshot has it; the relative form lives on the List. */}
        <p className="panel-foot-times">
          Created{' '}
          <time dateTime={timeLabel(task.created_at, now).iso}>
            {timeLabel(task.created_at, now).full}
          </time>
          <br />
          Updated{' '}
          <time dateTime={timeLabel(task.updated_at, now).iso}>
            {timeLabel(task.updated_at, now).full}
          </time>
        </p>
        <p className="panel-permission">
          Members can move and comment. Viewers see this panel read-only.
        </p>
      </div>
    </aside>
  );
}

interface ParentRowProps {
  readonly task: Task;
  readonly parent: Task | undefined;
  readonly candidates: readonly Task[];
  readonly mayEdit: boolean;
  readonly onOpen: (taskId: string) => void;
  readonly onChange: (parentId: string | null) => Promise<void>;
}

/**
 * The parent field (D-066): the task this is a subtask of, as `KEY · title`
 * that opens it, with `×` to detach; or *Add parent*, which offers the
 * top-level open tasks on this page. One level only, so the picker never
 * lists a task that is itself a subtask.
 */
function ParentRow({ task, parent, candidates, mayEdit, onOpen, onChange }: ParentRowProps) {
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (parentId: string | null): Promise<void> => {
    setBusy(true);
    try {
      await onChange(parentId);
      setPicking(false);
      setPicked('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="meta-row meta-row-parent">
      <p className="meta-label">Parent</p>
      {task.parent_task_id !== null ? (
        <div className="meta-value meta-parent">
          {parent === undefined ? (
            <span className="meta-quiet">A task outside this page.</span>
          ) : (
            <button
              type="button"
              className="meta-task-link"
              title={parent.title}
              onClick={() => {
                onOpen(parent.id);
              }}
            >
              <span className="meta-task-key">{parent.key}</span> {parent.title}
            </button>
          )}
          {mayEdit && (
            <button
              type="button"
              className="dep-remove"
              disabled={busy}
              aria-label="Detach from parent"
              onClick={() => {
                void run(null);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      ) : !mayEdit ? (
        <p className="meta-value meta-plain meta-quiet">None</p>
      ) : picking ? (
        <div className="meta-value dep-add meta-add">
          <label className="visually-hidden" htmlFor="parent-pick">
            Parent task
          </label>
          <select
            id="parent-pick"
            value={picked}
            disabled={busy}
            onChange={(event) => {
              setPicked(event.target.value);
            }}
          >
            <option value="">Choose a task…</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.key} — {t.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="dep-confirm"
            disabled={busy || picked === ''}
            onClick={() => {
              void run(picked);
            }}
          >
            Set
          </button>
          <button
            type="button"
            className="dep-cancel"
            disabled={busy}
            onClick={() => {
              setPicking(false);
              setPicked('');
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <p className="meta-value meta-plain">
          <button
            type="button"
            className="meta-add-link"
            onClick={() => {
              setPicking(true);
            }}
          >
            Add parent
          </button>
        </p>
      )}
    </div>
  );
}

interface DateRowProps {
  readonly id: string;
  readonly label: string;
  /** unix-ms at a UTC midnight, or null. */
  readonly value: number | null;
  readonly overdue: boolean;
  readonly mayEdit: boolean;
  readonly onChange: (ms: number | null) => Promise<void>;
}

/**
 * A date field: the short form (`12 Jul 2026`) as a chip — red with a warning
 * mark when it is past and the task is still open — or *Add date*; click to
 * get a date input, with `×` to clear. Sends unix-ms at a UTC midnight, the
 * shape `due_on` and `planned_start` take (§4.5).
 */
function DateRow({ id, label, value, overdue, mayEdit, onChange }: DateRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? '' : msToDateInput(value));
  const [busy, setBusy] = useState(false);

  const run = async (ms: number | null): Promise<void> => {
    setBusy(true);
    try {
      await onChange(ms);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`meta-row meta-row-${id}`}>
      <p className="meta-label">{label}</p>
      {editing ? (
        <div className="meta-value dep-add meta-add">
          <label className="visually-hidden" htmlFor={`${id}-date`}>
            {label}
          </label>
          <input
            id={`${id}-date`}
            type="date"
            className="meta-date-input"
            value={draft}
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <button
            type="button"
            className="dep-confirm"
            disabled={busy || dateInputToMs(draft) === null}
            onClick={() => {
              void run(dateInputToMs(draft));
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="dep-cancel"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setDraft(value === null ? '' : msToDateInput(value));
            }}
          >
            Cancel
          </button>
        </div>
      ) : value === null ? (
        <p className="meta-value meta-plain">
          {mayEdit ? (
            <button
              type="button"
              className="meta-add-link"
              onClick={() => {
                setEditing(true);
              }}
            >
              Add date
            </button>
          ) : (
            <span className="meta-quiet">None</span>
          )}
        </p>
      ) : (
        <div className="meta-value meta-date">
          <button
            type="button"
            className={overdue ? 'meta-date-chip meta-date-overdue' : 'meta-date-chip'}
            disabled={!mayEdit}
            title={overdue ? 'Past due and still open' : undefined}
            onClick={() => {
              setDraft(msToDateInput(value));
              setEditing(true);
            }}
          >
            {overdue && (
              <span className="meta-date-warn" aria-label="Overdue">
                ⚠
              </span>
            )}
            <time dateTime={new Date(value).toISOString()}>{dateLabel(value)}</time>
          </button>
          {mayEdit && (
            <button
              type="button"
              className="dep-remove"
              disabled={busy}
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => {
                void run(null);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
