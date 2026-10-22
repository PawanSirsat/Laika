import { request } from './client.ts';
import type { ProjectRole } from './members.ts';
import type { OpenTasksChoice } from './offboarding.ts';
import type { Page } from './tasks.ts';

/**
 * The organisation's people (SPEC §6.4, LAI-060).
 *
 * This exists so a member picker can show a person rather than ask for a ULID.
 * Until LAI-060 landed there was no way to discover a user through the API at
 * all, which is why LAI-059 shipped its first round without an add flow.
 *
 * Deactivated people are excluded by the server unless asked for. A picker must
 * never offer them, so it never asks.
 */

export interface OrgUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly org_role: string;
  readonly is_active: boolean;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface ListUsersQuery {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  /**
   * Include people who have been deactivated. **Absent means active only**,
   * which is the server's default and the right one for a picker.
   *
   * **The client is the side that knows which question it is asking** (LAI-240).
   * A *directory* — who has ever been here, so history keeps its author — wants
   * them; an *assignee picker* does not, because you cannot hand work to
   * somebody who is locked out. Making the two uniform would break one of them,
   * and which one depends on a caller's intent the endpoint cannot see.
   */
  readonly includeInactive?: boolean | undefined;
}

export function listUsers(
  query: ListUsersQuery = {},
  signal?: AbortSignal,
): Promise<Page<OrgUser>> {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  // Sent only when true. The route parses `true`/`false` and `400`s on anything
  // else, so an explicit `false` is legal — but absent already means active
  // only, and a parameter that restates the default is one more thing that can
  // disagree with it.
  if (query.includeInactive === true) params.set('include_inactive', 'true');

  const search = params.toString();
  return request<Page<OrgUser>>(
    `/users${search === '' ? '' : `?${search}`}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Every page, not the first one.
 *
 * A picker that silently shows page one is the same defect as a list that
 * silently shows nothing: the person you want is missing and the UI looks
 * complete. The endpoint is cursor-paginated and ordered by `(name, id)`, so
 * following the cursor is the only way to see everyone.
 *
 * `maxPages` is a runaway guard, not a product limit — a server that returned a
 * cursor for ever would otherwise spin here. When it trips the caller is told,
 * because a truncated directory that does not say so is a lie.
 */
export interface AllUsers {
  readonly users: readonly OrgUser[];
  /** True when `maxPages` stopped the walk before the server ran out. */
  readonly truncated: boolean;
}

export async function listAllUsers(
  signal?: AbortSignal,
  options: { readonly includeInactive?: boolean; readonly maxPages?: number } = {},
): Promise<AllUsers> {
  const { includeInactive = false, maxPages = 20 } = options;
  const users: OrgUser[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    // Carried on **every** page, not just the first: the server re-reads it per
    // request, so dropping it after page one would silently truncate the tail of
    // a directory to active people — a partial answer that looks complete.
    const q: ListUsersQuery = {
      ...(cursor === undefined ? {} : { cursor }),
      ...(includeInactive ? { includeInactive: true } : {}),
    };
    const result = await listUsers(q, signal);
    users.push(...result.data);
    if (result.next_cursor === null || result.next_cursor === undefined) {
      return { users, truncated: false };
    }
    cursor = result.next_cursor;
  }

  return { users, truncated: true };
}

/**
 * Change somebody's org role, or lock them out (§6.4, LAI-222).
 *
 * **One endpoint, two different sentences**, and the caller must say which it
 * means: `PATCH` refuses a body carrying neither. `is_active: false` is
 * deactivation and `true` is reactivation — D-048 gave those **two audit verbs**
 * rather than one, because *"who was locked out, and when"* and *"who was let
 * back in"* are different questions people actually ask.
 *
 * **Deactivation is not deletion.** §4.1 keeps the row so history keeps its
 * author, and the person stays in the list wearing a `DEACTIVATED` chip.
 */
export function updateUser(
  id: string,
  patch: {
    readonly org_role?: string;
    readonly is_active?: boolean;
    /** Deactivation only: what happens to their open tasks (D-104 item 5, LAI-986). */
    readonly open_tasks?: OpenTasksChoice;
  },
): Promise<OrgUser> {
  return request<OrgUser>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

/** What `POST /users/:id/sign-out` answers (D-104 item 3, LAI-981). */
export interface SignOutView {
  readonly user_id: string;
  readonly sessions_ended: number;
}

/**
 * End every session of a person, without deactivating them. Their tokens stay:
 * those are *Manage anyone's tokens*, listed beside this on the profile.
 */
export function signOutEverywhere(id: string): Promise<SignOutView> {
  return request<SignOutView>(`/users/${encodeURIComponent(id)}/sign-out`, { method: 'POST' });
}

/**
 * A one-time password-reset link for a person (D-104 item 4, LAI-983).
 *
 * **Shown once.** The server keeps only its hash, so this response is the only
 * copy of the link there will ever be. The caller holds it in component state
 * for as long as it is on screen and nowhere else — never a log, never storage.
 */
export interface ResetLinkView {
  readonly url: string;
  readonly expires_at: number;
}

export function issueResetLink(id: string): Promise<ResetLinkView> {
  return request<ResetLinkView>(`/users/${encodeURIComponent(id)}/reset-link`, {
    method: 'POST',
  });
}

/**
 * One space a person belongs to, with their role in it (LAI-981). Narrowed by
 * the server to the spaces the caller can read; an owner's or admin's implicit
 * access everywhere is not a membership and is not listed.
 */
export interface PersonMembership {
  readonly project_id: string;
  readonly slug: string;
  readonly name: string;
  readonly prefix: string;
  readonly role: ProjectRole;
  readonly archived: boolean;
  readonly joined_at: number;
}

export function listMemberships(
  id: string,
  signal?: AbortSignal,
): Promise<{ readonly data: readonly PersonMembership[] }> {
  return request<{ readonly data: readonly PersonMembership[] }>(
    `/users/${encodeURIComponent(id)}/memberships`,
    signal === undefined ? {} : { signal },
  );
}
