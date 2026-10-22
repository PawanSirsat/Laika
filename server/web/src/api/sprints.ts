import { request } from './client.ts';
import type { Page, TaskStatus } from './tasks.ts';

/**
 * Sprints (SPEC §4.15, §6.4 — LAI-050).
 *
 * Started as the two calls the nav badge needed (LAI-064) and grew into the
 * whole surface for the sprints screen (LAI-083). **Builder-A's under D-029**:
 * the split by screen left this module developed by one side and consumed by
 * the other, and a module follows the developer rather than the directory.
 * Builder-B reads `countSprints` for the nav count and edits nothing here.
 *
 * ## Nothing in this file re-implements a server rule
 *
 * §4.15's non-overlap and one-active-sprint rules are enforced in
 * `services/sprints.ts` under a write lock, and both refuse with a `409` whose
 * message already names the sprint that holds the slot. Checking either here
 * would be a second implementation that is wrong the moment two people act at
 * once — which is exactly the case the server takes the lock for. The screen
 * surfaces the server's message instead.
 */

/** Verbatim from `server/src/db/enums.ts` — `completed`, not `complete`. */
export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

export interface Sprint {
  readonly id: string;
  /** Which project it belongs to. Served since LAI-011; declared by LAI-213. */
  readonly project_id: string;
  readonly name: string;
  readonly goal: string | null;
  readonly starts_on: number;
  readonly ends_on: number;
  readonly status: SprintStatus;
  readonly created_at: number;
  readonly updated_at: number;
  /**
   * How many tasks sit in the sprint, by status (LAI-721). **Only the
   * project's sprint list sends it** (`GET /projects/:slug/sprints`); a sprint
   * read by id or returned from a write has none, hence optional.
   */
  readonly task_counts?: SprintTaskCounts;
}

/** A sprint's tasks counted by status, as the sprint list serves them. */
export interface SprintTaskCounts {
  readonly total: number;
  readonly by_status: Readonly<Record<TaskStatus, number>>;
}

export interface ListSprintsQuery {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  readonly status?: SprintStatus | undefined;
}

export function listSprints(
  slug: string,
  query: ListSprintsQuery = {},
  signal?: AbortSignal,
): Promise<Page<Sprint>> {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.status !== undefined) params.set('status', query.status);

  const search = params.toString();
  return request<Page<Sprint>>(
    `/projects/${encodeURIComponent(slug)}/sprints${search === '' ? '' : `?${search}`}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * How many sprints this project has.
 *
 * **Every sprint, not the active one.** §4.15 allows at most one `active` sprint
 * per project, so a badge counting those reads `0` or `1` for ever and tells the
 * reader nothing. There is no count endpoint and the page envelope carries no
 * total, so this walks the cursor — the same reason `listAllUsers` does.
 *
 * `maxPages` is a runaway guard. It returns what it has rather than throwing: a
 * nav badge is not worth failing a page render over, and an undercount is
 * visible where a crash is not recoverable.
 */
export async function countSprints(
  slug: string,
  signal?: AbortSignal,
  maxPages = 20,
): Promise<number> {
  let total = 0;
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const q: ListSprintsQuery = cursor === undefined ? {} : { cursor };
    const result = await listSprints(slug, q, signal);
    total += result.data.length;
    if (result.next_cursor === null || result.next_cursor === undefined) return total;
    cursor = result.next_cursor;
  }

  return total;
}

export interface SprintInput {
  readonly name: string;
  readonly goal?: string | null;
  readonly starts_on: number;
  readonly ends_on: number;
  readonly status?: SprintStatus;
}

export function createSprint(slug: string, input: SprintInput): Promise<Sprint> {
  return request<Sprint>(`/projects/${encodeURIComponent(slug)}/sprints`, {
    method: 'POST',
    body: input,
  });
}

/** `goal: null` clears it; omitting it leaves it alone. Different requests. */
export function updateSprint(id: string, patch: Partial<SprintInput>): Promise<Sprint> {
  return request<Sprint>(`/sprints/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

/**
 * Delete a sprint. **Its tasks are released, not deleted** (§4.15) — they go
 * back to `sprint_id: null`, which is the ordinary state for a task.
 */
export function deleteSprint(id: string): Promise<void> {
  return request<void>(`/sprints/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Activation is a status change; the server refuses a second one with `409`. */
export function activateSprint(id: string): Promise<Sprint> {
  return updateSprint(id, { status: 'active' });
}

/**
 * Assign tasks into a sprint. **All or nothing** — one unknown id, or one
 * belonging to another project, rejects the whole request server-side, so a
 * caller never has to work out which half landed.
 */
export function addTasksToSprint(
  id: string,
  taskIds: readonly string[],
): Promise<{ tasks: unknown[] }> {
  return request<{ tasks: unknown[] }>(`/sprints/${encodeURIComponent(id)}/tasks`, {
    method: 'POST',
    body: { task_ids: [...taskIds] },
  });
}

export function removeTaskFromSprint(id: string, taskId: string): Promise<unknown> {
  return request<unknown>(
    `/sprints/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  );
}

// ------------------------------------------------- the forecast (LAI-772)

export interface SprintForecastFigures {
  /** The share of draws inside `[low, high]`. */
  readonly probability: number;
  readonly low: number;
  readonly high: number;
  readonly median: number;
  readonly days_left: number;
}

/** What a forecast drew on: the window, and what the project finished in it. */
export interface SprintForecastBasis {
  readonly days: number;
  readonly tasks_done: number;
  readonly weight_done: number;
}

/** `GET /sprints/:id/forecast` — the server's `SprintForecastView`. */
export interface SprintForecast {
  readonly sprint_id: string;
  readonly total: number;
  readonly done: number;
  readonly forecast: SprintForecastFigures | null;
  readonly reason: 'completed' | 'no_tasks' | 'not_enough_history' | null;
  readonly basis: SprintForecastBasis;
}

/**
 * "85% likely to finish 18–23 of 26": computed by the server from the
 * project's own recent throughput and the sizes left (LAI-772). Not story
 * points — nothing here is typed by anybody.
 */
export function getSprintForecast(sprintId: string, signal?: AbortSignal): Promise<SprintForecast> {
  return request<SprintForecast>(`/sprints/${encodeURIComponent(sprintId)}/forecast`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/** The forecast in one line, why there is none, or null where none is wanted. */
export function forecastLine(view: SprintForecast): string | null {
  const f = view.forecast;
  if (f !== null) {
    if (f.low === view.total && f.high === view.total)
      return `Likely to finish all ${String(view.total)}`;
    const range = f.low === f.high ? String(f.low) : `${String(f.low)}–${String(f.high)}`;
    return `${String(Math.round(f.probability * 100))}% likely to finish ${range} of ${String(view.total)}`;
  }
  if (view.reason === 'not_enough_history') {
    return 'Forecast once 10 tasks are done in six weeks';
  }
  return null;
}
