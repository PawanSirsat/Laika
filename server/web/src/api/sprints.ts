import { request } from './client.ts';
import type { Page } from './tasks.ts';

/**
 * Sprints (SPEC §4.15, §6.4 — LAI-050).
 *
 * Only the parts the shell needs. The sprints *screen* is LAI-068; this exists
 * so the sidebar can put a real number on the nav item instead of the
 * prototype's fixture.
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
