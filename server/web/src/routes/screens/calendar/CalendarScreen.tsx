import { useEffect, useState } from 'react';
import { listTasks, type Task } from '../../../api/tasks.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { DemoNotice } from '../../../components/DemoNotice.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { demoDueDate } from '../../../demo/calendar.ts';
import { byDay, monthWeeks, startOfDay } from './calendar-derive.ts';
import './calendar.css';

export interface CalendarScreenProps {
  readonly slug: string | undefined;
  readonly onOpenTask: (taskId: string) => void;
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Tasks laid out by the day they are due (D-059, prototype lines 581–624).
 *
 * **There are no due dates.** `tasks.due_date` does not exist — no column, no
 * endpoint — so every *date* on this screen comes from `demo/calendar.ts` and
 * the screen says so, once, at the top. D-059 chose that over an empty tab;
 * D-032 is what keeps it out of a production build.
 *
 * **The sprint bands are real.** Sprints have dates, so the days inside the
 * running sprint are marked from `GET /projects/:slug/sprints` rather than
 * invented — the demo module covers the one field the API does not have, and
 * nothing more.
 */
export function CalendarScreen({ slug, onOpenTask }: CalendarScreenProps) {
  const [tasks, setTasks] = useState<readonly Task[] | undefined>(undefined);
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  const now = Date.now();

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    listTasks(slug, { limit: 200 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted)
          setTasks(page.data.filter((t): t is Task => !('deleted' in t)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setTasks([]);
      });

    listSprints(slug, undefined, controller.signal)
      .then((page) => {
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
  const due = byDay(tasks, (t) => demoDueDate(t, now));
  const placed = [...due.values()].reduce((n, list) => n + list.length, 0);

  /** `S2` for a day inside a sprint, in the design's top-right corner. */
  const sprintOn = (
    at: number,
  ): { readonly tag: string; readonly running: boolean } | undefined => {
    const index = sprints.findIndex(
      // `starts_on`/`ends_on` are already unix-ms, not ISO strings.
      (s) => at >= startOfDay(s.starts_on) && at <= startOfDay(s.ends_on),
    );
    if (index === -1) return undefined;
    const sprint = sprints[index];
    if (sprint === undefined) return undefined;
    return { tag: `S${String(index + 1)}`, running: sprint.status === 'active' };
  };

  return (
    <div className="cal">
      <SpaceSlot
        context={`${String(placed)} ${placed === 1 ? 'task' : 'tasks'} placed · ${new Date(
          now,
        ).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}
      />

      {/* Said on the screen, as D-032 requires — not only in a comment. */}
      <DemoNotice what="Laika does not store a due date yet (tasks.due_date), so these dates are placeholders. The calendar becomes real the day the field lands." />

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
                const list = due.get(day.at) ?? [];
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
                            title={`${task.key} — ${task.title}`}
                          >
                            <span className="cal-task-key">{task.key}</span>
                            <span className="cal-task-title">{task.title}</span>
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
              A task appears on the day it is due. Click one to open it.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
