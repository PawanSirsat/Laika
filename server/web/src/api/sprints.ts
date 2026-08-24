import { request } from './client.ts';
import type { Page } from './tasks.ts';

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
  readonly name: string;
  readonly goal: string | null;
  readonly starts_on: number;
  readonly ends_on: number;
  readonly status: SprintStatus;
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

/**
 * May this actor create, edit, activate or delete sprints?
 *
 * `sprint.manage` is lead-only (`policy/can.ts`), and an org owner or admin
 * holds implicit lead everywhere (§3). Same shape and same caveat as
 * `canManageMembers`: this **hides** controls so nobody is offered a button
 * that answers 403. It is a display decision, not enforcement — the server
 * decides, and if the two ever disagree the server is right.
 */
export function canManageSprints(
  orgRole: string,
  projectId: string,
  memberships: readonly { readonly project_id: string; readonly role: string }[],
): boolean {
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  return memberships.some((m) => m.project_id === projectId && m.role === 'lead');
}

/**
 * May this actor move tasks into and out of a sprint?
 *
 * `task.assign_sprint` is **member and above** (§3.2), which is a wider cell
 * than `sprint.manage` — a Member plans their own work into a sprint without
 * being able to create or delete one. Two helpers rather than one because the
 * two controls sit next to each other on this screen and collapsing them would
 * silently hide assignment from every Member.
 */
export function canAssignToSprints(
  orgRole: string,
  projectId: string,
  memberships: readonly { readonly project_id: string; readonly role: string }[],
): boolean {
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  return memberships.some(
    (m) => m.project_id === projectId && (m.role === 'lead' || m.role === 'member'),
  );
}
