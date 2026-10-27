import { useId, useState } from 'react';
import { AssignControl } from '../board/AssignControl.tsx';
import { TagPicker } from '../board/TagPicker.tsx';
import { AgentRow } from './AgentRow.tsx';
import type { ProjectStatus } from '../../../api/statuses.ts';
import { statusNameOf } from '../../../api/status-derive.ts';
import { statusOptions } from '../board/status-options.ts';
import { dateInputToMs, dateLabel, isOverdue, msToDateInput } from '../../../api/date-only.ts';
import type { Sprint } from '../../../api/sprints.ts';
import { timeLabel } from '../../../api/time-label.ts';
import {
  isOutsideId,
  updateTask,
  PRIORITIES,
  type Member,
  type TaskSummary,
} from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import { PriorityIcon } from '../../../components/PriorityIcon.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import type { DemoAgentBuild, DemoClaimLock } from '../../../demo/agent-runtime.ts';
import './task-panel.css';

export interface TaskMetaProps {
  readonly slug: string;
  readonly task: TaskSummary;
  /** Everything loaded, for naming the parent and offering one. */
  readonly byId: ReadonlyMap<string, TaskSummary>;
  /** The project's statuses — the board's columns — for the status control (LAI-739). */
  readonly statuses: readonly ProjectStatus[];
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
  readonly parent: TaskSummary | undefined;
  /** How many of this task's subtasks are still open — for the warning under a `done` status. */
  readonly openSubtasks: number;
  /** Commits recorded against the task — the Changes tab's count, for the Development card. */
  readonly changesCount: number;
  /** Into a project status, by id (LAI-739). */
  readonly onMove: (taskId: string, toStatusId: string) => void;
  readonly onAssigned: () => void;
  readonly onTaskEdited: () => void;
  readonly onTagsChanged: (tags: readonly string[]) => void;
  /** Open another task in this drawer — the parent, or where this was discovered. */
  readonly onOpen: (taskId: string) => void;
  /**
   * The status control. `HTMLElement`, not the `<select>` it was: since
   * LAI-726 the control is `Dropdown`'s trigger, a `<button>`.
   */
  readonly statusRef: React.RefObject<HTMLElement | null>;
  /**
   * The space's `agents_allowed`, for the Agent row's reasons (LAI-538).
   * Absent reads as allowed; the server refuses `agents_off` either way.
   */
  readonly agentsAllowed?: boolean | undefined;
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
  statuses,
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
  agentsAllowed,
}: TaskMetaProps) {
  const now = Date.now();
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const ink = task.assignee_id === null ? undefined : avatarColor(task.assignee_id, theme);
  const reporter = members.get(task.created_by);
  const reporterInk = avatarColor(task.created_by, theme);

  const [detailsOpen, setDetailsOpen] = useState(() => readOpen('details', true));
  const [devOpen, setDevOpen] = useState(() => readOpen('development', false));
  const [error, setError] = useState<string | undefined>(undefined);
  // The words that name each rail control (LAI-726), pointed at explicitly with
  // `aria-labelledby`, so the name never rests on how a browser reads a label
  // that also holds the control's value.
  const statusId = useId();
  const priorityId = useId();
  const sprintId = useId();

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
  const byStatusId = new Map(statuses.map((s) => [s.id, s]));
  const reviewColumn = [...statuses]
    .sort((a, b) => a.position - b.position)
    .find((s) => s.category === 'review' && !s.hidden);
  /*
   * `external_ref` holds one of two things (LAI-780): an outside id — the
   * card's id elsewhere, a Details field — or the pull request the webhook
   * recorded, which belongs to Development.
   */
  const outsideId =
    task.external_ref !== null && isOutsideId(task.external_ref) ? task.external_ref : null;
  const pullRef = outsideId === null ? task.external_ref : null;
  const hasDevelopment = task.branch !== null || pullRef !== null || changesCount > 0;
  const externalIsUrl = pullRef !== null && /^https?:\/\//.test(pullRef);

  return (
    <aside className="panel-meta" aria-label="Task details">
      {/* The status, as Jira's coloured control: the field a reader changes most. */}
      <div className="meta-status-row">
        <label className={`meta-status meta-status-${task.status}`}>
          <span className="visually-hidden" id={statusId}>
            Status
          </span>
          {/*
            **Every status of the project** (LAI-739), hidden ones marked —
            a cancelled one included, which starts hidden on the board and so
            is reached from here. The pill shows the name, coloured by its
            kind; the list adds each status's dot (LAI-726). The caret is the
            label's, so the trigger draws none.
          */}
          <Dropdown
            variant="bare"
            chevron={false}
            triggerRef={(el) => {
              statusRef.current = el;
            }}
            aria-labelledby={statusId}
            noun="statuses"
            value={task.status_id}
            disabled={moving || !mayEdit}
            display={<span className="dd-value">{statusNameOf(task, byStatusId)}</span>}
            options={statusOptions(statuses)}
            onChange={(to) => {
              if (to !== task.status_id) onMove(task.id, to);
            }}
          />
          <span className="meta-status-caret" aria-hidden="true" />
        </label>
        {/* The project's first review column, by name — *Move to QA* on a
            board that calls it that (LAI-739). */}
        {mayEdit &&
          reviewColumn !== undefined &&
          task.status !== 'review' &&
          task.status !== 'done' && (
            <button
              type="button"
              className="meta-review"
              disabled={moving}
              onClick={() => {
                onMove(task.id, reviewColumn.id);
              }}
            >
              Move to {reviewColumn.name}
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
              <div
                className="meta-value meta-person"
                data-editable={mayAssign ? 'assignee' : undefined}
              >
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
                {/* Their profile, for a reader who may open it (LAI-959). */}
                {assignee !== undefined && task.assignee_id !== null && (
                  <PersonLink
                    userId={task.assignee_id}
                    className="meta-person-link"
                    label={`${assignee.name}’s profile`}
                    onlyLink
                  >
                    Profile
                  </PersonLink>
                )}
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

            {/* The agent meant to do the work, under the person accountable
                for it (LAI-538): two facts, two rows, neither replacing the
                other. */}
            <AgentRow
              task={task}
              meName={meId === undefined ? undefined : members.get(meId)?.name}
              mayEdit={mayEdit}
              agentsAllowed={agentsAllowed !== false}
              onChanged={onTaskEdited}
            />

            <div className="meta-row">
              <p className="meta-label">Priority</p>
              <div
                className="meta-value meta-value-prio"
                data-editable={mayEdit ? 'priority' : undefined}
              >
                {/* Jira's icon before the control (LAI-705), outside the
                    `<label>` so its name does not join the select's. */}
                <PriorityIcon priority={task.priority} />
                <label className={`meta-select meta-prio meta-prio-${task.priority}`}>
                  <span className="visually-hidden" id={priorityId}>
                    Priority
                  </span>
                  {/* The icon is already before the control, so the trigger
                      shows the level's words alone; the list draws each. */}
                  <Dropdown
                    variant="bare"
                    aria-labelledby={priorityId}
                    noun="priorities"
                    value={task.priority}
                    disabled={!mayEdit}
                    display={<span className="dd-value">{task.priority.toUpperCase()}</span>}
                    options={PRIORITIES.map((p) => ({
                      value: p,
                      label: p.toUpperCase(),
                      icon: <PriorityIcon priority={p} />,
                    }))}
                    onChange={(value) => {
                      void edit({ priority: value });
                    }}
                  />
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
              <div className="meta-value meta-tags" data-editable={mayEdit ? 'labels' : undefined}>
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
              <div className="meta-value" data-editable={maySetSprint ? 'sprint' : undefined}>
                <label className="meta-select">
                  <span className="visually-hidden" id={sprintId}>
                    Sprint
                  </span>
                  {/*
                    **`No sprint` is a real option, not an absence** (LAI-619).
                    Backlog work genuinely belongs to no sprint, and without
                    this the only way out of one was the Sprints screen.
                  */}
                  <Dropdown
                    variant="bare"
                    aria-labelledby={sprintId}
                    noun="sprints"
                    value={task.sprint_id ?? ''}
                    disabled={sprintBusy || !maySetSprint}
                    options={[
                      { value: '', label: 'No sprint', pinned: true },
                      ...sprints.map((s) => ({
                        value: s.id,
                        label: s.name,
                        badge: s.status === 'active' ? 'Active' : undefined,
                      })),
                    ]}
                    onChange={(value) => {
                      const to = value === '' ? null : value;
                      if (to !== (task.sprint_id ?? null)) onSprintChange(to);
                    }}
                  />
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

            <OutsideIdRow
              value={outsideId}
              mayEdit={mayEdit}
              onChange={(ref) => edit({ external_ref: ref })}
            />

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
              {pullRef !== null && (
                <div className="meta-row">
                  {/* "PR", not the longer word: `endpoint-coverage` reads that word followed by `<` as a client call site. */}
                  <p className="meta-label">PR</p>
                  <p className="meta-value meta-plain">
                    {externalIsUrl ? (
                      <a href={pullRef} target="_blank" rel="noreferrer">
                        {pullRef}
                      </a>
                    ) : (
                      pullRef
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
  readonly task: TaskSummary;
  readonly parent: TaskSummary | undefined;
  readonly candidates: readonly TaskSummary[];
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
          <Dropdown
            id="parent-pick"
            variant="bare"
            noun="tasks"
            value={picked}
            disabled={busy}
            options={[
              { value: '', label: 'Choose a task…', pinned: true },
              ...candidates.map((t) => ({ value: t.id, label: `${t.key} — ${t.title}` })),
            ]}
            onChange={setPicked}
          />
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
        <div className="meta-value dep-add meta-add" data-editable={id}>
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
        <p className="meta-value meta-plain" data-editable={mayEdit ? id : undefined}>
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
        <div className="meta-value meta-date" data-editable={mayEdit ? id : undefined}>
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

interface OutsideIdRowProps {
  /** The outside id the card carries, or `null` — never a pull request's ref. */
  readonly value: string | null;
  readonly mayEdit: boolean;
  readonly onChange: (ref: string | null) => Promise<void>;
}

/**
 * The id this card has somewhere else (LAI-780): a repo task file's `LAI-780`,
 * a Jira key. Every tool that takes a task key takes it too, so an agent
 * working from that id can mark this card. Shown as a chip — or *Add outside
 * id* — and edited in place, as the dates are; Save waits for a well-shaped
 * id, and the server upper-cases it.
 */
function OutsideIdRow({ value, mayEdit, onChange }: OutsideIdRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);

  const run = async (ref: string | null): Promise<void> => {
    setBusy(true);
    try {
      await onChange(ref);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="meta-row meta-row-outside-id">
      <p className="meta-label">Outside id</p>
      {editing ? (
        <div className="meta-value dep-add meta-add">
          <label className="visually-hidden" htmlFor="outside-id-input">
            Outside id
          </label>
          <input
            id="outside-id-input"
            type="text"
            className="meta-date-input meta-mono"
            placeholder="LAI-123"
            autoComplete="off"
            spellCheck={false}
            maxLength={26}
            value={draft}
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <button
            type="button"
            className="dep-confirm"
            disabled={busy || !isOutsideId(draft)}
            onClick={() => {
              void run(draft.trim());
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
              setDraft(value ?? '');
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
                setDraft('');
                setEditing(true);
              }}
            >
              Add outside id
            </button>
          ) : (
            <span className="meta-quiet">None</span>
          )}
        </p>
      ) : mayEdit ? (
        <div className="meta-value meta-date">
          <button
            type="button"
            className="meta-date-chip meta-mono"
            aria-label={`Change outside id, ${value}`}
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
          >
            {value}
          </button>
          <button
            type="button"
            className="dep-remove"
            disabled={busy}
            aria-label="Clear outside id"
            onClick={() => {
              void run(null);
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : (
        <p className="meta-value meta-plain meta-mono">{value}</p>
      )}
    </div>
  );
}
