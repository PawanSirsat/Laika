import { useId, useState, type ReactNode } from 'react';
import { AssignControl } from '../board/AssignControl.tsx';
import { TagPicker } from '../board/TagPicker.tsx';
import { AgentRow } from './AgentRow.tsx';
import type { MyAgents } from '../../../api/use-my-agents.ts';
import type { ProjectStatus } from '../../../api/statuses.ts';
import { statusNameOf } from '../../../api/status-derive.ts';
import { statusOptions } from '../board/status-options.ts';
import type { Round } from '../../../api/review.ts';
import type { Sprint } from '../../../api/sprints.ts';
import { dateTime, timeLabel } from '../../../api/time-label.ts';
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
import { createdViaLine, priorityWords, pullRequestLine } from './rail-derive.ts';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import './task-panel.css';

export interface TaskMetaProps {
  readonly slug: string;
  readonly task: TaskSummary;
  /** Everything loaded, for naming where it was discovered. */
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
  /** How many of this task's subtasks are still open — for the warning under a `done` status. */
  readonly openSubtasks: number;
  /** Commits recorded against the task — the Changes tab's count, for the Development card. */
  readonly changesCount: number;
  /**
   * The newest round (LAI-1122), for the Development card: its branch and
   * pull request when the task itself records neither.
   */
  readonly latestRound?: Round | undefined;
  /** Into a project status, by id (LAI-739). */
  readonly onMove: (taskId: string, toStatusId: string) => void;
  readonly onAssigned: () => void;
  readonly onTaskEdited: () => void;
  readonly onTagsChanged: (tags: readonly string[]) => void;
  /** Open another task in this drawer — where this was discovered. */
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
  /** The reader's own agents, read once by the drawer (LAI-538). */
  readonly myAgents: MyAgents;
  /** When the read behind `task` started, in the page's order (`read-order.ts`). */
  readonly readOrder?: number | undefined;
  /**
   * The status control's sub-line (§11.4.2.1, LAI-1117): *In review for 24
   * min · round 1*, *Sent back 6 min ago · round 2*, *Not started*. Absent:
   * the older *claimed …* line.
   */
  readonly statusSub?: string | null | undefined;
  /** The **Links & dates** card (LAI-1122), under Details. */
  readonly links?: ReactNode;
  /** The **Estimate** card (LAI-1122), under Development. */
  readonly estimate?: ReactNode;
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
 * The drawer's right-hand rail (D-066; the 2026-11-04 design, LAI-1122).
 *
 * **The status is a pill at the top, not a row** — a coloured dot, the
 * status's name and a caret, the app's `Dropdown` behind it, with the line
 * that says where the task stands beside it and *Move to <review>* after.
 * Under it, the cards in the design's order:
 *
 * - **Details** — assignee (with Claim), agent (the picker, its help line and
 *   Ping), priority as *P1 · High*, labels, sprint, then what we have that the
 *   design does not draw: reporter, created via, outside id, watchers, and
 *   where it was discovered.
 * - **Links & dates** — the panel's own card (`LinksCard`), passed in.
 * - **Development**, only when there is any: branch, pull request — the
 *   task's, or its newest round's — outside id and the commit count.
 * - **Estimate** — the panel's own card (`EstimateCard`), passed in.
 *
 * The foot says how it was created and when, when it was updated, who is
 * watching, and what a Viewer may do. Every control the rail had before is
 * still here; the parent and the dates moved to Links & dates.
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
  openSubtasks,
  changesCount,
  latestRound,
  onMove,
  onAssigned,
  onTaskEdited,
  onTagsChanged,
  onOpen,
  statusRef,
  agentsAllowed,
  myAgents,
  readOrder = 0,
  statusSub,
  links,
  estimate,
}: TaskMetaProps) {
  const now = Date.now();
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const ink = task.assignee_id === null ? undefined : avatarColor(task.assignee_id, theme);
  const reporter = members.get(task.created_by);
  const reporterInk = avatarColor(task.created_by, theme);

  const [detailsOpen, setDetailsOpen] = useState(() => readOpen('details', true));
  const [devOpen, setDevOpen] = useState(() => readOpen('development', true));
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
  // The task's own first; else what its newest round's proof carries.
  const branch = task.branch ?? latestRound?.branch?.name ?? null;
  const roundPull = latestRound?.pull_request ?? null;
  const pullUrl = pullRef ?? roundPull?.url ?? null;
  const pullText =
    pullUrl === null
      ? null
      : pullRequestLine(pullUrl, pullRef === null ? (roundPull?.merged ?? null) : null);
  const pullIsUrl = pullUrl !== null && /^https?:\/\//.test(pullUrl);
  const hasDevelopment = branch !== null || pullUrl !== null || changesCount > 0;
  const prio = priorityWords(task.priority);

  return (
    <aside className="panel-meta" aria-label="Task details">
      {/* The status, as the design's pill: the field a reader changes most. */}
      <div className="meta-status-row">
        <label className={`meta-status meta-status-${task.status}`}>
          <span className="visually-hidden" id={statusId}>
            Status
          </span>
          <span className="meta-status-dot" aria-hidden="true" />
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
          <span className="meta-status-caret" aria-hidden="true">
            <Icon name="chevron-down" size="tiny" />
          </span>
        </label>
        {/* The design's line beside the pill: where the task stands, in words (LAI-1117). */}
        {statusSub !== undefined
          ? statusSub !== null && (
              <span className="meta-status-sub" data-status-sub>
                {statusSub}
              </span>
            )
          : since(task.started_at, now) !== undefined && (
              <span className="meta-status-sub">claimed {since(task.started_at, now)}</span>
            )}
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
              <p className="meta-label">
                <Icon name="person" size="small" className="section-mark" />
                Assignee
              </p>
              <div
                className="meta-value meta-person"
                data-editable={mayAssign ? 'assignee' : undefined}
              >
                {/* Their profile is the avatar (LAI-959, LAI-1123): a link
                    for a reader who may open it, so the name beside it keeps
                    the room the row has. */}
                {assignee !== undefined && task.assignee_id !== null ? (
                  <PersonLink
                    userId={task.assignee_id}
                    className="meta-person-link"
                    label={`${assignee.name}’s profile`}
                    onlyLink
                  >
                    <span
                      className="meta-avatar"
                      aria-hidden="true"
                      {...(ink === undefined
                        ? {}
                        : { style: { background: ink.background, color: ink.foreground } })}
                    >
                      {initials(assignee.name)}
                    </span>
                  </PersonLink>
                ) : (
                  <span className="meta-avatar meta-avatar-empty" aria-hidden="true">
                    —
                  </span>
                )}
                <AssignControl
                  task={task}
                  members={members}
                  meId={meId}
                  mayAssign={mayAssign}
                  onChanged={onAssigned}
                />
              </div>
            </div>

            {/* The agent meant to do the work, under the person accountable
                for it (LAI-538): two facts, two rows, neither replacing the
                other. */}
            <AgentRow
              task={task}
              meName={meId === undefined ? undefined : members.get(meId)?.name}
              mayEdit={mayEdit}
              agentsAllowed={agentsAllowed !== false}
              myAgents={myAgents}
              readOrder={readOrder}
              onChanged={onTaskEdited}
              projectSlug={slug}
            />

            <div className="meta-row">
              <p className="meta-label">
                <Icon name="flag" size="small" className="section-mark" />
                Priority
              </p>
              <div
                className="meta-value meta-value-prio"
                data-editable={mayEdit ? 'priority' : undefined}
              >
                {/* Jira's icon before the control (LAI-705), outside the
                    `<label>` so its name does not join the select's: the
                    design's ▲ ■ ▼. */}
                <PriorityIcon priority={task.priority} />
                <label className={`meta-select meta-prio meta-prio-${task.priority}`}>
                  <span className="visually-hidden" id={priorityId}>
                    Priority
                  </span>
                  {/* *P1 · High*, as the design writes it; the list draws
                      each level with its icon. */}
                  <Dropdown
                    variant="bare"
                    aria-labelledby={priorityId}
                    noun="priorities"
                    value={task.priority}
                    disabled={!mayEdit}
                    display={
                      <span className="dd-value">
                        {prio.code}
                        <span className="meta-prio-word"> · {prio.word}</span>
                      </span>
                    }
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
              <p className="meta-label">
                <Icon name="sprint" size="small" className="section-mark" />
                Sprint
              </p>
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

            <div className="meta-row">
              <p className="meta-label">
                <Icon name="person" size="small" className="section-mark" />
                Reporter
              </p>
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
              </p>
            </div>

            <OutsideIdRow
              value={outsideId}
              mayEdit={mayEdit}
              onChange={(ref) => edit({ external_ref: ref })}
            />

            <div className="meta-row">
              <p className="meta-label">
                <Icon name="eye" size="small" className="section-mark" />
                Watchers
              </p>
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

      {links}

      {/*
        **Development, only when there is any** (LAI-286 folded in). The branch
        the plugin reported, the PR when one is recorded — the task's, or its
        newest round's proof — the outside id, and the commits the webhook
        wrote: the facts Jira's card carries that we hold too.
      */}
      {hasDevelopment && (
        <section className="meta-card meta-dev">
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
            {changesCount > 0 && (
              <span className="meta-card-note">
                {changesCount} {changesCount === 1 ? 'commit' : 'commits'}
              </span>
            )}
          </button>
          {devOpen && (
            <div className="meta-rows">
              {branch !== null && (
                <div className="meta-row">
                  <p className="meta-label">Branch</p>
                  <p className="meta-value meta-plain meta-mono">{branch}</p>
                </div>
              )}
              {pullUrl !== null && (
                <div className="meta-row meta-row-pr">
                  {/* Not split from the next tag: `endpoint-coverage` reads that word followed by `<` as a client call site. */}
                  <p className="meta-label">{'Pull request'}</p>
                  <p
                    className="meta-value meta-plain"
                    data-merged={
                      pullRef === null && roundPull?.merged != null
                        ? String(roundPull.merged)
                        : undefined
                    }
                  >
                    {pullIsUrl ? (
                      <Tooltip content={pullUrl}>
                        <a href={pullUrl} target="_blank" rel="noreferrer">
                          {pullText}
                        </a>
                      </Tooltip>
                    ) : (
                      pullText
                    )}
                  </p>
                </div>
              )}
              {outsideId !== null && (
                <div className="meta-row">
                  <p className="meta-label">Outside id</p>
                  <p className="meta-value meta-plain meta-mono">{outsideId}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {estimate}

      <div className="panel-side-foot">
        {/* Short dates, the full one on hover; never *ago* here — the
            relative form lives on the List (LAI-1123). */}
        <p className="panel-foot-times">
          <span className="panel-foot-line">
            Created via {createdViaLine(task)} ·{' '}
            <Tooltip content={timeLabel(task.created_at, now).full}>
              <time dateTime={timeLabel(task.created_at, now).iso}>
                {dateTime(task.created_at, now)}
              </time>
            </Tooltip>
          </span>{' '}
          <span className="panel-foot-line">
            Updated{' '}
            <Tooltip content={timeLabel(task.updated_at, now).full}>
              <time dateTime={timeLabel(task.updated_at, now).iso}>
                {dateTime(task.updated_at, now)}
              </time>
            </Tooltip>
          </span>
        </p>
        {named.length > 0 && <p className="panel-foot-watching">Watching: {named.join(', ')}</p>}
        <p className="panel-permission">
          Members can move and comment. Viewers see this panel read-only.
        </p>
      </div>
    </aside>
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
          <Tooltip content="Clear outside id">
            <button
              type="button"
              className="dep-remove"
              disabled={busy}
              aria-label="Clear outside id"
              onClick={() => {
                void run(null);
              }}
            >
              <Icon name="close" size="tiny" />
            </button>
          </Tooltip>
        </div>
      ) : (
        <p className="meta-value meta-plain meta-mono">{value}</p>
      )}
    </div>
  );
}
