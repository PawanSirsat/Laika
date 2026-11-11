import type { TaskSummary } from '../../api/tasks.ts';
import { navRoutes, spaceTabs, SPACE_TAB_PATHS } from '../../routes/route-table.ts';
import { navHref } from '../../routes/nav-url.ts';

/**
 * What the command palette shows and when it opens (LAI-1192), kept apart
 * from the component so `node --test` can drive every rule here. The
 * component (`CommandPalette.tsx`) only renders these answers.
 */

/** The bits of a `KeyboardEvent` the shortcut reads. */
export interface PaletteKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

/**
 * ⌘K on a Mac, Ctrl+K elsewhere; both are accepted everywhere, since a
 * person on an external keyboard does not know which one we think they have.
 *
 * **Never a bare or Shift letter** (proposal §1.1): My day lowercases
 * `event.key`, so `K` and `Shift+K` are already its "previous row". Alt is
 * refused too: Alt+K types a character on several layouts.
 */
export function isPaletteShortcut(event: PaletteKey): boolean {
  if (event.altKey) return false;
  if (event.metaKey === event.ctrlKey) return false;
  return event.key.toLowerCase() === 'k';
}

/** The shortcut as the trigger prints it. */
export function shortcutLabel(mac: boolean): string {
  return mac ? '⌘K' : 'Ctrl K';
}

/** One row the palette can run. `href` rows navigate; the rest act. */
export interface PaletteItem {
  /** Unique within the palette; also cmdk's `value`. */
  readonly id: string;
  readonly label: string;
  /** A second line or trailing hint: a space's key, a view's space. */
  readonly hint?: string | undefined;
  /** Extra words the query may match: `theme` for *Switch to dark*. */
  readonly keywords?: readonly string[] | undefined;
  readonly href?: string | undefined;
}

/**
 * *Go to*: the sidebar's destinations, from the same table and the same
 * permission predicate (`navRoutes(holds)`), then the space's tabs from
 * `spaceTabs(holds)` — so the palette never offers a page the sidebar or the
 * tab bar hides. `holds` is the server's answer; `undefined` hides every
 * gated entry, as it does there.
 */
export function goToItems(
  holds: ((permission: string) => boolean) | undefined,
  projectSlug: string | undefined,
  spaceName: string | undefined,
): readonly PaletteItem[] {
  const deny = (): boolean => false;
  const ask = holds ?? deny;
  const nav = navRoutes(ask).map((route): PaletteItem => ({
    id: `go:${route.path}`,
    label: route.label,
    href: navHref(route.path, projectSlug),
  }));
  const tabs = spaceTabs(ask).map((route): PaletteItem => ({
    id: `go:${route.path}`,
    label: route.label,
    hint: spaceName,
    keywords: ['space', 'view'],
    href: navHref(route.path, projectSlug),
  }));
  return [...nav, ...tabs];
}

/** The space a palette row switches to. */
export interface PaletteSpace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly key: string;
}

/**
 * Where switching to a space goes: the same view of the new space when the
 * reader is on a space tab (Board stays Board), otherwise its board. Filters
 * tied to the old space are dropped, since only `?project=` is written.
 */
export function spaceHref(slug: string, currentPath: string): string {
  const path = SPACE_TAB_PATHS.includes(currentPath) ? currentPath : '/board';
  return navHref(path, slug);
}

/** *Spaces*: one row per readable space, the current one last-ranked out. */
export function spaceItems(
  spaces: readonly PaletteSpace[],
  currentSlug: string | undefined,
  currentPath: string,
): readonly PaletteItem[] {
  return spaces
    .filter((space) => space.slug !== currentSlug)
    .map((space): PaletteItem => ({
      id: `space:${space.slug}`,
      label: space.name,
      hint: space.key,
      keywords: [space.slug, 'space', 'switch'],
      href: spaceHref(space.slug, currentPath),
    }));
}

