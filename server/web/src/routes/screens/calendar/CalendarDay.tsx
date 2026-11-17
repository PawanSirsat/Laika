import { useEffect, useRef, useState, type DragEvent } from 'react';
import { dateInputToMs, msToDateInput } from '../../../api/date-only.ts';
import type { ProjectStatus } from '../../../api/statuses.ts';
import { statusNameOf } from '../../../api/status-derive.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { dayLabel, dayOverflow, type CalendarDay as Day } from './calendar-derive.ts';
import { DRAG_TYPE } from './calendar-drag.ts';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

/** Chips a day draws before "+N more" (LAI-1178): every cell keeps one height. */
export const DAY_CHIPS = 3;

export interface ChipProps {
  readonly task: TaskSummary;
  readonly byId: ReadonlyMap<string, ProjectStatus>;
  readonly mayMove: boolean;
  readonly onOpen: (taskId: string) => void;
  /**
   * In the tab order. A chip inside the day grid is not (LAI-1218): the grid
   * has one stop, the focused day, and Enter on it opens the day in full.
   */
  readonly tabbable?: boolean | undefined;
}

/**
 * A task on the calendar (LAI-1178): its priority as a stripe down the left
 * edge, the key and the status — named, in its kind's colour (LAI-739) — on
 * the first line, and the title on its own line, so it is read rather than
 * cut to its first two letters.
 */
export function CalendarChip({ task, byId, mayMove, onOpen, tabbable = true }: ChipProps) {
  const status = statusNameOf(task, byId);
  return (
    <Tooltip
      content={`${task.key} — ${task.title} · ${status} · ${task.priority.toUpperCase()}`}
      lazy
    >
      <button
        type="button"
        className={`cal-task cal-task-${task.priority}`}
        data-task-id={task.id}
        tabIndex={tabbable ? undefined : -1}
        draggable={mayMove}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, task.id);
          event.dataTransfer.setData('text/plain', task.key);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => {
          onOpen(task.id);
        }}
      >
        <span className="cal-task-top">
          <span className="cal-task-key">{task.key}</span>
          <span className={`cal-task-status cal-status-${task.status}`}>{status}</span>
          {task.created_via === 'mcp' && (
            <span className="cal-task-agent" aria-label="agent-owned" role="img" />
          )}
        </span>
        <span className="cal-task-title">{task.title}</span>
      </button>
    </Tooltip>
  );
}

export interface CalendarDayProps {
  readonly day: Day;
  /**
   * Chips drawn before "+N more". A month's days keep one height with
   * `DAY_CHIPS`; a week's day draws every task (LAI-1218).
   */
  readonly cap?: number | undefined;
  /** What a screen reader reads for the day (`dayLabel`). */
  readonly label: string;
  /** The grid's one tab stop (roving tabindex, LAI-1218). */
  readonly tabStop: boolean;
  /** The day took focus itself — by a click or the keyboard. */
  readonly onFocusDay: (at: number) => void;
  /** Saturday or Sunday's column: the day panel opens leftwards. */
  readonly end?: boolean | undefined;
  readonly tasks: readonly TaskSummary[];
  readonly byId: ReadonlyMap<string, ProjectStatus>;
  readonly mayMove: boolean;
  /** A chip is being dragged somewhere on the page: days show they take a drop. */
  readonly dragging: boolean;
  readonly onOpen: (taskId: string) => void;
  /** Move a task to a local day (a grid day's midnight). */
  readonly onDrop: (taskId: string, at: number) => void;
  /** Move a task to a date-only `due_on` from the day's *Move to…*. */
  readonly onMoveTo: (task: TaskSummary, dueOn: number) => void;
}

const dayName = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** `Wednesday 18 November`, in the fixed order `dayLabel` reads. */
const dayTitle = (at: number): string =>
  dayLabel(at, { tasks: 0, today: false }).split(', ')[0] ?? '';

/**
 * One day of the grid (LAI-1178): a fixed height, at most three chips and
 * "+N more" for the rest, and a drop target while a chip is dragged. Its date
 * opens the whole day — every task, each with *Move to…*.
 *
 * **A grid cell** (LAI-1218): the day itself is what the keyboard lands on,
 * one day in the tab order at a time, and Enter or Space on it opens the day
 * in full — which is the keyboard's only way to reschedule. Nothing in the
 * cell is a tab stop of its own; a drag is for a pointer.
 */
