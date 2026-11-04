import { request } from './client.ts';
import { formatDuration } from './duration.ts';

/**
 * The confirmed time on one task (LAI-1122, the intent of LAI-812): the task
 * panel's *Time logged · 2 h 10 min by 2 people*. Mirrors
 * `services/task-time.ts`.
 *
 * **Totals, never who** (D-088). The server answers the minutes, the entries
 * and how many people they are from; per-person hours are not sent, so none
 * are drawn. Only confirmed time is in it — a draft is its person's alone.
 */

/** `GET /tasks/:id/time` — the server's `TaskTimeView`. */
export interface TaskTime {
  readonly total_minutes: number;
  readonly people: number;
  readonly entries: number;
}

export function getTaskTime(taskId: string, signal?: AbortSignal): Promise<TaskTime> {
  return request<TaskTime>(`/tasks/${encodeURIComponent(taskId)}/time`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * `2 h 10 min by 2 people`, `45 min by 1 person`; `null` for none, which the
 * panel draws as nothing — never `0 min`. Hours stay hours: a task's logged
 * time is a person's working time, and `3 d` would read as calendar days.
 */
export function timeLoggedLine(view: TaskTime): string | null {
  if (view.total_minutes <= 0 || view.entries <= 0) return null;
  const who = view.people === 1 ? '1 person' : `${String(view.people)} people`;
  return `${formatDuration(view.total_minutes, { largest: 'h' })} by ${who}`;
}
