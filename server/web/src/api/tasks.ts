import { request } from './client.ts';
import { ApiError } from './errors.ts';

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
  /**
   * The sprint this task belongs to, or `null`.
   *
   * The server has returned this on every `TaskView` since LAI-011; the client
   * type simply never declared it, so nothing in the UI could group or scope by
   * sprint (LAI-121, found by Builder-A).
   */
  readonly sprint_id: string | null;
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
  /**
   * A sprint id, or the literal `none` for tasks in no sprint.
   *
   * The server has accepted this since LAI-011 (`c.req.query('sprint')` in
   * `http/routes/tasks.ts`); the client type simply never declared it, so the
   * board could not scope to a sprint even though the API could.
   */
  readonly sprint?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

function toQuery(filter: TaskFilter): string {
  const params = new URLSearchParams();
  if (filter.status !== undefined) params.set('status', filter.status);
  if (filter.priority !== undefined) params.set('priority', filter.priority);
  if (filter.assignee !== undefined) params.set('assignee', filter.assignee);
  if (filter.ready !== undefined) params.set('ready', String(filter.ready));
  if (filter.sprint !== undefined) params.set('sprint', filter.sprint);
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

export interface CreateTaskInput {
  readonly title: string;
  readonly priority?: TaskPriority | undefined;
  readonly status?: TaskStatus | undefined;
}

/**
 * Create a task (SPEC §6.4, LAI-011 — first reachable from the UI in LAI-065).
 *
 * `created_via` is sent explicitly as `web`. The server defaults it, but §9
 * attributes activity by it and a task made in the browser that claims to have
 * come from an agent is a lie in the audit trail. Saying so costs one field.
 *
 * The body is strict — an unrecognised key is `unprocessable`, not ignored — so
 * only fields the form actually collects are sent.
 */
export function createTask(slug: string, input: CreateTaskInput): Promise<Task> {
  return request<Task>(`/projects/${encodeURIComponent(slug)}/tasks`, {
    method: 'POST',
    body: {
      title: input.title,
      created_via: 'web',
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.status === undefined ? {} : { status: input.status }),
    },
  });
}

/**
 * May this actor create a task in this project?
 *
 * `task.write` is `member`-or-`lead` (`policy/can.ts`), and the project role is
 * derived the way `effectiveProjectRole` derives it: org `owner`/`admin` hold
 * implicit lead everywhere, an org `viewer` is capped at `viewer` however their
 * membership row reads (D-006), and everyone else takes their membership.
 *
 * A display decision, not enforcement — the server decides, and if the two ever
 * disagree the server is right and this is the bug. It exists so a Viewer is not
 * shown a button that answers 403, which teaches people the app is broken rather
 * than that they lack permission.
 */
export function canCreateTask(
  orgRole: string,
  projectId: string,
  memberships: readonly { readonly project_id: string; readonly role: string }[],
): boolean {
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  if (orgRole === 'viewer') return false;

  const membership = memberships.find((m) => m.project_id === projectId);
  if (membership === undefined) return false;
  return membership.role === 'lead' || membership.role === 'member';
}

/**
 * Assign a task, or clear it.
 *
 * `null` unassigns — the ordinary state, not an error. `PATCH` distinguishes
 * "leave it alone" (absent) from "clear it" (`null`), which is why this always
 * sends the key.
 */
export function assignTask(taskId: string, assigneeId: string | null): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: { assignee_id: assigneeId },
  });
}

/**
 * Claim a task for yourself.
 *
 * A separate endpoint from `assignTask` because the server does a
 * **compare-and-swap** here: it only writes where `assignee_id IS NULL`, and
 * answers `409` with the winner's id in `details.assignee_id` when someone got
 * there first. The client must not re-implement that race — it sends the
 * request and renders whichever answer comes back.
 */
export function claimTask(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/claim`, { method: 'POST' });
}

/** Who won a claim we lost, if the server said. */
export function claimWinner(cause: unknown): string | undefined {
  if (!(cause instanceof ApiError) || cause.code !== 'conflict') return undefined;
  const details: unknown = cause.details;
  if (typeof details !== 'object' || details === null) return undefined;
  const id = (details as { readonly assignee_id?: unknown }).assignee_id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * May this actor assign a task to **someone else**?
 *
 * `task.assign_other` is member-or-lead (§3.2). Claiming for yourself is a
 * different action and a Viewer cannot do that either, since it writes.
 */
export function canAssignOthers(
  orgRole: string,
  projectId: string,
  memberships: readonly { readonly project_id: string; readonly role: string }[],
): boolean {
  return canCreateTask(orgRole, projectId, memberships);
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
