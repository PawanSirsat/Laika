import { request } from './client.ts';
import type { Page, Task, TaskPriority } from './tasks.ts';

/**
 * Unlisted work (SPEC §4.14, API by LAI-405, screen by LAI-413).
 *
 * `log_unlisted_work` is how an agent records something it noticed outside any
 * project — a stale dependency, a broken script, work nobody had filed. Until
 * this screen existed the one MCP tool with no REST twin was a write-only hole:
 * rows accumulated where nobody looked.
 */

export interface UnlistedWork {
  readonly id: string;
  readonly user_id: string;
  /** Which token logged it — agent provenance, nullable (§4.14). */
  readonly token_id: string | null;
  readonly repo: string;
  readonly note: string;
  /** The task it became. `null` while it is still just a note. */
  readonly promoted_task_id: string | null;
  readonly dismissed_at: number | null;
  readonly created_at: number;
}

export interface UnlistedFilter {
  readonly user?: string | undefined;
  readonly since?: number | undefined;
  /** Dismissed rows are hidden by default — dismissing is not deleting. */
  readonly includeDismissed?: boolean | undefined;
  readonly cursor?: string | undefined;
}

export function listUnlisted(
  filter: UnlistedFilter = {},
  signal?: AbortSignal,
): Promise<Page<UnlistedWork>> {
  const params = new URLSearchParams();
  if (filter.user !== undefined && filter.user !== '') params.set('user', filter.user);
  if (filter.since !== undefined) params.set('since', String(filter.since));
  if (filter.includeDismissed === true) params.set('include_dismissed', 'true');
  if (filter.cursor !== undefined) params.set('cursor', filter.cursor);

  const query = params.toString();
  return request<Page<UnlistedWork>>(
    `/unlisted${query === '' ? '' : `?${query}`}`,
    signal === undefined ? {} : { signal },
  );
}

export interface PromoteInput {
  readonly project_slug: string;
  readonly title: string;
  readonly priority?: TaskPriority;
}

/** The note and the task it became, so the caller need not re-read the pile. */
export interface PromotedUnlisted {
  readonly unlisted: UnlistedWork;
  readonly task: Task;
}

export function promoteUnlisted(id: string, input: PromoteInput): Promise<PromotedUnlisted> {
  return request<PromotedUnlisted>(`/unlisted/${encodeURIComponent(id)}/promote`, {
    method: 'POST',
    body: input,
  });
}

/** Dismiss — **not** delete. The row stays and `include_dismissed` finds it. */
export function dismissUnlisted(id: string): Promise<void> {
  return request<void>(`/unlisted/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * May this actor triage the pile?
 *
 * **Mirrors `audit_log.export` in `policy/can.ts`, which is admin-up.** These
 * rows are audit rows — §4.14 borrows that permission deliberately rather than
 * inventing one. The nav entry is *absent* for everyone else rather than
 * disabled (LAI-082): a disabled entry still advertises a screen they cannot
 * open, and every endpoint here answers `403` for them anyway.
 */
export function mayTriageUnlisted(orgRole: string): boolean {
  return orgRole === 'owner' || orgRole === 'admin';
}

/** What a row is, once triage has happened to it. */
export type UnlistedState = 'pending' | 'promoted' | 'dismissed';

/**
 * A row's state, in the order the server resolves it.
 *
 * **Promoted wins over dismissed.** A row that became a task and was later
 * dismissed still produced work someone can open, and hiding that behind
 * "dismissed" loses the more useful fact. It also matters for the control: the
 * server answers `409` to a second promote, so a promoted row must never be
 * offered one again (LAI-413 AC4).
 */
export function unlistedState(row: UnlistedWork): UnlistedState {
  if (row.promoted_task_id !== null) return 'promoted';
  if (row.dismissed_at !== null) return 'dismissed';
  return 'pending';
}

/** Only an untriaged row can be promoted — everything else has been decided. */
export function mayPromote(row: UnlistedWork): boolean {
  return unlistedState(row) === 'pending';
}
