import { mayReadOrgUsage } from '../../../api/usage.ts';

/**
 * The Usage page's pure parts (LAI-769): which spaces a reader may choose,
 * where they start, and the trend's scale. Kept out of the component so they
 * are tested without a browser.
 */

export interface ScopeProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface ScopeReader {
  readonly org_role: string;
  readonly memberships: readonly { readonly project_id: string }[];
}

/**
 * The space selector's options. An owner or admin reads the whole
 * organisation first (`''`) and then any space; a member reads only the spaces
 * they are in (§3.2's `usage.read_project` needs a project role), never the
 * organisation — so they are not offered it, rather than refused it.
 */
export function scopeOptions(
  me: ScopeReader,
  projects: readonly ScopeProject[],
): { readonly value: string; readonly label: string }[] {
  const org = mayReadOrgUsage(me.org_role);
  const mine = new Set(me.memberships.map((m) => m.project_id));
  const spaces = projects
    .filter((p) => org || mine.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.slug, label: p.name }));
  return org ? [{ value: '', label: 'All spaces' }, ...spaces] : spaces;
}

/** Where the page opens: the organisation, or a member's first space by name. */
export function defaultScope(
  me: ScopeReader,
  projects: readonly ScopeProject[],
): string | undefined {
  return scopeOptions(me, projects)[0]?.value;
}

/**
 * The space the page shows (LAI-814): the one `?project=` names when this
 * reader is offered it — a By space row, a pasted link — otherwise where the
 * page opens. A space they may not read falls back rather than asking for a
 * 403.
 */
export function scopeFor(
  me: ScopeReader,
  projects: readonly ScopeProject[],
  asked: string | undefined,
): string | undefined {
  if (asked !== undefined && scopeOptions(me, projects).some((o) => o.value === asked)) {
    return asked;
  }
  return defaultScope(me, projects);
}

/**
 * The spaces the selector offers, All spaces aside (LAI-814 review) — the
 * only ones a `?project=` link opens. `null` when the space list did not load.
 */
export function offeredSpaces(
  me: ScopeReader,
  projects: readonly ScopeProject[] | null,
): ReadonlySet<string> | null {
  if (projects === null) return null;
  return new Set(
    scopeOptions(me, projects)
      .map((o) => o.value)
      .filter((value) => value !== ''),
  );
}

/**
 * How a By space row names its space (LAI-814 review): a link to its own view
 * only when the selector offers it, since `?project=` for any other opens All
 * spaces. A space the server counts and the loaded list lacks is archived —
 * `GET /projects` sends one as a tombstone. With no list, nothing is known.
 */
export function spaceRow(
  slug: string,
  offered: ReadonlySet<string> | null,
): 'link' | 'archived' | 'plain' {
  if (offered === null) return 'plain';
  return offered.has(slug) ? 'link' : 'archived';
}

/** One space's own Usage view: Insights → Usage & cost, `?project=` (LAI-814). */
export function spaceUsageHref(slug: string): string {
  return `/insights?tab=usage&project=${encodeURIComponent(slug)}`;
}

/**
 * A bar's height in percent of the tallest, from a shared zero baseline. A day
 * with any tokens is drawn at least 2% tall, so it never reads as none.
 */
export function barHeight(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

/** The axis labels under the trend: the first day, the middle one and the last. */
export function axisDays(days: readonly string[]): string[] {
  if (days.length === 0) return [];
  if (days.length === 1) return [days[0] ?? ''];
  const first = days[0] ?? '';
  const last = days.at(-1) ?? '';
  const middle = days[Math.floor((days.length - 1) / 2)] ?? '';
  return days.length === 2 ? [first, last] : [first, middle, last];
}

/** `17 Oct` — a day as the axis and tooltips print it. */
export function dayLabel(day: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(at.getTime())
    ? day
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
