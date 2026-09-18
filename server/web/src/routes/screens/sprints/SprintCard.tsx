import type { Sprint } from '../../../api/sprints.ts';
import { LockIcon } from '../../../components/LockIcon.tsx';
import { formatRange, sprintDays, type SprintProgress } from './sprint-derive.ts';
import type { Task } from '../../../api/tasks.ts';

export interface SprintCardProps {
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
  readonly progress: SprintProgress;
  /** `S1` — the sprint's position in the project, as every other screen labels it. */
  readonly index: number;
  /** Counted with `board-derive`'s rule, never a second one. */
  readonly blocked: number;
  readonly wip: number;
  readonly unassigned: number;
  readonly canManage: boolean;
  readonly canAssign: boolean;
  readonly busy: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
  readonly onActivate: () => void;
  readonly onDelete: () => void;
  readonly onAssign: () => void;
  readonly onUnassign: (taskId: string) => void;
  /** Scope the board and the timeline to this sprint. */
  readonly onScope: () => void;
}

/**
 * One sprint (LAI-083).
 *
 * **Every number here comes from the API**: the range and status are the
 * sprint's own fields, and `done/total` is counted from the project's real
 * tasks. Nothing is a fixture, and nothing is a placeholder that reads as data.
 *
 * Controls are **hidden**, not disabled-with-a-tooltip, when the actor cannot
 * use them — a disabled Activate button still tells a Member that activation is
 * a thing they are failing at, whereas its absence tells them nothing false.
 * The server is still the decision; this only avoids offering a 403.
 */
export function SprintCard(props: SprintCardProps) {
  const { sprint, tasks, progress, canManage, canAssign, busy } = props;
  const days = sprintDays(sprint.starts_on, sprint.ends_on);

  return (
    <article className={`sprint-card sprint-card-${sprint.status}`}>
      {/*
        The design's row (prototype lines 626–643): id, status, name and goal,
        then one 150px block of numbers, then the chevron. It was a stacked
        card three times this tall, so four sprints filled a window that the
        design fits in a third of one.
      */}
      <div className="sprint-row">
        <span className="sprint-id">S{props.index}</span>

        <span className={`sprint-status sprint-status-${sprint.status}`}>{sprint.status}</span>

        <span className="sprint-headline">
          <span className="sprint-headline-top">
            <h3 className="sprint-name">{sprint.name}</h3>
            <time className="sprint-range" dateTime={new Date(sprint.starts_on).toISOString()}>
              {formatRange(sprint.starts_on, sprint.ends_on)} · {days} days
            </time>
          </span>
          {sprint.goal !== null && sprint.goal !== '' && (
            <span className="sprint-goal">{sprint.goal}</span>
          )}
        </span>

        <span className="sprint-figures">
          <span className="sprint-figures-top">
            <span className="sprint-frac">
              {progress.done}/{progress.total}
            </span>
            <span className="sprint-pct">
              {progress.total === 0 ? 'no tasks' : `${String(progress.percent)}%`}
            </span>
            {props.blocked > 0 && (
              <span className="sprint-blocked">
                <LockIcon />
                {props.blocked}
              </span>
            )}
          </span>

          <span
            className="sprint-bar"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${sprint.name} progress`}
          >
            <span className="sprint-bar-fill" style={{ width: `${String(progress.percent)}%` }} />
          </span>

          {/* The design's second line of numbers. Both are counted from the
              project's real tasks — `in flight` is the in-progress lane, not an
              estimate. */}
          <span className="sprint-flow">
            {props.wip} in flight · {props.unassigned} unassigned
          </span>
        </span>

        {/*
          **The actions stay.** The design draws a chevron and nothing else,
          because a mockup has nothing to manage; deleting Activate, Edit and
          Delete to match it would remove working features the API supports.
          They sit in the row as a compact cluster instead of the button bar
          that made this card three lines taller than the design's.
        */}
        <span className="sprint-actions">
          <button type="button" className="sprint-button" onClick={props.onToggle}>
            {props.expanded ? 'Hide' : `Tasks ${String(tasks.length)}`}
          </button>

          {canAssign && (
            <button
              type="button"
              className="sprint-button"
              onClick={props.onAssign}
              disabled={busy}
            >
              Add
            </button>
          )}

          {canManage && sprint.status !== 'active' && sprint.status !== 'completed' && (
            <button
              type="button"
              className="sprint-button sprint-button-primary"
              onClick={props.onActivate}
              disabled={busy}
            >
              Activate
            </button>
          )}

          {canManage && (
            <>
              <button
                type="button"
                className="sprint-button"
                onClick={props.onEdit}
                disabled={busy}
              >
                Edit
              </button>
              <button
                type="button"
                className="sprint-button sprint-button-danger"
                onClick={props.onDelete}
                disabled={busy}
              >
                Delete
              </button>
            </>
          )}
        </span>

        {/* Scopes the board, the timeline and the strip to this sprint — which
            is what the design's footnote says this row does. */}
        <button
          type="button"
          className="sprint-open"
          onClick={props.onScope}
          aria-label={`Show ${sprint.name} on the board`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>

      {props.expanded && (
        <ul className="sprint-tasks">
          {tasks.length === 0 && <li className="sprint-task-empty">Nothing assigned yet.</li>}
          {tasks.map((task) => (
            <li key={task.id} className="sprint-task">
              <span className="sprint-task-key">{task.key}</span>
              <span className="sprint-task-title">{task.title}</span>
              <span className={`sprint-task-status sprint-task-${task.status}`}>{task.status}</span>
              {canAssign && (
                <button
                  type="button"
                  className="sprint-task-remove"
                  onClick={() => {
                    props.onUnassign(task.id);
                  }}
                  disabled={busy}
                  aria-label={`Remove ${task.key} from ${sprint.name}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
