import type { Project } from '../api/projects.ts';

/**
 * Spaces — the sidebar's model of projects you have opened (LAI-247).
 *
 * The live design calls a project a **space** and puts your three most recent
 * ones in the sidebar, then *More spaces*. Nothing here is fetched: a space is
 * a `Project` the app already has, plus a key and a line of meta.
 */

/** How many spaces the sidebar shows before *More spaces*. The design's number. */
export const RECENT_LIMIT = 3;

const STORAGE_KEY = 'laika.recent-spaces';

export interface Space {
  /** The project's ULID — monotonic, so sorting by it is creation order. */
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** Two letters, as the design's `LC` / `LW` / `LI`. */
  readonly key: string;
  /** `34 tasks · 4 members`, from counts the project list already carries. */
  readonly meta: string;
}

/**
 * A space's key is **the project's own `prefix`**, not something derived.
 *
 * The design keys its spaces `LC`, `LW`, `LI`, `LD`, and `Project.prefix` is
 * already exactly that — it is what makes a task `LC-42`. Our seeded instance
 * answers `LC` for `laika-core` and `LW` for `laika-web` without any help.
 *
 * **The first version of this file derived two letters from the name**, which
 * would have produced the same answer for these two and a different one the
 * moment a project's name and prefix disagreed — inventing a value beside real
 * data that already says it (§5.1). Kept only as the empty-string guard: the
 * key is the whole of a space's identity in a narrow sidebar.
 */
export function spaceKey(project: Pick<Project, 'prefix' | 'name'>): string {
  const prefix = project.prefix.trim();
  return prefix === '' ? project.name.trim().slice(0, 2).toUpperCase() || '??' : prefix;
}

/** `34 tasks · 4 members`, pluralised, from real counts. */
export function spaceMeta(project: Project): string {
  const tasks = Object.values(project.task_counts).reduce((sum, n) => sum + n, 0);
  const members = project.member_count;
  return `${String(tasks)} task${tasks === 1 ? '' : 's'} · ${String(members)} member${
    members === 1 ? '' : 's'
  }`;
}

export function toSpace(project: Project): Space {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    key: spaceKey(project),
    meta: spaceMeta(project),
  };
}

/**
 * The stored order of slugs, most recent first.
 *
 * Unreadable or malformed storage answers `[]` rather than throwing — a sidebar
 * that will not render because a string in `localStorage` is wrong is a worse
 * outcome than one that has forgotten which spaces you visited.
 */
export function readRecent(storage: Pick<Storage, 'getItem'>): readonly string[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

/**
 * Move `slug` to the front, keeping at most {@link RECENT_LIMIT}.
 *
 * Pure, so the ordering is testable without a browser. Writing is the caller's.
 */
export function promote(recent: readonly string[], slug: string): readonly string[] {
  return [slug, ...recent.filter((s) => s !== slug)].slice(0, RECENT_LIMIT);
}

export function writeRecent(storage: Pick<Storage, 'setItem'>, recent: readonly string[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Private browsing and full quotas both throw here. Losing the order is not
    // worth failing a navigation over.
  }
}

/**
 * The spaces to show: the most recent ones, **drawn in a stable order**.
 *
 * Two different questions, and conflating them was a defect the owner reported
 * (LAI-260). Recency answers *which* spaces are listed — with more than
 * {@link RECENT_LIMIT} projects something has to choose, and the ones you have
 * opened most recently is the design's rule. Recency must **not** answer what
 * order they are drawn in: when it did, clicking a space moved it to the top
 * and the rows shuffled under the pointer, so the row you wanted was never
 * where you last saw it.
 *
 * Sorted by name, therefore: deterministic, and it changes only when a project
 * is renamed or added. **Not** the order `GET /projects` returns, which is
 * `updated_at asc` and would reshuffle the sidebar whenever anything in a
 * project changed — the same defect arriving from the server instead of from a
 * click.
 *
 * **A remembered slug that no longer exists is dropped**, not rendered as a
 * broken row — a project can be deleted or a membership revoked between visits.
 */
export function recentSpaces(
  projects: readonly Project[],
  recent: readonly string[],
  current?: string,
): readonly Space[] {
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const ordered: string[] = [];
  // The project you are in is a space you are using, even on a first visit.
  for (const slug of [...(current === undefined ? [] : [current]), ...recent]) {
    if (bySlug.has(slug) && !ordered.includes(slug)) ordered.push(slug);
  }
  for (const p of projects) {
    if (ordered.length >= RECENT_LIMIT) break;
    if (!ordered.includes(p.slug)) ordered.push(p.slug);
  }
  return (
    ordered
      .slice(0, RECENT_LIMIT)
      .map((slug) => bySlug.get(slug))
      .filter((p): p is Project => p !== undefined)
      .map(toSpace)
      /*
       * **Creation order, which ids already carry** (LAI-271). Stable — the
       * point of LAI-260 — and it is the reference's order: `laika-core`,
       * `laika-web`, `laika-infra` is the order they were made, not the
       * alphabet. Ids are ULIDs, so sorting them sorts by creation time without
       * a second field.
       */
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}
