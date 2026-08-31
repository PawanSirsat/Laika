import type { Sprint } from '../../../api/sprints.ts';
import { formatRange, sprintDays, type SprintProgress } from './sprint-derive.ts';
import type { Task } from '../../../api/tasks.ts';

export interface SprintCardProps {
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
  readonly progress: SprintProgress;
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
      <header className="sprint-card-head">
        <div className="sprint-card-title">
          <h3 className="sprint-name">{sprint.name}</h3>
          <span className={`sprint-status sprint-status-${sprint.status}`}>{sprint.status}</span>
        </div>

        <p className="sprint-range">
          <time dateTime={new Date(sprint.starts_on).toISOString()}>
            {formatRange(sprint.starts_on, sprint.ends_on)}
          </time>
          <span className="sprint-days">{days} days</span>
        </p>
      </header>

      {sprint.goal !== null && sprint.goal !== '' && <p className="sprint-goal">{sprint.goal}</p>}

      <div className="sprint-progress">
        <div
          className="sprint-bar"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${sprint.name} progress`}
        >
          <span className="sprint-bar-fill" style={{ width: `${String(progress.percent)}%` }} />
        </div>
        <p className="sprint-count">
          {progress.total === 0
            ? 'No tasks yet'
            : `${String(progress.done)}/${String(progress.total)} done`}
        </p>
      </div>

      <div className="sprint-card-actions">
        <button type="button" className="sprint-button" onClick={props.onToggle}>
          {props.expanded ? 'Hide tasks' : `Tasks (${String(tasks.length)})`}
        </button>

        {canAssign && (
          <button type="button" className="sprint-button" onClick={props.onAssign} disabled={busy}>
            Add tasks
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
            <button type="button" className="sprint-button" onClick={props.onEdit} disabled={busy}>
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
