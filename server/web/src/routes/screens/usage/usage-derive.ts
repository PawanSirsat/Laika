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
