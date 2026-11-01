import { everyPage } from '../../../api/every-page.ts';
import { useEffect, useMemo, useState } from 'react';
import type { TaskSummary } from '../../../api/tasks.ts';
import { useProjectTasks } from '../../../api/use-project-tasks.ts';
import { statusNameOf } from '../../../api/status-derive.ts';
import { useProjectStatuses } from '../../../api/use-statuses.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { localDay, monthWeeks, placeByDue } from './calendar-derive.ts';
import './calendar.css';

export interface CalendarScreenProps {
  readonly slug: string | undefined;
  readonly onOpenTask: (taskId: string) => void;
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Open tasks laid out by the day they are due (D-059, prototype lines 581–624).
 *
 * **The dates are the tasks' own `due_on`** (D-066, LAI-819). The screen was
 * built before the field existed and took its dates from a demo module, which
 * a production build switches off — so production placed nothing, under a
 * notice saying there was no due date to read. The module is gone; what is on
 * the grid is what the tasks say.
 *
 * **The sprint bands are real.** Sprints have dates, so the days inside the
 * running sprint are marked from `GET /projects/:slug/sprints`.
 */
export function CalendarScreen({ slug, onOpenTask }: CalendarScreenProps) {
  /*
   * The project's one task set (LAI-724) — shared with every other tab and
   * live through the store, where this screen used to walk it on every visit.
   * A failure is an empty calendar, as it was.
   */
  const set = useProjectTasks(slug);
  /** So a chip can say which column the task is in (LAI-739). */
  const statuses = useProjectStatuses(slug);
  const tasks = useMemo(
    (): readonly TaskSummary[] | undefined =>
      set?.status === 'ready'
        ? set.tasks.filter((t): t is TaskSummary => !('deleted' in t))
        : set?.status === 'error'
          ? []
          : undefined,
    [set?.status, set?.tasks],
  );
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  const now = Date.now();

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

  const weeks = monthWeeks(now);
  const due = placeByDue(
    tasks,
    weeks.flatMap((w) => w.days),
  );

  /** `S2` for a day inside a sprint, in the design's top-right corner. */
  const sprintOn = (
    at: number,
  ): { readonly tag: string; readonly running: boolean } | undefined => {
    const index = sprints.findIndex(
      // Date-only UTC midnights, read as the local day they name (LAI-819) —
      // the same reading a due date gets, so a task due on a sprint's first
      // day sits inside its band.
      (s) => at >= localDay(s.starts_on) && at <= localDay(s.ends_on),
    );
    if (index === -1) return undefined;
    const sprint = sprints[index];
    if (sprint === undefined) return undefined;
    return { tag: `S${String(index + 1)}`, running: sprint.status === 'active' };
  };

  return (
    <div className="cal">
      <SpaceSlot
        context={`${String(due.placed)} open ${due.placed === 1 ? 'task' : 'tasks'} placed · ${new Date(
          now,
        ).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}
      />

      {/* Only what is true of this space: nothing dated at all, or dates the
          six weeks below do not reach (LAI-819). */}
      {due.dated === 0 ? (
        <p className="cal-note" role="note">
          No open task in this space has a due date. Set one in a task’s details and it appears on
          its day.
        </p>
      ) : (
        due.outside > 0 && (
          <p className="cal-note" role="note">
            {due.outside} more open {due.outside === 1 ? 'task is' : 'tasks are'} due outside these
            six weeks.
          </p>
        )
      )}

      <div className="cal-scroll">
        <div className="cal-card">
          <div className="cal-head">
            {/* The design's 46px gutter, empty in the header row. */}
            <div className="cal-gutter cal-gutter-head" />
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-weekday">
                {d}
              </div>
            ))}
          </div>

          {weeks.map((week) => (
            <div key={week.label + String(week.days[0]?.at ?? 0)} className="cal-week">
              <div className="cal-gutter">{week.label}</div>

              {week.days.map((day) => {
                const list = due.byDay.get(day.at) ?? [];
                const sprint = sprintOn(day.at);
                const classes = ['cal-day'];
                if (!day.inMonth) classes.push('cal-day-out');
                if (day.isWeekend) classes.push('cal-day-weekend');
                if (sprint?.running === true) classes.push('cal-day-sprint');
                if (day.isToday) classes.push('cal-day-today');

                return (
                  <div key={day.at} className={classes.join(' ')}>
                    <div className="cal-day-head">
                      <span className="cal-date">{day.dayOfMonth}</span>
                      {/* The month names itself on its first day, as the design
                          does — otherwise a grid spanning three months gives a
                          reader no way to tell which `1` is which. */}
                      {day.dayOfMonth === 1 && (
                        <span className="cal-month">
                          {new Date(day.at)
                            .toLocaleDateString(undefined, { month: 'short' })
                            .toUpperCase()}
                        </span>
                      )}
                      {sprint !== undefined && (
                        <span
                          className={
                            sprint.running ? 'cal-sprint-tag cal-sprint-tag-now' : 'cal-sprint-tag'
                          }
                        >
                          {sprint.tag}
                        </span>
                      )}
                    </div>

                    {list.length > 0 && (
                      <div className="cal-items">
                        {list.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            className={`cal-task cal-task-${task.priority}`}
                            onClick={() => {
                              onOpenTask(task.id);
                            }}
                            title={`${task.key} — ${task.title} · ${statusNameOf(task, statuses.byId)}`}
                          >
                            <span className="cal-task-key">{task.key}</span>
                            <span className="cal-task-title">{task.title}</span>
                            {/* Its status, as the project calls it, in its kind's
                                colour (LAI-739 review round 1). */}
                            <span className={`cal-task-status cal-status-${task.status}`}>
                              {statusNameOf(task, statuses.byId)}
                            </span>
                            {task.created_via === 'mcp' && (
                              <span className="cal-task-agent" aria-hidden="true" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* The design's legend (prototype lines 616–621). */}
          <div className="cal-legend">
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-today" aria-hidden="true" />
              today
            </span>
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-sprint" aria-hidden="true" />
              active sprint days
            </span>
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-weekend" aria-hidden="true" />
              weekend
            </span>
            <span className="cal-legend-item">
              <span className="cal-swatch cal-swatch-agent" aria-hidden="true" />
              agent-owned
            </span>
            <span className="cal-legend-note">
              An open task appears on the day it is due. Click one to open it.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
