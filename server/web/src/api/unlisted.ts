import { request } from './client.ts';
import type { Page, Task, TaskPriority } from './tasks.ts';
import type { Project } from './projects.ts';

/**
 * Unlisted work (SPEC §4.14, API by LAI-405, screen by LAI-413).
 *
 * `log_unlisted_work` is how an agent records something it noticed outside any
 * project — a stale dependency, a broken script, work nobody had filed. Until
 * this screen existed the one MCP tool with no REST twin was a write-only hole:
 * rows accumulated where nobody looked.
 */

/** A note as promoting it answers: the row, without its files. */
export interface UnlistedNote {
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

/** A file attached to a note, as the list names it (D-162 item 8, LAI-1361). */
export interface UnlistedFile {
  readonly id: string;
  readonly filename: string;
  readonly content_type: string;
  readonly size_bytes: number;
  /** Shown in the page; otherwise a download. */
  readonly inline: boolean;
}

/**
 * A note as the list answers it: the row, and **the files attached to it
 * that this reader may open** (LAI-1361), oldest first — what its
 * `**Attached**` links cannot say: each file's name, type and size.
 */
export interface UnlistedWork extends UnlistedNote {
  readonly files: readonly UnlistedFile[];
}

export interface UnlistedFilter {
  readonly user?: string | undefined;
  readonly since?: number | undefined;
  /** Dismissed rows are hidden by default — dismissing is not deleting. */
  readonly includeDismissed?: boolean | undefined;
  readonly cursor?: string | undefined;
  /** Page size, up to 200 (§6.3) — `everyPage` asks for the largest (LAI-703). */
  readonly limit?: number | undefined;
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
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));

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
  readonly unlisted: UnlistedNote;
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
export function unlistedState(row: UnlistedNote): UnlistedState {
  if (row.promoted_task_id !== null) return 'promoted';
  if (row.dismissed_at !== null) return 'dismissed';
  return 'pending';
}

/** Only an untriaged row can be promoted — everything else has been decided. */
export function mayPromote(row: UnlistedNote): boolean {
  return unlistedState(row) === 'pending';
}

/**
 * How many notes still wait for somebody — the sidebar's badge and Capacity's
 * link (LAI-754).
 *
 * **Pending only.** `GET /unlisted` leaves dismissed rows out by default but
 * keeps promoted ones, and a promoted note is decided: counting it would make
 * the badge a total of everything ever logged rather than what is left to do.
 */
export function openUnlistedCount(rows: readonly UnlistedWork[]): number {
  return rows.filter((row) => unlistedState(row) === 'pending').length;
}

/**
 * Newest first, by when the note was logged — the order the server sorts in,
 * restated so the list does not depend on it (LAI-754).
 */
export function newestFirst(rows: readonly UnlistedWork[]): UnlistedWork[] {
  return [...rows].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1));
}

/** A note's first non-blank line, for the one-line row; the rest opens on click. */
export function firstLine(note: string): string {
  return (
    note
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/** The spaces a promote may land in: `undefined` while read, `null` if the read failed. */
export type PromoteSpaces = readonly Pick<Project, 'slug'>[] | null | undefined;

/**
 * Why *Create task* cannot be pressed yet, in a few words — or `undefined`
 * when it can (LAI-1128). A disabled button that does not say why is a
 * control that looks broken.
 */
export function promoteBlocker(
  spaces: PromoteSpaces,
  slug: string,
  title: string,
): string | undefined {
  if (spaces === undefined) return 'Loading the spaces you can add tasks to.';
  if (spaces === null) return 'Could not load your spaces.';
  if (spaces.length === 0)
    return 'You cannot create tasks in any space. A space lead can give you access.';
  if (slug === '' || !spaces.some((space) => space.slug === slug)) return 'Choose a space.';
  if (title.trim() === '') return 'Give the task a title.';
  return undefined;
}

/**
 * What the Unlisted page narrows to (LAI-1222): a state — the figures at the
 * top are these filters — who logged it, and which repository. Page state,
 * not the address, as the page's only toggle (*Show dismissed*) always was.
 */
export interface UnlistedView {
  readonly state: 'all' | UnlistedState;
  readonly source: 'any' | 'agent' | 'person';
  readonly repo: string | null;
}

export const ALL_UNLISTED: UnlistedView = { state: 'all', source: 'any', repo: null };

/** An agent's note carries the token it was logged with (§4.14); a person's does not. */
export function fromAgent(row: UnlistedNote): boolean {
  return row.token_id !== null;
}

/** The rows `view` leaves, in the order they came. */
export function filterUnlisted(rows: readonly UnlistedWork[], view: UnlistedView): UnlistedWork[] {
  return rows.filter(
    (row) =>
      (view.state === 'all' || unlistedState(row) === view.state) &&
      (view.source === 'any' || fromAgent(row) === (view.source === 'agent')) &&
      (view.repo === null || row.repo === view.repo),
  );
}

/** How many rows of each state, for the figures that filter by it. */
export function unlistedCounts(
  rows: readonly UnlistedWork[],
): Readonly<Record<'all' | UnlistedState, number>> {
  const counts = { all: rows.length, pending: 0, promoted: 0, dismissed: 0 };
  for (const row of rows) counts[unlistedState(row)] += 1;
  return counts;
}

/** Every repository the rows name, A–Z, for the filter. */
export function unlistedRepos(rows: readonly UnlistedWork[]): string[] {
  return [...new Set(rows.map((row) => row.repo))].sort((a, b) => a.localeCompare(b));
}
