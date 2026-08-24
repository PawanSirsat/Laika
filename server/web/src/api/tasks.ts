import { request } from './client.ts';

/**
 * Tasks (SPEC §6.4, LAI-011).
 *
 * Wire shapes are snake_case and mirror `server/src/services/tasks.ts` exactly.
 * Anything the server does not send is **not invented here** — notably `stale`
 * and the agent-authored badge, which LAI-049 needs and `TaskView` does not
 * carry (→ LAI-208, LAI-209).
 */

export const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof STATUSES)[number] | 'cancelled';

export const PRIORITIES = ['p1', 'p2', 'p3'] as const;
export type TaskPriority = (typeof PRIORITIES)[number];

export interface Task {
  readonly id: string;
  /** The display key humans and agents both use — `LAI-42` (§4.5). */
  readonly key: string;
  readonly project_id: string;
  readonly number: number;
  readonly title: string;
  readonly description_md: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly assignee_id: string | null;
  readonly created_by: string;
  readonly created_via: string;
  readonly discovered_from: string | null;
  /**
   * **Derived by the server** (§4.5): backlog or todo, unassigned, and every
   * dependency done. Displayed, never recomputed — recomputing it here is the
   * bug LAI-049 warns about, because the two definitions would drift.
   */
  readonly ready: boolean;
  readonly dependencies: readonly string[];
  readonly created_at: number;
  readonly updated_at: number;
}

/**
 * The §6.3 page envelope. The array is **`data`**, not `items`.
 *
 * Worth a comment because getting it wrong is silent: a client reading `items`
 * finds `undefined`, renders an empty board, and looks exactly like a project
 * with no tasks. Caught against a live server, not in review.
 */
export interface Page<T> {
  readonly data: readonly T[];
  readonly next_cursor: string | null;
}

export interface TaskFilter {
  readonly status?: TaskStatus | undefined;
  readonly priority?: TaskPriority | undefined;
  /** A user id, or the literal `none` for unassigned. */
  readonly assignee?: string | undefined;
  readonly ready?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

function toQuery(filter: TaskFilter): string {
  const params = new URLSearchParams();
  if (filter.status !== undefined) params.set('status', filter.status);
  if (filter.priority !== undefined) params.set('priority', filter.priority);
  if (filter.assignee !== undefined) params.set('assignee', filter.assignee);
  if (filter.ready !== undefined) params.set('ready', String(filter.ready));
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.cursor !== undefined) params.set('cursor', filter.cursor);

  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function listTasks(
  slug: string,
  filter: TaskFilter = {},
  signal?: AbortSignal,
): Promise<Page<Task>> {
  return request<Page<Task>>(
    `/projects/${encodeURIComponent(slug)}/tasks${toQuery(filter)}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Move a task between columns.
 *
 * The server validates the transition (§5) and answers `422` when it is illegal.
 * That rejection is the whole reason the board does not move the card until this
 * resolves — see `use-board.ts`.
 */
export function changeStatus(taskId: string, status: TaskStatus): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: { status },
  });
}

export interface ProjectSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export function listProjects(signal?: AbortSignal): Promise<Page<ProjectSummary>> {
  return request<Page<ProjectSummary>>('/projects', signal === undefined ? {} : { signal });
}

export interface Member {
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly created_at: number;
}

/**
 * Members come back as `{ members: [...] }` — **not** the `{ data, next_cursor }`
 * page envelope every other list uses.
 *
 * Typed as a page originally, which read `.data`, got `undefined`, and left the
 * member map empty — so every name on the board and in the detail panel
 * degraded silently to a raw ULID. Same class of failure as the `items` vs
 * `data` bug in LAI-049: a wrong envelope does not throw, it just renders
 * something almost right.
 */
export interface MemberList {
  readonly members: readonly Member[];
}

export function listMembers(slug: string, signal?: AbortSignal): Promise<MemberList> {
  return request<MemberList>(
    `/projects/${encodeURIComponent(slug)}/members`,
    signal === undefined ? {} : { signal },
  );
}
