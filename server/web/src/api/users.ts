import { request } from './client.ts';
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
}

export function listUsers(
  query: ListUsersQuery = {},
  signal?: AbortSignal,
): Promise<Page<OrgUser>> {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));

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

export async function listAllUsers(signal?: AbortSignal, maxPages = 20): Promise<AllUsers> {
  const users: OrgUser[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const q: ListUsersQuery = cursor === undefined ? {} : { cursor };
    const result = await listUsers(q, signal);
    users.push(...result.data);
    if (result.next_cursor === null || result.next_cursor === undefined) {
      return { users, truncated: false };
    }
    cursor = result.next_cursor;
  }

  return { users, truncated: true };
}
