import { request } from './client.ts';
import type { Page } from './tasks.ts';

/**
 * Projects (SPEC §6.4, LAI-010).
 *
 * The one shape worth reading twice is the tombstone. With `?updated_since=`,
 * `GET /projects` returns `{ id, deleted: true }` for archived rows instead of
 * omitting them (§6.3, `server/src/http/updated-since.ts`) — because a client
 * that only receives *changed* rows never learns about *removed* ones and keeps
 * showing something the server no longer has.
 *
 * A list that does not know about this renders a card with a blank name and an
 * undefined slug, which looks like an API bug and is not one.
 */

export interface Project {
  readonly id: string;
  readonly slug: string;
  /** Display-key prefix — `LC` gives `LC-42`. */
  readonly prefix: string;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: 'public' | 'private';
  readonly context_md: string;
  readonly archived_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface Tombstone {
  readonly id: string;
  readonly deleted: true;
}

export type ProjectRow = Project | Tombstone;

/** Narrow a row from a list that may contain tombstones. */
export function isTombstone(row: ProjectRow): row is Tombstone {
  return (row as Tombstone).deleted === true;
}

/**
 * The positive half of the same test.
 *
 * Needed as well as `isTombstone`, not instead of it: TypeScript narrows an
 * `if`/`else` on a type guard, but **not** a `.filter(r => !isTombstone(r))` —
 * the negation is just a boolean to the checker, so the result stays
 * `ProjectRow[]` and reading `.name` off it fails. Consumers that filter want
 * this one.
 */
export function isProject(row: ProjectRow): row is Project {
  return !isTombstone(row);
}

export interface ListProjectsQuery {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  /** Unix ms. Asking for changes since a point is what produces tombstones. */
  readonly updatedSince?: number | undefined;
}

export function listProjects(
  query: ListProjectsQuery = {},
  signal?: AbortSignal,
): Promise<Page<ProjectRow>> {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.updatedSince !== undefined) params.set('updated_since', String(query.updatedSince));

  const search = params.toString();
  return request<Page<ProjectRow>>(
    `/projects${search === '' ? '' : `?${search}`}`,
    signal === undefined ? {} : { signal },
  );
}

export interface CreateProjectInput {
  readonly name: string;
  readonly slug: string;
  readonly prefix: string;
  readonly description?: string | undefined;
  readonly visibility?: 'public' | 'private' | undefined;
}

/**
 * Create a project.
 *
 * `slug` and `prefix` are **required** here, unlike first-boot setup where the
 * server derives them from the name. Worth knowing before wiring a form: the
 * schema is strict, so an omitted `slug` is a `422` rather than a default.
 */
export function createProject(input: CreateProjectInput): Promise<Project> {
  return request<Project>('/projects', {
    method: 'POST',
    body: {
      name: input.name,
      slug: input.slug,
      prefix: input.prefix,
      ...(input.description === undefined || input.description === ''
        ? {}
        : { description: input.description }),
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    },
  });
}

/** Lowercase words joined by hyphens — the server's own rule. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A default prefix from a name: initials of the first words, else the first
 * letters of one word. Two to eight characters, starting with a letter.
 *
 * A *suggestion*, not a derivation — the server does not compute this for
 * `POST /projects`, so the form has to offer something and let it be edited.
 * "Laika Core" gives `LC`; "Laika" gives `LA`.
 */
export function suggestPrefix(name: string): string {
  const words = name
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '');

  if (words.length === 0) return '';

  const initials = words
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

  const candidate = initials.length >= 2 ? initials : (words[0] ?? '').toUpperCase();
  const trimmed = candidate.slice(0, 8);

  // Must start with a letter and be at least two characters.
  return /^[A-Za-z]/.test(trimmed) && trimmed.length >= 2 ? trimmed : '';
}

/**
 * Fold a page of rows into the list we already hold.
 *
 * Pure and exported so the tombstone rule can actually be **tested** rather
 * than asserted in a comment — it lived inside a hook first, where this package
 * has no renderer to reach it (LAI-058 AC2).
 *
 * Live rows upsert by id; tombstones **delete**. Sorted by name because this
 * list is a picker, and a picker ordered by whenever each row was last touched
 * is one nobody can scan.
 */
export function applyProjectRows(
  current: readonly Project[],
  rows: readonly ProjectRow[],
  mode: 'replace' | 'merge',
): Project[] {
  const byId = new Map(mode === 'replace' ? [] : current.map((p) => [p.id, p]));

  for (const row of rows) {
    if (isTombstone(row)) byId.delete(row.id);
    else byId.set(row.id, row);
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
