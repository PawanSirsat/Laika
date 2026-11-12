/**
 * The Usage page's pure parts (LAI-769): which spaces a reader may choose,
 * where they start, and the trend's scale. Kept out of the component so they
 * are tested without a browser.
 */

import type { TokenAlert } from '../../../api/token-alerts.ts';
import { USAGE_RANGES, type UsageRange } from '../../../api/usage.ts';

/** The range a page opens on when the address names none. */
export const DEFAULT_RANGE: UsageRange = 30;

/**
 * `?range=` (LAI-1201): the period the page shows, so a reload or a pasted
 * link keeps it. Read leniently — anything but 7, 30 or 90 is the default.
 */
export function usageRange(value: string | null | undefined): UsageRange {
  const found = USAGE_RANGES.find((r) => String(r.days) === value);
  return found === undefined ? DEFAULT_RANGE : found.days;
}

export interface ScopeProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/**
 * What the reader may read, as `GET /permissions` reports it (LAI-970) — never
 * their org role: `usage.read_org` for the organisation, `usage.read_project`
 * per space.
 */
export interface ScopeReader {
  readonly readsOrg: boolean;
  readonly readsSpace: (projectId: string) => boolean;
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
  const org = me.readsOrg;
  const spaces = projects
    .filter((p) => me.readsSpace(p.id))
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
export function spaceUsageHref(slug: string, range: number = DEFAULT_RANGE): string {
  // The period travels with the space (LAI-1201): opening a row keeps the range read.
  const period = range === DEFAULT_RANGE ? '' : `&range=${String(range)}`;
  return `/insights?tab=usage&project=${encodeURIComponent(slug)}${period}`;
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

/** One of the reader's own alerts as the Budget alerts card draws it (LAI-1127). */
export interface AlertRow {
  readonly alert: TokenAlert;
  /** Spent over the limit: 1 is the whole budget, or the whole p95. */
  readonly share: number;
  /** A budget alert at or past its budget. */
  readonly over: boolean;
}

/** The alerts, most spent against their limit first; ties keep the server's order. */
export function alertRows(alerts: readonly TokenAlert[]): AlertRow[] {
  return alerts
    .map((alert) => {
      const share = alert.limit_tokens > 0 ? alert.tokens / alert.limit_tokens : 0;
      return { alert, share, over: alert.kind === 'budget' && share >= 1 };
    })
    .sort((a, b) => b.share - a.share);
}

/** The Breakdown card's tabs (LAI-1127), in the design's order. */
export const BREAKDOWN_TABS = ['space', 'developer', 'agent', 'model'] as const;
export type BreakdownTab = (typeof BREAKDOWN_TABS)[number];

/**
 * The tabs a reading offers: *Space* only when the server sent `by_project` —
 * the organisation, for a reader who may read it — and the rest always, since
 * *Developer* says why it is empty for a reader who may not see people.
 */
export function breakdownTabs(hasSpaces: boolean): BreakdownTab[] {
  return BREAKDOWN_TABS.filter((t) => t !== 'space' || hasSpaces);
}

/**
 * The tab shown: the one picked while it is offered, else the first with
 * figures in it — by space, then by developer for a reader the server sent
 * people to, else by agent.
 */
export function breakdownTab(
  picked: BreakdownTab | undefined,
  tabs: readonly BreakdownTab[],
  readsPeople: boolean,
): BreakdownTab {
  if (picked !== undefined && tabs.includes(picked)) return picked;
  if (tabs.includes('space')) return 'space';
  return readsPeople ? 'developer' : 'agent';
}
