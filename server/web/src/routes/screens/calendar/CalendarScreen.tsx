import { everyPage } from '../../../api/every-page.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskSummary } from '../../../api/tasks.ts';
import { useProjectTasks } from '../../../api/use-project-tasks.ts';
import { useProjectStatuses } from '../../../api/use-statuses.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { matchesSearch } from '../../../api/board-derive.ts';
import { useGates } from '../../../api/permissions.ts';
import { applyTaskFilter } from '../../../api/task-filter.ts';
import { dateLabelShort } from '../../../api/date-only.ts';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { typingIn } from '../../../components/typing-in.ts';
import { usePhone } from '../my-day/use-phone.ts';
import { toolbarFilter } from '../board/filter-keys.ts';
import {
  dateOnlyOf,
  monthOf,
  monthParam,
  monthWeeks,
  placeByDue,
  sameMonth,
  splitOverdue,
  sprintSegments,
  stepMonth,
} from './calendar-derive.ts';
import { CalendarChip, CalendarDay } from './CalendarDay.tsx';
import { moveDue } from './calendar-drag.ts';
import { CalendarOverdue } from './CalendarOverdue.tsx';
import './calendar.css';

export interface CalendarScreenProps {
  readonly slug: string | undefined;
  readonly onOpenTask: (taskId: string) => void;
  /** The address: `?month=`, and the toolbar's filters and search. */
  readonly params?: URLSearchParams | undefined;
  /** Page to a month (`YYYY-MM`), or back to this one with `undefined`. */
  readonly onMonth?: ((month: string | undefined) => void) | undefined;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Said {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'error';
  readonly undo?: (() => void) | undefined;
}

/**
 * Open tasks laid out by the day they are due (D-059; reworked by LAI-1178,
 * the owner's *"this calendar is not that good"*).
 *
 * **The dates are the tasks' own `due_on`** (D-066, LAI-819), and the sprint
 * bands come from `GET /projects/:slug/sprints`. Since LAI-1178:
 *
 * - **Any month**, by ‹ Today › and ← →, held in `?month=`.
 * - **Overdue apart**: open work due before today sits in a lane above the
 *   grid instead of piling on the days it missed.
 * - **Every day one height**: three chips, then *+N more* and the day in full.
 * - **A sprint is one band per week** with its name, not `S9` in every cell.
 * - **The toolbar's filters and search apply** — they were drawn over this
 *   tab and changed nothing.
 * - **Drag a chip to a day** to move its due date, with Undo; the day's
 *   *Move to…* does the same from the keyboard. Only for a reader who may
 *   write tasks here (`task.write`).
 * - **A phone reads the month as an agenda**, the days that hold work only.
 */
export function CalendarScreen({ slug, onOpenTask, params, onMonth }: CalendarScreenProps) {
  const set = useProjectTasks(slug);
  /** So a chip can say which column the task is in (LAI-739). */
  const statuses = useProjectStatuses(slug);
  const gates = useGates();
  const phone = usePhone();
  const all = useMemo(
    (): readonly TaskSummary[] | undefined =>
      set?.status === 'ready'
        ? set.tasks.filter((t): t is TaskSummary => !('deleted' in t))
        : set?.status === 'error'
          ? []
          : undefined,
    [set?.status, set?.tasks],
  );
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  const [dragging, setDragging] = useState(false);
  const [said, setSaid] = useState<Said | undefined>(undefined);
  const now = Date.now();
  const month = monthOf(params?.get('month'), now);
  const isThisMonth = sameMonth(month, now);

  const search = params?.get('q') ?? '';
  const filter = useMemo(() => toolbarFilter(params ?? new URLSearchParams()), [params]);
  const filtered = Object.keys(filter).length > 0 || search.trim() !== '';
  const tasks = useMemo(() => {
    if (all === undefined) return undefined;
    const needle = search.trim().toLowerCase();
    const narrowed = applyTaskFilter(all, filter);
    return needle === '' ? narrowed : narrowed.filter((t) => matchesSearch(t, needle));
  }, [all, filter, search]);

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    everyPage((cursor) =>
      listSprints(slug, cursor === undefined ? {} : { cursor }, controller.signal),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703).
        if (!controller.signal.aborted) setSprints(items);
      })
      .catch(() => {
        // No sprint bands beats wrong ones — the rule the badge counts follow.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);

  // A word after a move, gone after a while; an error stays until dismissed.
  useEffect(() => {
    if (said === undefined || said.tone === 'error') return;
    const timer = setTimeout(() => {
      setSaid((s) => (s?.id === said.id ? undefined : s));
    }, 8000);
    return () => {
      clearTimeout(timer);
    };
  }, [said]);

  // The drag is over wherever it was let go.
  useEffect(() => {
    const end = (): void => {
      setDragging(false);
    };
    const start = (event: DragEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('.cal-task') !== null) setDragging(true);
    };
    document.addEventListener('dragstart', start);
    document.addEventListener('dragend', end);
    document.addEventListener('drop', end);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', end);
      document.removeEventListener('drop', end);
    };
  }, []);

  const go = useCallback(
    (by: number | 'today'): void => {
      if (onMonth === undefined) return;
      if (by === 'today') onMonth(undefined);
      else {
        const next = stepMonth(month, by);
        onMonth(sameMonth(next, Date.now()) ? undefined : monthParam(next));
      }
    },
    [month, onMonth],
  );

  // ← → page the months, unless something else has the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (
        typingIn(
          target === null
            ? null
            : { tagName: target.tagName, isContentEditable: target.isContentEditable },
        )
      ) {
        return;
      }
      if (params?.get('task') !== null && params?.get('task') !== undefined) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      go(event.key === 'ArrowRight' ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [go, params]);

  if (slug === undefined) {
    return <EmptyState headline="No space chosen" body="Pick a space to see its calendar." />;
  }

  if (tasks === undefined) {
    return (
      <div className="cal">
        <LoadingState shape="card" count={2} label="Loading the calendar" />
      </div>
    );
  }

  const projectId = tasks[0]?.project_id ?? all?.[0]?.project_id;
  const mayMove = projectId !== undefined && gates.project(projectId, 'task.write');
  const weeks = monthWeeks(month, 6, now);
  const { overdue, rest } = splitOverdue(tasks, now);
  const due = placeByDue(
    rest,
    weeks.flatMap((w) => w.days),
  );
  const inMonth = [...due.byDay]
    .filter(([at]) => sameMonth(at, month))
    .reduce((n, [, list]) => n + list.length, 0);
  const elsewhere = due.dated - inMonth;
  const monthName = new Date(month).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const byTaskId = new Map(tasks.map((t) => [t.id, t]));

  const move = (task: TaskSummary, dueOn: number | null): void => {
    const from = task.due_on;
    void moveDue(slug, task, dueOn).then((error) => {
      if (error !== undefined) {
        setSaid({ id: Date.now(), text: error, tone: 'error' });
        return;
      }
      setSaid({
        id: Date.now(),
        text: `${task.key} moved to ${dueOn === null ? 'no date' : dateLabelShort(dueOn)}`,
        tone: 'info',
        undo: () => {
          setSaid(undefined);
          void moveDue(slug, { ...task, due_on: dueOn }, from).then((err) => {
            if (err !== undefined) setSaid({ id: Date.now(), text: err, tone: 'error' });
          });
        },
      });
    });
  };
  const dropOn = (taskId: string, at: number): void => {
    const task = byTaskId.get(taskId);
    if (task !== undefined) move(task, dateOnlyOf(at));
  };

  const context = [
    `${String(inMonth)} due in ${monthName}`,
    ...(overdue.length > 0 ? [`${String(overdue.length)} overdue`] : []),
    ...(filtered ? ['filtered'] : []),
  ].join(' · ');

  return (
    <div className="cal" data-calendar>
      <SpaceSlot context={context} />

      <div className="cal-toolbar">
        <div className="cal-nav" role="group" aria-label="Month">
          <button
            type="button"
            className="cal-nav-step"
            aria-label="Previous month"
            onClick={() => {
              go(-1);
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="cal-nav-today"
            disabled={isThisMonth}
            onClick={() => {
              go('today');
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="cal-nav-step"
            aria-label="Next month"
            onClick={() => {
              go(1);
            }}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <h2 className="cal-title" data-cal-month>
          {monthName}
        </h2>
        {due.dated === 0 && overdue.length === 0 ? (
          <p className="cal-note" role="note">
            {filtered
              ? 'Nothing open and dated matches these filters.'
              : 'No open task in this space has a due date. Set one in a task’s details and it appears on its day.'}
          </p>
        ) : (
          elsewhere > 0 && (
            <p className="cal-note" role="note">
              {elsewhere} more open {elsewhere === 1 ? 'task is' : 'tasks are'} due in other months.
            </p>
          )
        )}
      </div>

      <CalendarOverdue
        tasks={overdue}
        byId={statuses.byId}
        // A phone's agenda has no day to drop on: its days reschedule from a task's details.
        mayMove={mayMove && !phone}
        onOpen={onOpenTask}
      />

      {phone ? (
        <CalendarAgenda
          weeks={weeks}
          month={month}
          byDay={due.byDay}
          byId={statuses.byId}
          onOpen={onOpenTask}
        />
      ) : (
        <div className="cal-card" data-dragging={dragging ? '' : undefined}>
          <div className="cal-head">
            <div className="cal-gutter cal-gutter-head" />
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-weekday">
                {d}
              </div>
            ))}
          </div>

          {weeks.map((week) => {
            const bands = sprintSegments(week.days, sprints);
            return (
              <div key={week.label + String(week.days[0]?.at ?? 0)} className="cal-week">
                <div className="cal-gutter">{week.label}</div>
                {bands.length > 0 && (
                  <div className="cal-bands" aria-hidden="true">
                    {bands.map((b) => (
                      <span
                        key={b.id}
                        className="cal-band"
                        data-running={b.running ? '' : undefined}
                        style={{ gridColumn: `${String(b.from + 2)} / ${String(b.to + 3)}` }}
                        title={`${b.name}${b.running ? ' · running' : ''}`}
                      >
                        {b.starts || b.from === 0 ? b.name : ''}
                      </span>
                    ))}
                  </div>
                )}
                {week.days.map((day, col) => (
                  <CalendarDay
                    key={day.at}
                    day={day}
                    end={col >= 5}
                    tasks={due.byDay.get(day.at) ?? []}
                    byId={statuses.byId}
                    mayMove={mayMove}
                    dragging={dragging}
                    onOpen={onOpenTask}
                    onDrop={dropOn}
                    onMoveTo={move}
                  />
                ))}
              </div>
            );
          })}

          <div className="cal-legend">
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-today" aria-hidden="true" />
              today
            </span>
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-p1" aria-hidden="true" />
              P1
            </span>
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-p2" aria-hidden="true" />
              P2
            </span>
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-sprint" aria-hidden="true" />
              sprint
            </span>
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-agent" aria-hidden="true" />
              agent-owned
            </span>
            <span className="cal-legend-note">
              {mayMove
                ? 'Click a task to open it, drag it to another day to reschedule.'
                : 'An open task appears on the day it is due. Click one to open it.'}
            </span>
          </div>
        </div>
      )}

      {said !== undefined && (
        <div
          className="cal-toast"
          data-tone={said.tone}
          role={said.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{said.text}</span>
          {said.undo !== undefined && (
            <button type="button" className="cal-toast-undo" onClick={said.undo}>
              Undo
            </button>
          )}
          <button
            type="button"
            className="cal-toast-close"
            aria-label="Dismiss"
            onClick={() => {
              setSaid(undefined);
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** A phone's month (LAI-1178): the days of it that hold work, as a list. */
function CalendarAgenda({
  weeks,
  month,
  byDay,
  byId,
  onOpen,
}: {
  readonly weeks: ReturnType<typeof monthWeeks>;
  readonly month: number;
  readonly byDay: ReadonlyMap<number, readonly TaskSummary[]>;
  readonly byId: Parameters<typeof CalendarChip>[0]['byId'];
  readonly onOpen: (taskId: string) => void;
}) {
  const days = weeks
    .flatMap((w) => w.days)
    .filter((d) => sameMonth(d.at, month) && (byDay.get(d.at)?.length ?? 0) > 0);
  if (days.length === 0) {
    return <p className="cal-agenda-empty">Nothing due this month.</p>;
  }
  return (
    <ol className="cal-agenda" data-cal-agenda>
      {days.map((d) => (
        <li key={d.at} className="cal-agenda-day" data-today={d.isToday ? '' : undefined}>
          <h3 className="cal-agenda-date">
            {new Date(d.at).toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </h3>
          <div className="cal-agenda-items">
            {(byDay.get(d.at) ?? []).map((t) => (
              <CalendarChip key={t.id} task={t} byId={byId} mayMove={false} onOpen={onOpen} />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
