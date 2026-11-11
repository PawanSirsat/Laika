import { request } from './client.ts';

/**
 * The time on one task (LAI-1122, the intent of LAI-812): the task panel's
 * *Tracked on this task*. Mirrors `services/task-time.ts`.
 *
 * **Totals, never who** (D-088). The server answers the confirmed minutes, the
 * entries and how many people they are from; per-person hours are not sent,
 * so none are drawn. Beside them, never in them: the agent minutes tied to
 * the card, and the reader's own pending drafts — `null` on a token.
 */

/** `GET /tasks/:id/time` — the server's `TaskTimeView`. */
export interface TaskTime {
  readonly total_minutes: number;
  readonly people: number;
  readonly entries: number;
  readonly agent_minutes: number;
  readonly my_draft_minutes: number | null;
}

export function getTaskTime(taskId: string, signal?: AbortSignal): Promise<TaskTime> {
  return request<TaskTime>(`/tasks/${encodeURIComponent(taskId)}/time`, {
    ...(signal === undefined ? {} : { signal }),
  });
}
