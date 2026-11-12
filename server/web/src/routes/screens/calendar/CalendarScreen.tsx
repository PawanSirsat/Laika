import { everyPage } from '../../../api/every-page.ts';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { TaskSummary } from '../../../api/tasks.ts';
import { useTaskSummaries } from '../../../api/use-task-summaries.ts';
import { statusNameOf } from '../../../api/status-derive.ts';
import { useProjectStatuses } from '../../../api/use-statuses.ts';
import { isOverdue } from '../../../api/date-only.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import {
  addDays,
  addMonths,
  dayLabel,
  isGridKey,
  monthWeeks,
  moveDay,
  nearestDueOutside,
  placeByDue,
  sprintOnDay,
  startOfDay,
  weekOf,
  type CalendarDay,
  type CalendarWeek,
} from './calendar-derive.ts';
import './calendar.css';

export interface CalendarScreenProps {
  readonly slug: string | undefined;
  readonly onOpenTask: (taskId: string) => void;
}

type CalendarView = 'month' | 'week';

const WEEKDAYS = [
  ['MON', 'Monday'],
  ['TUE', 'Tuesday'],
  ['WED', 'Wednesday'],
  ['THU', 'Thursday'],
  ['FRI', 'Friday'],
  ['SAT', 'Saturday'],
  ['SUN', 'Sunday'],
] as const;

/**
 * How many chips a month cell draws before it says `+N more` (LAI-1200).
 * Three fit the cell's floor; a fourth would grow the row and shove every
 * week under it down. When there are more, two chips and the `+N more`
 * line take the same room as three chips.
 */
const CHIPS_PER_CELL = 3;

/**
 * Below this the grid's seven columns are too narrow to read a chip, so the
 * period is drawn as an agenda — the days that have work, in order (LAI-1200).
 */
const AGENDA_QUERY = '(max-width: 640px)';

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => {
      setMatches(list.matches);
    };
    onChange();
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, [query]);
  return matches;
}

