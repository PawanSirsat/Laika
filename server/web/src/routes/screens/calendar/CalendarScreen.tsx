import { useEffect, useState } from 'react';
import { listTasks, type Task } from '../../../api/tasks.ts';
import { DemoNotice } from '../../../components/DemoNotice.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { demoDueDate } from '../../../demo/calendar.ts';
import { byDay, monthGrid } from './calendar-derive.ts';
import './calendar.css';

export interface CalendarScreenProps {
  readonly slug: string | undefined;
  readonly onOpenTask: (taskId: string) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Tasks laid out by the day they are due (D-059).
 *
 * **There are no due dates.** `tasks.due_date` does not exist — no column, no
 * endpoint — so every date on this screen comes from `demo/calendar.ts` and
 * the screen says so, once, at the top. D-059 chose that over an empty tab;
 * D-032 is what keeps it out of a production build.
 */
export function CalendarScreen({ slug, onOpenTask }: CalendarScreenProps) {
  const [tasks, setTasks] = useState<readonly Task[] | undefined>(undefined);
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

  const days = monthGrid(now);
  const due = byDay(tasks, (t) => demoDueDate(t, now));
  const placed = [...due.values()].reduce((n, list) => n + list.length, 0);

  return (
    <div className="cal">
      <SpaceSlot
        context={`${String(placed)} ${placed === 1 ? 'task' : 'tasks'} placed · ${new Date(
          now,
        ).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}
      />

      {/* Said on the screen, as D-032 requires — not only in a comment. */}
      <DemoNotice what="Laika does not store a due date yet (tasks.due_date), so these dates are placeholders. The calendar becomes real the day the field lands." />

      <div className="cal-grid" role="grid" aria-label="Tasks by day">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday" role="columnheader">
            {d}
          </div>
        ))}

        {days.map((day) => {
          const list = due.get(day.at) ?? [];
          const classes = ['cal-day'];
          if (!day.inMonth) classes.push('cal-day-out');
          if (day.isWeekend) classes.push('cal-day-weekend');
          if (day.isToday) classes.push('cal-day-today');

          return (
            <div key={day.at} className={classes.join(' ')} role="gridcell">
              <span className="cal-date">{day.dayOfMonth}</span>
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
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