/**
 * The spaces index (`/projects`), which the sidebar reaches as *More spaces*:
 * every space, archived ones included, for when the one wanted is not listed.
 */
export function allSpacesItem(): PaletteItem {
  return {
    id: 'go:/projects',
    label: 'All spaces',
    keywords: ['spaces', 'projects', 'more', 'archived'],
    href: navHref('/projects', undefined),
  };
}

/** Whether a row answers a query: every word appears in its label, hint or keywords. */
export function itemMatches(item: PaletteItem, query: string): boolean {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return true;
  const hay = [item.label, item.hint ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase();
  return words.every((word) => hay.includes(word));
}

/** The palette's rows for a query, in their own order. */
export function filterItems(items: readonly PaletteItem[], query: string): readonly PaletteItem[] {
  return items.filter((item) => itemMatches(item, query));
}

/** A query that reads as a task key: `LAI-12`, `lai-1`, `LAIKA-`. */
const KEYISH = /^[a-z][a-z0-9]*-\d*$/i;

/** Whether the query is shaped like a task key, so key matches rank first. */
export function looksLikeKey(query: string): boolean {
  return KEYISH.test(query.trim());
}

/** The fewest characters before the palette asks the server for tasks. */
export const TASK_QUERY_MIN = 2;

/** How long typing must pause before a task search runs. */
export const TASK_DEBOUNCE_MS = 200;

/** How many task rows the palette shows. */
export const TASK_RESULT_LIMIT = 8;

/**
 * The tasks a query finds in what was loaded: an exact key first, then keys
 * that start with it, then titles containing every word. Ranked, capped at
 * `limit`, and never invented — every row is one the server returned.
 */
export function matchTasks(
  tasks: readonly TaskSummary[],
  query: string,
  limit: number = TASK_RESULT_LIMIT,
): readonly TaskSummary[] {
  const q = query.trim().toLowerCase();
  if (q.length < TASK_QUERY_MIN) return [];
  const words = q.split(/\s+/).filter((w) => w !== '');
  const rank = (task: TaskSummary): number => {
    const key = task.key.toLowerCase();
    // The outside id (`LAI-1192` on a `LAIKA-42` card) names it as exactly.
    if (key === q || (task.external_ref ?? '').toLowerCase() === q) return 0;
    if (key.startsWith(q)) return 1;
    const title = task.title.toLowerCase();
    return words.every((word) => title.includes(word)) ? 2 : -1;
  };
  return tasks
    .map((task, index) => ({ task, index, score: rank(task) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.task);
}

/**
 * Where opening a task goes: its own space's board with the drawer open, by
 * id (LAI-424, LAI-755). When the space is not one the reader's list knows,
 * the board's key search is the fallback, as `openTaskByKey` does.
 */
export function taskHref(
  task: Pick<TaskSummary, 'id' | 'key' | 'project_id'>,
  spaces: readonly Pick<PaletteSpace, 'id' | 'slug'>[],
): string {
  const slug = spaces.find((space) => space.id === task.project_id)?.slug;
  if (slug === undefined) return `/board?q=${encodeURIComponent(task.key)}`;
  return `/board?project=${encodeURIComponent(slug)}&task=${encodeURIComponent(task.id)}`;
}

/** What the live region says after the rows change. */
export function resultCountMessage(count: number, query: string): string {
  if (query.trim() === '') {
    return `${String(count)} command${count === 1 ? '' : 's'} available`;
  }
  if (count === 0) return `No results for ${query.trim()}`;
  return `${String(count)} result${count === 1 ? '' : 's'} for ${query.trim()}`;
}

/**
 * The empty state's suggestion: a key-shaped query is told how keys are
 * written, anything else is told what the palette searches.
 */
export function emptySuggestion(query: string): string {
  if (looksLikeKey(query)) return 'Check the key, for example LAI-42, or search by title.';
  return 'Try a page, a space or a task title, or fewer words.';
}
