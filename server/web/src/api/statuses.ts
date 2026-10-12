import { request } from './client.ts';
import type { TaskStatus } from './tasks.ts';

/**
 * A project's statuses (LAI-739, server half LAI-738).
 *
 * **One board column is one status.** A project owns its statuses; each
 * belongs to one of the six fixed categories, which is what `task.status` has
 * always been and what the lifecycle rules, the policy layer and the MCP tools
 * still read. The status is the **name** people see; the category is the
 * **kind** of work it is, and the colour it is drawn in.
 *
 * Replaces LAI-266's board columns, which held *several* statuses each and so
 * needed a dialog to say which — the confusion this model retires.
 *
 * Paths are literal templates so `endpoint-coverage.test.ts` can see them.
 */

export type StatusCategory = TaskStatus;

/** The categories, in the order the board has always drawn them. */
export const STATUS_CATEGORIES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const satisfies readonly StatusCategory[];

export interface ProjectStatus {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  /** Fixed for the status's life — the server refuses a change. */
  readonly category: StatusCategory;
  readonly position: number;
  /** Drawn on no board. Cancelled's statuses start hidden. */
  readonly hidden: boolean;
  readonly created_at: number;
  /** Tasks in this status, as the server last counted them. */
  readonly task_count: number;
}

/**
 * The six kinds, said the way a person would (LAI-739).
 *
 * The add-column form asks *"What kind of work is this?"* and offers these. No
 * "status category" anywhere on screen: the owner asked for Jira's
 * team-managed simplicity, and the vocabulary is part of that.
 */
export const CATEGORY_COPY: Readonly<
  Record<StatusCategory, { readonly label: string; readonly description: string }>
> = {
  backlog: { label: 'Backlog', description: 'Ideas and work nobody has planned yet' },
  todo: { label: 'To do', description: 'Planned, and nobody has started it' },
  in_progress: { label: 'In progress', description: 'Someone is working on it' },
  review: { label: 'In review', description: 'Waiting for a person to check' },
  done: { label: 'Done', description: 'Finished — counts as complete' },
  cancelled: { label: 'Cancelled', description: 'Dropped — will not be done' },
};

/**
 * The project's statuses, by position. **Every write answers with this too**
 * (LAI-738) — a create, a rename, a hide, a reorder, a delete — because one
 * change can move others: a new status lands after the last of its kind and
 * shifts every position after it.
 */
export interface StatusList {
  readonly data: readonly ProjectStatus[];
}

export function listStatuses(slug: string, signal?: AbortSignal): Promise<StatusList> {
  return request<StatusList>(
    `/projects/${encodeURIComponent(slug)}/statuses`,
    signal === undefined ? {} : { signal },
  );
}

export interface NewStatus {
  readonly name: string;
  readonly category: StatusCategory;
  readonly position?: number | undefined;
}

/** Without `position`, it lands right after the last status of its kind. */
export function createStatus(slug: string, input: NewStatus): Promise<StatusList> {
  return request<StatusList>(`/projects/${encodeURIComponent(slug)}/statuses`, {
    method: 'POST',
    body: {
      name: input.name,
      category: input.category,
      ...(input.position === undefined ? {} : { position: input.position }),
    },
  });
}

export interface StatusEdit {
  readonly name?: string;
  readonly hidden?: boolean;
}

export function updateStatus(slug: string, id: string, edit: StatusEdit): Promise<StatusList> {
  return request<StatusList>(
    `/projects/${encodeURIComponent(slug)}/statuses/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: edit },
  );
}

/**
 * The whole order, every id once — hidden ones included, so a client working
 * from a stale list is refused rather than silently dropping one.
 */
export function reorderStatuses(slug: string, ids: readonly string[]): Promise<StatusList> {
  return request<StatusList>(`/projects/${encodeURIComponent(slug)}/statuses/order`, {
    method: 'PUT',
    body: { ids },
  });
}

export interface DeleteResult extends StatusList {
  /** How many tasks moved, so the screen can say so rather than guess. */
  readonly moved: number;
}

/**
 * Delete a status, naming where its tasks go. **`move_to` is always sent** —
 * the server requires it even for an empty status (LAI-738), and refuses the
 * last status of a category. Answers with the project's remaining statuses.
 */
export function deleteStatus(slug: string, id: string, moveTo: string): Promise<DeleteResult> {
  return request<DeleteResult>(
    `/projects/${encodeURIComponent(slug)}/statuses/${encodeURIComponent(id)}`,
    { method: 'DELETE', body: { move_to: moveTo } },
  );
}