export function CalendarDay({
  day,
  cap = DAY_CHIPS,
  label,
  tabStop,
  onFocusDay,
  end = false,
  tasks,
  byId,
  mayMove,
  dragging,
  onOpen,
  onDrop,
  onMoveTo,
}: CalendarDayProps) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const cell = useRef<HTMLDivElement | null>(null);
  const { shown, more, all } = dayOverflow(tasks, cap);
  const classes = ['cal-day'];
  if (!day.inMonth) classes.push('cal-day-out');
  if (day.isWeekend) classes.push('cal-day-weekend');
  if (day.isToday) classes.push('cal-day-today');
  if (over) classes.push('cal-day-over');

  const accepts = (event: DragEvent): boolean =>
    mayMove && event.dataTransfer.types.includes(DRAG_TYPE);

  return (
    <div
      ref={cell}
      role="gridcell"
      tabIndex={tabStop ? 0 : -1}
      aria-label={label}
      aria-current={day.isToday ? 'date' : undefined}
      className={classes.join(' ')}
      data-day={day.at}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusDay(day.at);
      }}
      onKeyDown={(event) => {
        // The day's own keys only: Enter on a chip is the chip's click.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setOpen(true);
        }
      }}
      data-end={end ? '' : undefined}
      data-dragging={dragging ? '' : undefined}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        if (!accepts(event)) return;
        event.preventDefault();
        const id = event.dataTransfer.getData(DRAG_TYPE);
        if (id !== '') onDrop(id, day.at);
      }}
    >
      <div className="cal-day-head">
        <Tooltip
          content={`${dayName(day.at)}${tasks.length > 0 ? `, ${String(tasks.length)} due` : ''}`}
          lazy
        >
          <button
            type="button"
            className="cal-date"
            tabIndex={-1}
            aria-label={`${dayName(day.at)}${tasks.length > 0 ? `, ${String(tasks.length)} due` : ''}`}
            onClick={() => {
              setOpen(true);
            }}
          >
            {day.dayOfMonth}
          </button>
        </Tooltip>
        {day.dayOfMonth === 1 && (
          <span className="cal-month">
            {new Date(day.at).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
          </span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="cal-items">
          {shown.map((task) => (
            <CalendarChip
              key={task.id}
              task={task}
              byId={byId}
              mayMove={mayMove}
              onOpen={onOpen}
              tabbable={false}
            />
          ))}
          {more > 0 && (
            <button
              type="button"
              className="cal-more"
              tabIndex={-1}
              aria-haspopup="dialog"
              onClick={() => {
                setOpen(true);
              }}
            >
              +{more} more
            </button>
          )}
        </div>
      )}

      {open && (
        <DayPanel
          at={day.at}
          tasks={all}
          byId={byId}
          mayMove={mayMove}
          onOpen={(id) => {
            setOpen(false);
            onOpen(id);
          }}
          onMoveTo={onMoveTo}
          onClose={() => {
            setOpen(false);
          }}
          returnTo={cell}
        />
      )}
    </div>
  );
}

/** A day in full, over its cell: every task due, and *Move to…* on each. */
function DayPanel({
  at,
  tasks,
  byId,
  mayMove,
  onOpen,
  onMoveTo,
  onClose,
  returnTo,
}: {
  /** Where focus goes when the day closes: the day, the grid's stop. */
  readonly returnTo: { readonly current: HTMLElement | null };
  readonly at: number;
  readonly tasks: readonly TaskSummary[];
  readonly byId: ReadonlyMap<string, ProjectStatus>;
  readonly mayMove: boolean;
  readonly onOpen: (taskId: string) => void;
  readonly onMoveTo: (task: TaskSummary, dueOn: number) => void;
  readonly onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Held, not depended on: a new `onClose` each render must not re-run the
  // focus hand-off below and pull focus back to the panel.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // Into the list: its first task, or the panel when the day is empty.
    const first = panel.current?.querySelector<HTMLElement>('.cal-task');
    (first ?? panel.current)?.focus();
    const back = returnTo.current;
    const onDown = (event: MouseEvent): void => {
      if (panel.current !== null && !panel.current.contains(event.target as Node)) {
        close.current();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      // Back to the day, whichever control inside it opened the panel.
      back?.focus();
    };
  }, [returnTo]);

  // A task moved off this day takes its row, and the focus in it, with it
  // (LAI-1218): the panel keeps the keyboard, so Escape still closes it.
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) panel.current?.focus();
  });

  return (
    <div
      ref={panel}
      className="cal-panel"
      role="dialog"
      aria-label={`Tasks due ${dayTitle(at)}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="cal-panel-head">
        <h3 className="cal-panel-title">{dayName(at)}</h3>
        <Tooltip content="Close" shortcut="Escape">
          <button type="button" className="cal-panel-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size="small" />
          </button>
        </Tooltip>
      </div>
      {tasks.length === 0 ? (
        <p className="cal-panel-empty">Nothing due.</p>
      ) : (
        <ul className="cal-panel-list">
          {tasks.map((task) => (
            <li key={task.id} className="cal-panel-row">
              <CalendarChip task={task} byId={byId} mayMove={false} onOpen={onOpen} />
              {mayMove && task.due_on !== null && (
                <label className="cal-move">
                  <span className="cal-move-label">Move to</span>
                  <input
                    type="date"
                    className="cal-move-input"
                    defaultValue={msToDateInput(task.due_on)}
                    aria-label={`Move ${task.key} to`}
                    onChange={(event) => {
                      // A date typed a digit at a time passes through years like
                      // 0002 on its way: only a whole, plausible date moves it.
                      const next = dateInputToMs(event.target.value);
                      const year = Number(event.target.value.slice(0, 4));
                      if (next !== null && year >= 2000 && year < 2100) onMoveTo(task, next);
                    }}
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
