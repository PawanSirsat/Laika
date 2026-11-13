import { useEffect, useState } from 'react';
import { Spinner } from '../../../components/Spinner.tsx';
import {
  forecastLine,
  getSprintForecast,
  type Sprint,
  type SprintForecast,
} from '../../../api/sprints.ts';
import { LockIcon } from '../../../components/LockIcon.tsx';
import { formatRange, sprintDays, type SprintProgress } from './sprint-derive.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { SprintKey } from './SprintKey.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';

export interface SprintCardProps {
  readonly sprint: Sprint;
  readonly tasks: readonly TaskSummary[];
  readonly progress: SprintProgress;
  /** `S1` — the sprint's position in the project, as every other screen labels it. */
  readonly index: number;
  /** Open work held by an unfinished blocker anywhere in the project — the board's BLK. */
  readonly blocked: number;
  readonly wip: number;
  readonly unassigned: number;
  /** Subtasks inside `progress` — said on the card, so the fraction is not read as top-level work. */
  readonly subtasks: number;
  readonly canManage: boolean;
  readonly canAssign: boolean;
  readonly busy: boolean;
  /** Which mutation is in flight — see `UseSprints.pending`. */
  readonly pending: string | undefined;
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
  const { sprint, tasks, progress, canManage, canAssign, busy, pending } = props;
  const days = sprintDays(sprint.starts_on, sprint.ends_on);

  // "85% likely to finish 18–23 of 26" (LAI-772): the server's, from the
  // project's own throughput and the sizes left; read again when the work in
  // the sprint moves. A completed sprint has its answer already.
  const [forecast, setForecast] = useState<SprintForecast | undefined>(undefined);
  const live = sprint.status !== 'completed';
  useEffect(() => {
    if (!live) return undefined;
    const controller = new AbortController();
    getSprintForecast(sprint.id, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setForecast(answer);
      })
      // The line is a footnote: without it the card still reads.
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [sprint.id, live, progress.done, progress.total]);
  const line = live && forecast?.sprint_id === sprint.id ? forecastLine(forecast) : null;

  return (
    <article className={`sprint-card sprint-card-${sprint.status}`}>
      {/*
        The design's row (prototype lines 626–643): id, status, name and goal,
        then one 150px block of numbers, then the chevron. It was a stacked
        card three times this tall, so four sprints filled a window that the
        design fits in a third of one.
      */}
      <div className="sprint-row">
        <SprintKey index={props.index} className="sprint-id" />

        <span className={`sprint-status sprint-status-${sprint.status}`}>{sprint.status}</span>

        <span className="sprint-headline">
          <span className="sprint-headline-top">
            <h3 className="sprint-name">{sprint.name}</h3>
            <time className="sprint-range" dateTime={new Date(sprint.starts_on).toISOString()}>
              <Icon name="calendar" size="tiny" className="section-mark" />
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
              {/* A completed sprint's tasks are counted as they stand **now** —
                  work finished after its last day included — and it says so
                  rather than reading as what the sprint delivered (LAI-819). */}
              {progress.total === 0
                ? 'no tasks'
                : `${String(progress.percent)}%${sprint.status === 'completed' ? ' done now' : ''}`}
            </span>
            {props.blocked > 0 && (
              <Tooltip content={`${String(props.blocked)} blocked by unfinished work`} lazy>
                <span className="sprint-blocked">
                  <LockIcon />
                  {props.blocked}
                </span>
              </Tooltip>
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
          {/* `done/total` counts subtasks as the board's DONE does; the card
              says so instead of reading as top-level work (LAI-819). */}
          {props.subtasks > 0 && (
            <span className="sprint-flow sprint-subtasks">
              incl. {props.subtasks} {props.subtasks === 1 ? 'subtask' : 'subtasks'}
            </span>
          )}
          {/* Labelled only when it is a forecast; the no-forecast line
              already starts with the word. */}
          {line !== null && (forecast?.forecast ?? null) !== null && (
            <span className="sprint-forecast-label" aria-hidden="true">
              Forecast
            </span>
          )}
          {line !== null && forecast !== undefined && (
            <Tooltip
              content={`From what this project finished in the last ${String(forecast.basis.days)} days (${String(
                forecast.basis.tasks_done,
              )} tasks) and the effort left — not story points`}
              lazy
            >
              <span
                className={
                  forecast.forecast === null
                    ? 'sprint-forecast sprint-forecast-none'
                    : 'sprint-forecast'
                }
                data-forecast={forecast.forecast === null ? 'none' : 'range'}
              >
                {line}
              </span>
            </Tooltip>
          )}
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
              {pending === `activate:${sprint.id}` && <Spinner size="sm" />}
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
                aria-label={`Edit ${sprint.name}`}
              >
                Edit
              </button>
              {/* Quiet until it is asked for (LAI-1195): a red button on every
                  row, the running sprint included, read as an alarm. The
                  confirm that follows is where the danger is said. */}
              <button
                type="button"
                className="sprint-button sprint-button-quiet"
                onClick={props.onDelete}
                disabled={busy}
                data-delete-for={sprint.id}
                aria-label={`Delete ${sprint.name}`}
              >
                {pending === `remove:${sprint.id}` && <Spinner size="sm" />}
                Delete
              </button>
            </>
          )}
        </span>

        {/* Scopes the board, the timeline and the strip to this sprint — which
            is what the design's footnote says this row does. */}
        <Tooltip content="Show on the board">
          <button
            type="button"
            className="sprint-open"
            onClick={props.onScope}
            aria-label={`Show ${sprint.name} on the board`}
          >
            <Icon name="chevron" size="small" />
          </button>
        </Tooltip>
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
