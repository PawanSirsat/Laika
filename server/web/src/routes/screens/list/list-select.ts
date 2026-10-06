/**
 * The List's selection (LAI-496).
 *
 * **A derive module, not a renderer** (CONVENTIONS §4): every rule about what
 * a checkbox does lives here, where it can be pinned without a browser, and
 * `ListView` only places the boxes.
 *
 * The selection is a set of task ids. It is **held by `BoardScreen`**, not by
 * the view, because the view is unmounted on every reload (LAI-485's lesson:
 * sort and page were `useState` here and snapped back on each stream tick).
 */

export type PageState = 'none' | 'some' | 'all';

/** One shared empty set, so an untouched selection never re-renders anything. */
export const NO_SELECTION: ReadonlySet<string> = new Set<string>();

/** A row's id is all this module needs to know about it. */
interface Identified {
  readonly id: string;
}

export function toggleOne(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The header checkbox: **a partial page selects the rest; a full page clears
 * it.** That is what every mail client does, and it means one click always
 * reaches "everything on this page" from wherever the reader started.
 */
export function togglePage(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): ReadonlySet<string> {
  const next = new Set(selected);
  if (pageState(selected, pageIds) === 'all') {
    for (const id of pageIds) next.delete(id);
  } else {
    for (const id of pageIds) next.add(id);
  }
  return next;
}

/** What the header checkbox draws. An empty page is `none`, never `all`. */
export function pageState(selected: ReadonlySet<string>, pageIds: readonly string[]): PageState {
  if (pageIds.length === 0) return 'none';
  let hits = 0;
  for (const id of pageIds) if (selected.has(id)) hits += 1;
  if (hits === 0) return 'none';
  return hits === pageIds.length ? 'all' : 'some';
}

/** *Select all*: every row the filter left, across every page. */
export function selectAll(rows: readonly Identified[]): ReadonlySet<string> {
  return new Set(rows.map((row) => row.id));
}

/**
 * What the screen **acts on**: the stored set pruned to the rows on screen.
 *
 * The stored set is a view, not a write — it keeps ids the current filter
 * hides, so widening the filter brings them back — but a bulk action may
 * only reach what the reader can see, or "12 selected" would send thirteen
 * requests. Returns the same set when nothing is pruned, so a render that
 * compares by identity sees no change.
 */
export function effectiveSelection(
  selected: ReadonlySet<string>,
  rows: readonly Identified[],
): ReadonlySet<string> {
  const visible = new Set<string>();
  for (const row of rows) if (selected.has(row.id)) visible.add(row.id);
  return visible.size === selected.size ? selected : visible;
}