const shortDate = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Open tasks laid out by the day they are due (D-059, prototype lines 581–624).
 *
 * **The dates are the tasks' own `due_on`** (D-066, LAI-819). The screen was
 * built before the field existed and took its dates from a demo module, which
 * a production build switches off — so production placed nothing, under a
 * notice saying there was no due date to read. The module is gone; what is on
 * the grid is what the tasks say.
 *
 * **The sprint bands are real.** Sprints have dates, so the days inside each
 * sprint carry a band from `GET /projects/:slug/sprints`.
 *
 * **Red means overdue, and nothing else** (LAI-1200, visual audit #12). The
 * running sprint's days were tinted the overdue palette, so an ordinary week
 * read as late and the chips that really were late got lost in it. A sprint is
 * now a calm band across the top of its days, and priority is a label, not a
 * tint.
 *
 * **A grid you can drive from the keyboard** (WAI-ARIA grid pattern): one day
 * is in the tab order, arrows move it, Home and End go to the week's edges,
 * PageUp and PageDown change month, Enter opens the day.
 */
export function CalendarScreen({ slug, onOpenTask }: CalendarScreenProps) {
  /*
   * The project's one task set (LAI-724) — shared with every other tab and
   * live through the store, where this screen used to walk it on every visit.
   * **A failure is a failure** (LAI-1128): it was an empty calendar, which
   * says "nothing is due" about a space nobody could read.
   */
  const read = useTaskSummaries(slug);
  /** So a chip can say which column the task is in (LAI-739). */
  const statuses = useProjectStatuses(slug);
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  const now = Date.now();
  const today = startOfDay(now);

  const [view, setView] = useState<CalendarView>('month');
  /** The focused day. The period on screen is whatever contains it. */
  const [focusAt, setFocusAt] = useState(today);
  /** The day whose full list is open, and the element it opened from. */
  const [dayList, setDayList] = useState<
    { readonly at: number; readonly anchor: HTMLElement } | undefined
  >(undefined);
  const agenda = useMatches(AGENDA_QUERY);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Set by a key press, so a re-render moves DOM focus and a click does not. */
  const pendingFocus = useRef(false);

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    everyPage((cursor) =>
      listSprints(slug, cursor === undefined ? {} : { cursor }, controller.signal),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703); `page.data` is the whole list.
        const page = { data: items };
        if (!controller.signal.aborted) setSprints(page.data);
      })
      .catch(() => {
        // No sprint bands beats wrong ones — the rule the badge counts follow.
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${String(focusAt)}"]`)?.focus();
  }, [focusAt, view]);

  const cellFor = useCallback(
    (at: number) => gridRef.current?.querySelector<HTMLElement>(`[data-day="${String(at)}"]`),
    [],
  );

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

  if (read.status === 'loading') {
    return (
      <div className="cal">
        <LoadingState shape="card" count={2} label="Loading the calendar" />
      </div>
    );
  }

  const { tasks } = read;

  const weeks: readonly CalendarWeek[] =
    view === 'month' ? monthWeeks(focusAt, 6, now) : [weekOf(focusAt, now)];
  const days: readonly CalendarDay[] = weeks.flatMap((w) => w.days);
  const first = days[0]?.at ?? focusAt;
  const last = days[days.length - 1]?.at ?? focusAt;
  const due = placeByDue(tasks, days);
  const overdueOf = (list: readonly TaskSummary[]): number =>
    list.filter((t) => isOverdue(t, now)).length;

  const monthName = new Date(focusAt).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const heading =
    view === 'month'
      ? monthName
      : `${weeks[0]?.label.replace('W', 'Week ') ?? ''} · ${shortDate(first)} – ${shortDate(last)}`;
  const unit = view === 'month' ? 'month' : 'week';

  const go = (at: number): void => {
    setDayList(undefined);
    setFocusAt(startOfDay(at));
  };

  const openTask = (id: string): void => {
    onOpenTask(id);
  };

  const openDay = (at: number, anchor: HTMLElement): void => {
    const list = due.byDay.get(at) ?? [];
    const only = list.length === 1 ? list[0] : undefined;
    if (only !== undefined) openTask(only.id);
    else if (list.length > 1) setDayList({ at, anchor });
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const cell = e.target as HTMLElement;
    // Only the day itself: Enter on a chip inside it is the chip's own click.
    if (cell.getAttribute('role') !== 'gridcell') return;
    const at = Number(cell.dataset.day);
    if (isGridKey(e.key)) {
      e.preventDefault();
      pendingFocus.current = true;
      setDayList(undefined);
      setFocusAt(moveDay(at, e.key));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDay(at, cell);
    }
  };

  const chip = (task: TaskSummary, tabbable: boolean) => {
    const overdue = isOverdue(task, now);
    const status = statusNameOf(task, statuses.byId);
    return (
      <button
        key={task.id}
        type="button"
        className={overdue ? 'cal-task cal-task-overdue' : 'cal-task'}
        tabIndex={tabbable ? 0 : -1}
        aria-label={`${task.key} ${task.title}, ${status}, priority ${task.priority.toUpperCase()}${
          overdue ? ', overdue' : ''
        }${task.created_via === 'mcp' ? ', filed by an agent' : ''}`}
        onClick={() => {
          openTask(task.id);
        }}
        title={`${task.key} — ${task.title} · ${status}`}
      >
        <span className="cal-task-line">
          <span className="cal-task-key">{task.key}</span>
          <span className="cal-task-title">{task.title}</span>
          {task.created_via === 'mcp' && <span className="cal-task-agent" aria-hidden="true" />}
        </span>
        <span className="cal-task-line cal-task-meta">
          {/* Its status, as the project calls it, in its kind's colour (LAI-739
              review round 1). */}
          <span className={`cal-task-status cal-status-${task.status}`}>
            {statusNameOf(task, statuses.byId)}
          </span>
          <span className={`cal-task-pri cal-pri-${task.priority}`}>
            {task.priority.toUpperCase()}
          </span>
          {overdue && <span className="cal-task-flag">Overdue</span>}
        </span>
      </button>
    );
  };

  /** Where focus may enter the grid: the focused day if shown, else today or the first day. */
  const rovingAt = days.some((d) => d.at === focusAt)
    ? focusAt
    : days.some((d) => d.at === today)
      ? today
      : first;

  const next =
    due.placed === 0 && due.dated > 0 ? nearestDueOutside(tasks, first, last) : undefined;

  return (
    <div className="cal">
      <SpaceSlot
        context={`${String(due.placed)} open ${due.placed === 1 ? 'task' : 'tasks'} placed · ${monthName}`}
      />

      <div className="cal-bar">
        <div className="cal-nav">
          <button
            type="button"
            className="cal-btn cal-btn-icon"
            aria-label={`Previous ${unit}`}
            title={`Previous ${unit}`}
            onClick={() => {
              go(view === 'month' ? addMonths(focusAt, -1) : addDays(focusAt, -7));
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <h2 className="cal-title" aria-live="polite">
            {heading}
          </h2>
          <button
            type="button"
            className="cal-btn cal-btn-icon"
            aria-label={`Next ${unit}`}
            title={`Next ${unit}`}
            onClick={() => {
              go(view === 'month' ? addMonths(focusAt, 1) : addDays(focusAt, 7));
            }}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div className="cal-tools">
          <button
            type="button"
            className="cal-btn"
            aria-label={`Today, ${new Date(today).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}`}
            disabled={focusAt === today}
            onClick={() => {
              go(today);
            }}
          >
            Today
          </button>
          <div className="cal-switch" role="group" aria-label="Calendar view">
            {(['month', 'week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="cal-switch-option"
                aria-pressed={view === v}
                onClick={() => {
                  setDayList(undefined);
                  setView(v);
                }}
              >
                {v === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Only what is true of this space: nothing dated at all, or dates this
          period does not reach (LAI-819). */}
      {due.dated === 0 ? (
        <p className="cal-note" role="note">
          No open task in this space has a due date. Set one in a task’s details and it appears on
          its day.
        </p>
      ) : due.placed === 0 ? (
        <div className="cal-empty" role="status">
          <p className="cal-empty-title">Nothing due this {unit}</p>
          <p className="cal-empty-body">
            {due.outside} open {due.outside === 1 ? 'task is' : 'tasks are'} due in another {unit}.
          </p>
          {next !== undefined && (
            <button
              type="button"
              className="cal-btn cal-btn-primary"
              onClick={() => {
                go(next);
              }}
            >
              {next > last ? 'Go to the next due date' : 'Go to the last due date'},{' '}
              {shortDate(next)}
            </button>
          )}
        </div>
      ) : (
        due.outside > 0 && (
          <p className="cal-note" role="note">
            {due.outside} more open {due.outside === 1 ? 'task is' : 'tasks are'} due outside{' '}
            {view === 'month' ? 'these six weeks' : 'this week'}.
          </p>
        )
      )}

      {agenda ? (
        <ol className="cal-agenda" aria-label={`Agenda, ${heading}`}>
          {days
            .filter((d) => (due.byDay.get(d.at)?.length ?? 0) > 0 || d.isToday)
            .map((day) => {
              const list = due.byDay.get(day.at) ?? [];
              const sprint = sprintOnDay(day.at, sprints);
              return (
                <li
                  key={day.at}
                  className={day.isToday ? 'cal-agenda-day cal-agenda-today' : 'cal-agenda-day'}
                >
                  <h3 className="cal-agenda-date">
                    <span>
                      {new Date(day.at).toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    {day.isToday && <span className="cal-agenda-badge">Today</span>}
                    {sprint !== undefined && (
                      <span
                        className={
                          sprint.running
                            ? 'cal-agenda-sprint cal-agenda-sprint-now'
                            : 'cal-agenda-sprint'
                        }
                      >
                        {sprint.tag} · {sprint.sprint.name}
                      </span>
                    )}
                  </h3>
                  {list.length === 0 ? (
                    <p className="cal-agenda-none">Nothing due today.</p>
                  ) : (
                    <div className="cal-items">{list.map((t) => chip(t, true))}</div>
                  )}
                </li>
              );
            })}
        </ol>
      ) : (
        <div className="cal-scroll">
          <div className={view === 'week' ? 'cal-card cal-card-week' : 'cal-card'}>
            <div
              ref={gridRef}
              role="grid"
              aria-label={`${heading}. Arrow keys move between days, Enter opens a day.`}
              aria-readonly="true"
              className="cal-grid"
              onKeyDown={onGridKey}
            >
              <div role="row" className="cal-head">
                {/* The design's 46px gutter, empty in the header row. */}
                <div role="columnheader" className="cal-gutter cal-gutter-head">
                  <span className="visually-hidden">Week</span>
                </div>
                {WEEKDAYS.map(([short, long]) => (
                  <div key={short} role="columnheader" className="cal-weekday" aria-label={long}>
                    {short}
                  </div>
                ))}
              </div>

              {weeks.map((week) => (
                <div
                  key={week.label + String(week.days[0]?.at ?? 0)}
                  role="row"
                  className="cal-week"
                >
                  <div role="rowheader" className="cal-gutter">
                    {week.label}
                  </div>

                  {week.days.map((day, column) => {
                    const list = due.byDay.get(day.at) ?? [];
                    const sprint = sprintOnDay(day.at, sprints);
                    const overdue = overdueOf(list);
                    const classes = ['cal-day'];
                    if (!day.inMonth && view === 'month') classes.push('cal-day-out');
                    if (day.isWeekend) classes.push('cal-day-weekend');
                    if (day.isToday) classes.push('cal-day-today');
                    if (day.at < today) classes.push('cal-day-past');
                    const capped = view === 'month' && list.length > CHIPS_PER_CELL;
                    const shown = capped ? list.slice(0, CHIPS_PER_CELL - 1) : list;

                    return (
                      <div
                        key={day.at}
                        role="gridcell"
                        data-day={day.at}
                        tabIndex={day.at === rovingAt ? 0 : -1}
                        aria-label={dayLabel(day.at, {
                          tasks: list.length,
                          overdue,
                          today: day.isToday,
                          sprint:
                            sprint === undefined
                              ? undefined
                              : `${sprint.tag} ${sprint.sprint.name}${sprint.running ? ', running' : ''}`,
                        })}
                        aria-current={day.isToday ? 'date' : undefined}
                        className={classes.join(' ')}
                        onFocus={(e) => {
                          // A click inside the day makes it the roving stop.
                          if (e.target === e.currentTarget && day.at !== focusAt)
                            setFocusAt(day.at);
                        }}
                      >
                        <div className="cal-day-head">
                          <span className="cal-date">{day.dayOfMonth}</span>
                          {/* The month names itself on its first day, as the
                              design does — otherwise a grid spanning three
                              months gives a reader no way to tell which `1` is
                              which. */}
                          {day.dayOfMonth === 1 && (
                            <span className="cal-month">
                              {new Date(day.at)
                                .toLocaleDateString(undefined, { month: 'short' })
                                .toUpperCase()}
                            </span>
                          )}
                          {day.isToday && <span className="cal-today-word">Today</span>}
                        </div>

                        {sprint !== undefined && (
                          <div
                            aria-hidden="true"
                            className={[
                              'cal-band',
                              sprint.running ? 'cal-band-now' : '',
                              sprint.first ? 'cal-band-first' : '',
                              sprint.last ? 'cal-band-last' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {(sprint.first || column === 0) && (
                              <span className="cal-band-label">
                                {sprint.tag} · {sprint.sprint.name}
                              </span>
                            )}
                          </div>
                        )}

                        {list.length > 0 && (
                          <div className="cal-items">
                            {shown.map((t) => chip(t, false))}
                            {capped && (
                              <button
                                type="button"
                                className="cal-more"
                                tabIndex={-1}
                                aria-haspopup="dialog"
                                aria-label={`${String(list.length - shown.length)} more tasks on ${shortDate(day.at)}, show all ${String(list.length)}`}
                                onClick={(e) => {
                                  setFocusAt(day.at);
                                  setDayList({
                                    at: day.at,
                                    anchor: cellFor(day.at) ?? e.currentTarget,
                                  });
                                }}
                              >
                                +{list.length - shown.length} more
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* The design's legend (prototype lines 616–621). */}
            <div className="cal-legend">
              <span className="cal-legend-item">
                <span className="cal-swatch cal-swatch-today" aria-hidden="true" />
                today
              </span>
              <span className="cal-legend-item">
                <span className="cal-swatch cal-swatch-sprint" aria-hidden="true" />
                active sprint
              </span>
              <span className="cal-legend-item">
                <span className="cal-swatch cal-swatch-overdue" aria-hidden="true" />
                overdue
              </span>
              <span className="cal-legend-item">
                <span className="cal-swatch cal-swatch-agent" aria-hidden="true" />
                filed by an agent
              </span>
              <span className="cal-legend-note">
                An open task appears on the day it is due. Arrow keys move between days; Enter opens
                one.
              </span>
            </div>
          </div>
        </div>
      )}

      {dayList !== undefined && (
        <DayList
          at={dayList.at}
          anchor={dayList.anchor}
          tasks={due.byDay.get(dayList.at) ?? []}
          overdue={overdueOf(due.byDay.get(dayList.at) ?? [])}
          renderChip={(t) => chip(t, true)}
          onClose={(refocus) => {
            setDayList(undefined);
            if (refocus) cellFor(dayList.at)?.focus();
          }}
          onPick={() => {
            // The drawer returns focus to whatever had it when it opened, and
            // this list is about to go — so hand that to the day first.
            cellFor(dayList.at)?.focus();
            setDayList(undefined);
          }}
        />
      )}
    </div>
  );
}

interface DayListProps {
  readonly at: number;
  readonly anchor: HTMLElement;
  readonly tasks: readonly TaskSummary[];
  readonly overdue: number;
  readonly renderChip: (task: TaskSummary) => ReactNode;
  readonly onClose: (refocus: boolean) => void;
  readonly onPick: () => void;
}

/**
 * Every task due on one day, opened from `+N more` or Enter on a busy day.
 * A non-modal popover beside the day: Escape returns to the day, a press
 * elsewhere or scrolling the page closes it.
 */
function DayList({ at, anchor, tasks, overdue, renderChip, onClose, onPick }: DayListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const height = ref.current?.offsetHeight ?? 240;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 4;
    const top =
      below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 4);
    setPlace({ top, left });
  }, [anchor]);

  // Once placed: it is `visibility: hidden` until then, which refuses focus.
  // Tried until it takes, a few frames at most: a global reduced-motion rule
  // that transitions every property (LAI-1132's) keeps `visibility` hidden
  // for a frame or two, and a refused focus() fails silently (merge train).
  const placed = place !== undefined;
  useEffect(() => {
    if (!placed) return;
    let frame = 0;
    const attempt = (left: number): void => {
      const first = ref.current?.querySelector<HTMLElement>('.cal-task');
      first?.focus();
      if (first !== null && first !== undefined && document.activeElement !== first && left > 0) {
        frame = requestAnimationFrame(() => {
          attempt(left - 1);
        });
      }
    };
    attempt(10);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [placed]);

  useEffect(() => {
    const outside = (e: Event): void => {
      if (e.target instanceof Node && ref.current?.contains(e.target) === true) return;
      onClose(false);
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', outside);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', outside);
    };
  }, [onClose]);

  const label = dayLabel(at, { tasks: tasks.length, overdue, today: false });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Tasks due ${label}`}
      className="cal-daylist"
      style={place === undefined ? { visibility: 'hidden' } : { top: place.top, left: place.left }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose(true);
        }
      }}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('.cal-task') !== null) onPick();
      }}
    >
      <div className="cal-daylist-head">
        <p className="cal-daylist-title">
          {new Date(at).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <button
          type="button"
          className="cal-btn cal-btn-icon"
          aria-label="Close"
          onClick={() => {
            onClose(true);
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="cal-items cal-daylist-items">{tasks.map((t) => renderChip(t))}</div>
    </div>
  );
}
