import { useState } from 'react';
import { dateLabelShort } from '../../../api/date-only.ts';
import type { ProjectStatus } from '../../../api/statuses.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { CalendarChip } from './CalendarDay.tsx';

export interface CalendarOverdueProps {
  readonly tasks: readonly TaskSummary[];
  readonly byId: ReadonlyMap<string, ProjectStatus>;
  readonly mayMove: boolean;
  readonly onOpen: (taskId: string) => void;
}

/**
 * Open work whose day has passed (LAI-1178), gathered above the grid rather
 * than piled on the old days — oldest first, each saying when it was due, and
 * draggable onto a day like any chip. Folded by the reader, never hidden: a
 * count stays on the bar.
 */
export function CalendarOverdue({ tasks, byId, mayMove, onOpen }: CalendarOverdueProps) {
  const [open, setOpen] = useState(true);
  if (tasks.length === 0) return null;
  return (
    <section className="cal-overdue" aria-label="Overdue" data-overdue>
      <button
        type="button"
        className="cal-overdue-bar"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span className="cal-overdue-dot" aria-hidden="true" />
        <span className="cal-overdue-title">Overdue</span>
        <span className="cal-overdue-count">{tasks.length}</span>
        <span className="cal-overdue-hint">
          {mayMove ? 'Drag one onto a day to reschedule it' : 'Due before today, still open'}
        </span>
        <span className="cal-overdue-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ul className="cal-overdue-list">
          {tasks.map((task) => (
            <li key={task.id} className="cal-overdue-item">
              <span className="cal-overdue-when">
                {task.due_on === null ? '' : dateLabelShort(task.due_on)}
              </span>
              <CalendarChip task={task} byId={byId} mayMove={mayMove} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
