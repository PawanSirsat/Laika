import { everyPage } from '../../../api/every-page.ts';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { TaskSummary } from '../../../api/tasks.ts';
import { useTaskSummaries } from '../../../api/use-task-summaries.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
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
import { Icon } from '../../../components/icon/Icon.tsx';
import { useToast } from '../../../components/toast/ToastProvider.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { usePhone } from '../my-day/use-phone.ts';
import { toolbarFilter } from '../board/filter-keys.ts';
import {
  addDays,
  dateOnlyOf,
  dayLabel,
  isGridKey,
  monthOf,
  monthWeeks,
  moveDay,
  nearestDueOutside,
  periodParams,
  placeByDue,
  sameMonth,
  splitOverdue,
  sprintOnDay,
  sprintSegments,
  startOfDay,
  stepMonth,
  weekOf,
  weekParamOf,
  weekStart,
  type CalendarDay as Day,
  type CalendarView,
  type CalendarWeek,
} from './calendar-derive.ts';
import { CalendarChip, CalendarDay } from './CalendarDay.tsx';
import { moveDue } from './calendar-drag.ts';
import { CalendarOverdue } from './CalendarOverdue.tsx';
import './calendar.css';

export interface CalendarScreenProps {
  readonly slug: string | undefined;
  readonly onOpenTask: (taskId: string) => void;
  /**
   * The address: `?month=`, `?view=week&week=`, and the toolbar's filters
   * and search.
   */
  readonly params?: URLSearchParams | undefined;
  /**
   * Go to a period. Each key is the value to write, or `undefined` to drop it:
   * the defaults — month view, this month, this week — are never written.
   */
  readonly onPeriod?:
    | ((period: {
        readonly view: string | undefined;
        readonly month: string | undefined;
        readonly week: string | undefined;
      }) => void)
    | undefined;
}

const WEEKDAYS = [
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
  ['Sun', 'Sunday'],
] as const;

const shortDate = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

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
 *
 * And since LAI-1218, which combines LAI-1200's refinement with it:
 *
 * - **Month or Week**, by a switch, the week held in `?view=week&week=`.
 * - **A grid you drive from the keyboard** (WAI-ARIA grid pattern): one day is
 *   in the tab order, arrows move it, Home and End go to the week's edges,
 *   PageUp and PageDown step a month (a week in Week view), and Enter opens
 *   the day — every task, each with *Move to…*. Moving past the period's edge
 *   pages it.
 * - **Overdue is the lane's alone**, in both views: a late task is never also
 *   flagged on the day it missed.
 */
