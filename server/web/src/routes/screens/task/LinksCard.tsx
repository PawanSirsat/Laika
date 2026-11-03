import { useState } from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { dateInputToMs, dateLabel, isOverdue, msToDateInput } from '../../../api/date-only.ts';
import { updateTask, type Member, type TaskSummary } from '../../../api/tasks.ts';
import type { ProjectStatus } from '../../../api/statuses.ts';
import type { Theme } from '../../../theme/theme.ts';
import { DependenciesSection } from './DependenciesSection.tsx';
import { SubtasksSection } from './SubtasksSection.tsx';
import './task-panel.css';

export interface LinksCardProps {
  readonly slug: string;
  readonly task: TaskSummary;
  /** Everything loaded: the parent's candidates, the children, the blockers. */
  readonly byId: ReadonlyMap<string, TaskSummary>;
  /** The parent, resolved by the panel (it may be outside `byId`). */
  readonly parent: TaskSummary | undefined;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly statuses: readonly ProjectStatus[];
  readonly meId: string | undefined;
  /** Member+: the parent, the dates, the links, a child's status, a detach. */
  readonly mayEdit: boolean;
  /** `task.assign_other`: a child's assignee. */
  readonly mayAssign: boolean;
  /** `task.create` in this space: *Add subtask*. */
  readonly mayCreate: boolean;
  /** Open another task in this drawer. */
  readonly onOpen: (taskId: string) => void;
  /** After any write here: the board refetches the task. */
  readonly onChanged: () => void;
}

/**
 * The rail's **Links & dates** card (§11.4.2.1, LAI-1122): where the task
 * sits among the others and when. Parent, its subtasks *n of m done*, what
 * blocks it and what it blocks, then the due date and the planned start —
 * each row the control it was before the redesign moved it here from the
 * Details card and the main column (the parent and the dates, D-066; the
 * Subtasks and Linked tasks sections, LAI-495 and LAI-284). Nothing they did
 * is lost: add and detach a parent, add a subtask and change a child's status
 * and assignee or detach it, link and unlink a blocker, set and clear a date.
 */
export function LinksCard({
  slug,
  task,
  byId,
  parent,
  members,
  theme,
  statuses,
  meId,
  mayEdit,
  mayAssign,
  mayCreate,
  onOpen,
  onChanged,
}: LinksCardProps) {
  const now = Date.now();
  const [error, setError] = useState<string | undefined>(undefined);

  /** A field edit, with the server's reason shown when it refuses. */
  const edit = async (patch: Parameters<typeof updateTask>[1]): Promise<void> => {
    setError(undefined);
    try {
      await updateTask(task.id, patch);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that. Try again.');
    }
  };

  /*
   * One level (D-066): a task that has subtasks cannot be given a parent, so
   * the row is absent rather than offering a picker the server refuses; and a
   * subtask has no subtasks of its own, so that row is absent on one.
   */
  const hasChildren = [...byId.values()].some((t) => t.parent_task_id === task.id);
  const parentCandidates = [...byId.values()]
    .filter((t) => t.id !== task.id && t.parent_task_id === null)
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .sort((a, b) => a.number - b.number);

  return (
    <section className="meta-card meta-links" aria-label="Links and dates">
      <h3 className="meta-card-title">Links &amp; dates</h3>
      <div className="meta-rows">
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

        {task.parent_task_id === null && (
          <SubtasksSection
            slug={slug}
            task={task}
            byId={byId}
            members={members}
            theme={theme}
            mayAssign={mayAssign}
            meId={meId}
            statuses={statuses}
            mayEdit={mayEdit}
            mayCreate={mayCreate}
            onOpen={onOpen}
            onChanged={onChanged}
          />
        )}

        <DependenciesSection
          task={task}
          byId={byId}
          members={members}
          theme={theme}
          mayEdit={mayEdit}
          onChanged={onChanged}
        />

        <DateRow
          id="due"
          label="Due date"
          value={task.due_on}
          overdue={isOverdue(task, now)}
          mayEdit={mayEdit}
          onChange={(ms) => edit({ due_on: ms })}
        />

        <DateRow
          id="start"
          label="Planned start"
          value={task.planned_start}
          overdue={false}
          mayEdit={mayEdit}
          onChange={(ms) => edit({ planned_start: ms })}
        />

        {error !== undefined && (
          <p className="panel-alert meta-alert" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
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
