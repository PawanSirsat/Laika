/**
 * Where a task opens (LAI-1190, B2 and B18): **in its own space's drawer**.
 *
 * `?project=` names the space, so the view never falls back to the last space
 * it showed, and `?task=` opens the drawer. The ref is the task's id when the
 * caller has one, else its key — the drawer host resolves a key against the
 * space's tasks and rewrites it as the id.
 *
 * A key search (`/board?q=KEY`) is the answer only when the space cannot be
 * known: it at least shows the card, where a guess at the space could show
 * another space's board.
 */

export interface TaskLink {
  /** The task's id, when the caller has it. */
  readonly id?: string | undefined;
  /** The display key, `LAI-42`. */
  readonly key: string;
}

/** `/board?project=atlas&task=t1`, or on another view of the space with `path`. */
export function taskHref(task: TaskLink, slug: string | undefined, path = '/board'): string {
  if (slug === undefined) return `/board?q=${encodeURIComponent(task.key)}`;
  const params = new URLSearchParams({ project: slug, task: task.id ?? task.key });
  return `${path}?${params.toString()}`;
}

/**
 * The same task opened over the view already on screen: `params` with
 * `?project=` and `?task=` set. Every other key — the view's own filters —
 * is kept, so closing the drawer leaves the view as it was.
 */
export function withTaskOpen(
  params: URLSearchParams,
  task: TaskLink,
  slug: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('project', slug);
  next.set('task', task.id ?? task.key);
  next.delete('new');
  return next;
}

/**
 * The space a key belongs to, by its prefix, among the spaces the reader can
 * read. `undefined` when none owns it.
 */
export function slugOfKey(
  key: string,
  spaces: readonly { readonly prefix: string; readonly slug: string }[],
): string | undefined {
  const dash = key.lastIndexOf('-');
  if (dash <= 0) return undefined;
  const prefix = key.slice(0, dash);
  return spaces.find((space) => space.prefix === prefix)?.slug;
}

/**
 * The task's own page, the Workroom (LAI-1199): `/task/LAI-42`. By key, so
 * the address is the name people say and paste, and a cmd-click opens it in
 * a tab.
 */
export function workroomHref(key: string): string {
  return `/task/${encodeURIComponent(key)}`;
}