export function CalendarScreen({ slug, onOpenTask, params, onPeriod }: CalendarScreenProps) {
  // **A failure is a failure** (LAI-1128, kept through the merge train): an
  // empty calendar would say "nothing is due" about a space nobody could read.
  const read = useTaskSummaries(slug);
  /** So a chip can say which column the task is in (LAI-739). */
  const statuses = useProjectStatuses(slug);
  const gates = useGates();
  const phone = usePhone();
  const all: readonly TaskSummary[] | undefined = read.status === 'ok' ? read.tasks : undefined;
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  const [dragging, setDragging] = useState(false);
  // The app's one toast (LAI-1129), with its real Undo (merge train: the
  // calendar's own toast retired so there is one).
  const toast = useToast();
  const now = Date.now();
  const today = startOfDay(now);
  const view: CalendarView = params?.get('view') === 'week' ? 'week' : 'month';
  const month = monthOf(params?.get('month'), now);
  const week = weekParamOf(params?.get('week'), now);
  /** The first day of what is on screen: the month's 1st, or the week's Monday. */
  const period = view === 'month' ? month : week;
  const isNow = view === 'month' ? sameMonth(month, now) : week === weekStart(now);
  const weeks: readonly CalendarWeek[] =
    view === 'month' ? monthWeeks(month, 6, now) : [weekOf(week, now)];
  const days: readonly Day[] = weeks.flatMap((w) => w.days);
  /** Whether a day belongs to the period shown — not merely to the grid's edges. */
  const inPeriod = (at: number): boolean =>
    view === 'month' ? sameMonth(at, month) : weekStart(at) === week;

  /** The focused day; the grid's one tab stop when it is on screen. */
  const [focusAt, setFocusAt] = useState(today);
  const rovingAt = days.some((d) => d.at === focusAt) ? focusAt : inPeriod(today) ? today : period;
  const gridRef = useRef<HTMLDivElement | null>(null);
  /**
   * A day the keyboard moved to, waiting to take DOM focus: held until the
   * period that shows it has rendered, so focus survives the page turn.
   */
  const pendingFocus = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (want === undefined) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-day="${String(want)}"]`);
    if (el === null || el === undefined) return;
    el.focus();
    if (inPeriod(want)) pendingFocus.current = undefined;
  });

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

  /** Show the period holding `at`, in `as` view. */
  const show = useCallback(
    (as: CalendarView, at: number): void => {
      onPeriod?.(periodParams(as, at, Date.now()));
    },
    [onPeriod],
  );

  const go = useCallback(
    (by: number | 'today'): void => {
      if (by === 'today') show(view, Date.now());
      else show(view, view === 'month' ? stepMonth(month, by) : addDays(week, 7 * by));
    },
    [month, week, view, show],
  );

  // ← → page the period, unless something else has the keyboard — the day
  // grid, which moves between days with them, among others.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target instanceof Element && target.closest('[role="grid"]') !== null) return;
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

  if (read.status === 'error') {
    return (
      <div className="cal">
        <ApiErrorState error={read.error} resource="this space’s tasks" onRetry={read.retry} />
      </div>
    );
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
  // Overdue work is the lane's, in both views (LAI-1218): what reaches the
  // grid is due today or later, so no day ever holds a late task.
  const { overdue, rest } = splitOverdue(tasks, now);
  const due = placeByDue(rest, days);
  const shownCount = [...due.byDay]
    .filter(([at]) => inPeriod(at))
    .reduce((n, [, list]) => n + list.length, 0);
  const elsewhere = due.dated - shownCount;
  const monthName = new Date(month).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const firstDay = days[0]?.at ?? week;
  const lastDay = days[days.length - 1]?.at ?? week;
  const weekName = (weeks[0]?.label ?? '').replace('W', 'Week ');
  const heading =
    view === 'month' ? monthName : `${weekName} · ${shortDate(firstDay)} – ${shortDate(lastDay)}`;
  const unit = view;
  const next =
    shownCount === 0 && due.dated > 0
      ? nearestDueOutside(
          rest,
          view === 'month' ? month : firstDay,
          view === 'month' ? stepMonth(month, 1) - 1 : lastDay,
        )
      : undefined;
  const byTaskId = new Map(tasks.map((t) => [t.id, t]));

  const move = (task: TaskSummary, dueOn: number | null): void => {
    const from = task.due_on;
    void moveDue(slug, task, dueOn).then((error) => {
      if (error !== undefined) {
        toast.show({ text: error, tone: 'error' });
        return;
      }
      toast.show({
        text: `${task.key} moved to ${dueOn === null ? 'no date' : dateLabelShort(dueOn)}`,
        tone: 'info',
        // A real reversal: the server puts the date it had back.
        undo: async () => {
          const err = await moveDue(slug, { ...task, due_on: dueOn }, from);
          if (err !== undefined) throw new Error(err);
          return `${task.key} is back on ${from === null ? 'no date' : dateLabelShort(from)}`;
        },
      });
    });
  };
  const dropOn = (taskId: string, at: number): void => {
    const task = byTaskId.get(taskId);
    if (task !== undefined) move(task, dateOnlyOf(at));
  };

  const onGridKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const cell = event.target as HTMLElement;
    // Only the day itself: a key on a chip, or in a day's panel, is theirs.
    if (cell.getAttribute('role') !== 'gridcell') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!isGridKey(event.key)) return;
    event.preventDefault();
    const to = moveDay(Number(cell.dataset.day), event.key, view);
    pendingFocus.current = to;
    setFocusAt(to);
    // Past the period's edge, the period follows the focus.
    if (!inPeriod(to)) show(view, to);
  };

  const switchTo = (as: CalendarView): void => {
    if (as === view) return;
    // The same stretch of time: the week of the focused day, or its month.
    show(as, rovingAt);
  };

  const context = [
    `${String(shownCount)} due in ${view === 'month' ? monthName : weekName.toLowerCase()}`,
    ...(overdue.length > 0 ? [`${String(overdue.length)} overdue`] : []),
    ...(filtered ? ['filtered'] : []),
  ].join(' · ');

  return (
    <div className="cal" data-calendar>
      <SpaceSlot context={context} />

      <div className="cal-toolbar">
        <div className="cal-nav" role="group" aria-label={view === 'month' ? 'Month' : 'Week'}>
          <Tooltip content={`Previous ${unit}`}>
            <button
              type="button"
              className="cal-nav-step"
              aria-label={`Previous ${unit}`}
              onClick={() => {
                go(-1);
              }}
            >
              <Icon name="chevron-left" size="small" />
            </button>
          </Tooltip>
          <button
            type="button"
            className="cal-nav-today"
            aria-label={`Today, ${new Date(today).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}`}
            disabled={isNow}
            onClick={() => {
              go('today');
            }}
          >
            Today
          </button>
          <Tooltip content={`Next ${unit}`}>
            <button
              type="button"
              className="cal-nav-step"
              aria-label={`Next ${unit}`}
              onClick={() => {
                go(1);
              }}
            >
              <Icon name="chevron" size="small" />
            </button>
          </Tooltip>
        </div>
        <h2 className="cal-title" data-cal-month aria-live="polite">
          {heading}
        </h2>
        <div className="cal-switch" role="group" aria-label="Calendar view">
          {(['month', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="cal-switch-option"
              aria-pressed={view === v}
              onClick={() => {
                switchTo(v);
              }}
            >
              {v === 'month' ? 'Month' : 'Week'}
            </button>
          ))}
        </div>
        {due.dated === 0 && overdue.length === 0 ? (
          <p className="cal-note" role="note">
            {filtered
              ? 'Nothing open and dated matches these filters.'
              : 'No open task in this space has a due date. Set one in a task’s details and it appears on its day.'}
          </p>
        ) : (
          shownCount > 0 &&
          elsewhere > 0 && (
            <p className="cal-note" role="note">
              {elsewhere} more open {elsewhere === 1 ? 'task is' : 'tasks are'} due in other{' '}
              {view === 'month' ? 'months' : 'weeks'}.
            </p>
          )
        )}
      </div>

      {/* An empty period says so, neutrally, with the way on (LAI-1200). */}
      {shownCount === 0 && due.dated > 0 && (
        <div className="cal-empty" role="status">
          <p className="cal-empty-title">Nothing due this {unit}</p>
          <p className="cal-empty-body">
            {due.dated} open {due.dated === 1 ? 'task is' : 'tasks are'} due in another {unit}.
          </p>
          {next !== undefined && (
            <button
              type="button"
              className="cal-empty-go"
              onClick={() => {
                show(view, next);
              }}
            >
              {next > lastDay ? 'Go to the next due date' : 'Go to the last due date'},{' '}
              {shortDate(next)}
            </button>
          )}
        </div>
      )}

      <CalendarOverdue
        tasks={overdue}
        byId={statuses.byId}
        // A phone's agenda has no day to drop on: its days reschedule from a task's details.
        mayMove={mayMove && !phone}
        onOpen={onOpenTask}
      />

      {phone ? (
        <CalendarAgenda
          days={days.filter((d) => inPeriod(d.at))}
          unit={unit}
          quiet={shownCount === 0 && due.dated > 0}
          byDay={due.byDay}
          byId={statuses.byId}
          onOpen={onOpenTask}
        />
      ) : (
        <div
          className={view === 'week' ? 'cal-card cal-card-week' : 'cal-card'}
          data-dragging={dragging ? '' : undefined}
        >
          <div
            ref={gridRef}
            role="grid"
            aria-label={`${heading}. Arrow keys move between days, Enter opens a day.`}
            aria-readonly={!mayMove}
            className="cal-grid"
            onKeyDown={onGridKey}
          >
            <div className="cal-head" role="row">
              <div className="cal-gutter cal-gutter-head" role="columnheader">
                <span className="visually-hidden">Week</span>
              </div>
              {WEEKDAYS.map(([short, long]) => (
                <div key={short} className="cal-weekday" role="columnheader" aria-label={long}>
                  {short}
                </div>
              ))}
            </div>

            {weeks.map((row) => {
              const bands = sprintSegments(row.days, sprints);
              return (
                <div key={row.label + String(row.days[0]?.at ?? 0)} className="cal-week" role="row">
                  <div className="cal-gutter" role="rowheader">
                    {row.label}
                  </div>
                  {bands.length > 0 && (
                    <div className="cal-bands" aria-hidden="true">
                      {bands.map((b) => (
                        <Tooltip
                          key={b.id}
                          content={`${b.name}${b.running ? ' · running' : ''}`}
                          lazy
                        >
                          <span
                            className="cal-band"
                            data-running={b.running ? '' : undefined}
                            style={{ gridColumn: `${String(b.from + 2)} / ${String(b.to + 3)}` }}
                          >
                            {b.starts || b.from === 0 ? b.name : ''}
                          </span>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                  {row.days.map((day, col) => {
                    const list = due.byDay.get(day.at) ?? [];
                    const sprint = sprintOnDay(day.at, sprints);
                    return (
                      <CalendarDay
                        key={day.at}
                        day={day}
                        cap={view === 'week' ? Number.POSITIVE_INFINITY : undefined}
                        label={dayLabel(day.at, {
                          tasks: list.length,
                          today: day.isToday,
                          sprint:
                            sprint === undefined
                              ? undefined
                              : `${sprint.tag} ${sprint.sprint.name}${sprint.running ? ', running' : ''}`,
                        })}
                        tabStop={day.at === rovingAt}
                        onFocusDay={setFocusAt}
                        end={col >= 5}
                        tasks={list}
                        byId={statuses.byId}
                        mayMove={mayMove}
                        dragging={dragging}
                        onOpen={onOpenTask}
                        onDrop={dropOn}
                        onMoveTo={move}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>

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
                ? 'Click a task to open it, drag it to another day to reschedule. Arrow keys move between days; Enter opens a day to move its tasks.'
                : 'An open task appears on the day it is due. Arrow keys move between days; Enter opens one.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** A phone's month (LAI-1178): the days of it that hold work, as a list. */
function CalendarAgenda({
  days: period,
  unit,
  quiet,
  byDay,
  byId,
  onOpen,
}: {
  /** The period's days — a month's, or a week's. */
  readonly days: readonly Day[];
  readonly unit: CalendarView;
  /** The empty period already says so above. */
  readonly quiet: boolean;
  readonly byDay: ReadonlyMap<number, readonly TaskSummary[]>;
  readonly byId: Parameters<typeof CalendarChip>[0]['byId'];
  readonly onOpen: (taskId: string) => void;
}) {
  const days = period.filter((d) => (byDay.get(d.at)?.length ?? 0) > 0);
  if (days.length === 0) {
    return quiet ? null : <p className="cal-agenda-empty">Nothing due this {unit}.</p>;
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
