import type { SpaceColor } from '../theme/space-color.ts';
import type { ProjectIcon } from './projects.ts';

/**
 * What each space looks like — its name, colour and icon — by slug (D-152, LAI-1311).
 *
 * A space is shown in some eighty places, and most of them hold only what
 * their own endpoint sends: a slug and a name. So `ProjectMark` does not need
 * every view to carry the icon: every project the app reads — the list, one
 * space, a settings save, an icon change — is remembered here, and a mark
 * given only a slug draws what was last read for it. A change made in Space
 * settings reaches every mark on the page at once, because they all read the
 * one map.
 *
 * Module state, not React context, so `api/` can feed it without a provider;
 * marks subscribe with `useSyncExternalStore`. A slug nothing has read yet
 * has no look, and the mark draws its letter on the colour derived from the
 * slug — what a space with no colour shows anyway.
 */

export interface ProjectLook {
  /** The space's name, so a mark given only a slug can still say whose it is. */
  readonly name: string;
  readonly color: SpaceColor | null;
  readonly icon: ProjectIcon | null;
  /** The answer's `updated_at`, when it carried one: an older answer never replaces a newer. */
  readonly updatedAt: number | null;
}

/** Enough of a project to remember its look. `icon` absent is "not sent", which keeps what is known. */
export interface LookSource {
  readonly slug: string;
  readonly name: string;
  readonly color: SpaceColor | null;
  readonly icon?: ProjectIcon | null | undefined;
  readonly updated_at?: number | undefined;
}

const looks = new Map<string, ProjectLook>();
const listeners = new Set<() => void>();

function sameIcon(a: ProjectIcon | null, b: ProjectIcon | null): boolean {
  if (a === null || b === null) return a === b;
  if ('url' in a) return 'url' in b && a.url === b.url;
  return 'emoji' in b && a.emoji === b.emoji;
}

/**
 * Remember how these spaces look. A look that did not change keeps its object,
 * so a mark reading it does not render again; one that did tells every mark.
 *
 * **An answer older than the one held is ignored** (`updated_at`): a list
 * asked for before an icon change and answered after it would otherwise put
 * the old icon back on every mark.
 */
export function rememberProjects(rows: readonly LookSource[]): void {
  let changed = false;
  for (const row of rows) {
    const held = looks.get(row.slug);
    const updatedAt = row.updated_at ?? null;
    const heldAt = held?.updatedAt ?? null;
    if (heldAt !== null && updatedAt !== null && updatedAt < heldAt) continue;
    const icon = row.icon === undefined ? (held?.icon ?? null) : row.icon;
    if (held?.name === row.name && held.color === row.color && sameIcon(held.icon, icon)) {
      continue;
    }
    looks.set(row.slug, { name: row.name, color: row.color, icon, updatedAt });
    changed = true;
  }
  if (changed) for (const listener of listeners) listener();
}

/** How a space looks, or `undefined` when nothing has read it yet. */
export function lookOf(slug: string): ProjectLook | undefined {
  return looks.get(slug);
}

/** Be told when any look changes; the answer stops telling. */
export function subscribeLooks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget every look — signing out, and between tests. */
export function forgetLooks(): void {
  if (looks.size === 0) return;
  looks.clear();
  for (const listener of listeners) listener();
}
