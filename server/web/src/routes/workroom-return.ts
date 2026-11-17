import { matchRoute } from './route-table.ts';

/**
 * Where the Workroom came from (LAI-1199), so its *Back to …* can say which
 * view and step back to it.
 *
 * **Module state, not storage.** The drawer's *Expand* writes it just before
 * it pushes `/task/:key`, and the page reads it while the same document is
 * open. A reload or a pasted link starts with nothing remembered, which is
 * right: there is no entry of ours to step back to, so the page offers the
 * task's space instead. Nothing is written to `localStorage` or
 * `sessionStorage`.
 */
let remembered: { readonly key: string; readonly href: string } | undefined;

/** The view `href` the Workroom for `key` is being opened from. */
export function rememberWorkroomReturn(key: string, href: string): void {
  remembered = { key, href };
}

/** Forget it — for tests, and when the reader leaves by another way. */
export function forgetWorkroomReturn(): void {
  remembered = undefined;
}

export interface WorkroomReturn {
  /** Where *Back* goes. */
  readonly href: string;
  /** The view's name, for *Back to Board*. */
  readonly label: string;
  /**
   * The previous history entry is that view: *Back* is `history.back()`, so
   * the reader does not gain a second copy of the board in their history.
   */
  readonly stepBack: boolean;
}

/**
 * Where *Back* from the Workroom for `key` goes: the view the drawer was open
 * over when it was expanded, or — on a reload or a pasted link — that task in
 * its space's board with the drawer open.
 */
export function workroomReturn(
  key: string,
  fallback: { readonly slug: string | undefined; readonly taskId: string | undefined },
): WorkroomReturn {
  if (remembered?.key === key) {
    const href = remembered.href;
    const path = href.split('?')[0] ?? href;
    return { href, label: matchRoute(path)?.label ?? 'Board', stepBack: true };
  }
  if (fallback.slug === undefined) return { href: '/projects', label: 'Spaces', stepBack: false };
  const params = new URLSearchParams({ project: fallback.slug });
  if (fallback.taskId !== undefined) params.set('task', fallback.taskId);
  return { href: `/board?${params.toString()}`, label: 'Board', stepBack: false };
}
