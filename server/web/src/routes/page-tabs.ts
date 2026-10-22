/**
 * The tabs of the pages that hold several screens (LAI-796).
 *
 * The owner's reorganisation keeps fewer places in the sidebar and puts
 * related screens behind tabs: **Inbox** holds the two queues a person works
 * through, **Insights** the two pages that read across the organisation, and
 * **Organisation** its settings in four groups. Each screen is the one that
 * existed before; only where it sits changed.
 *
 * The tab is `?tab=` in the address, so a tab is a link someone can paste and
 * Back walks the tabs as they were seen.
 */

export interface PageTab {
  readonly id: string;
  readonly label: string;
  /**
   * A permission the reader must hold for the tab to appear at all — **absent,
   * not disabled** (LAI-082), as a sidebar entry is. Read through
   * `permissionHolder`, so the client mirrors `policy/can.ts` in one place.
   */
  readonly requires?: 'audit_log.export' | 'token.list_any';
  /**
   * An address naming this tab, for a reader not offered it, shows the
   * not-allowed state rather than the first tab (LAI-951) — see `refusedTab`.
   */
  readonly refusedByAddress?: true;
}

/** Work handed back for a person, then work nobody filed (admin-up, §4.14). */
export const INBOX_TABS: readonly PageTab[] = [
  { id: 'review', label: 'Review' },
  { id: 'unlisted', label: 'Unlisted work', requires: 'audit_log.export' },
];

/** Who is working on what, then what the agents spent. Open to everyone. */
export const INSIGHTS_TABS: readonly PageTab[] = [
  { id: 'capacity', label: 'Capacity' },
  { id: 'usage', label: 'Usage & cost' },
];

/**
 * The organisation's settings, grouped. **Security is everyone's tokens**, so
 * it is an owner's or an admin's (§3.1 `token.list_any`); everyone else can
 * read the other three, and each section inside them keeps its own gate.
 * **Activity is every space's history** (LAI-951), behind the gate
 * `GET /activity/history` uses, §3.1 `audit_log.export`.
 */
export const ORGANISATION_TABS: readonly PageTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  // Who may do what, for everyone: the endpoint is `org.read` (LAI-950).
  { id: 'roles', label: 'Roles & permissions' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'security', label: 'Security', requires: 'token.list_any' },
  { id: 'activity', label: 'Activity', requires: 'audit_log.export', refusedByAddress: true },
];

/**
 * The tabs this reader is offered. **Omitting `holds` hides every gated tab**:
 * a caller that forgets to say who is asking must not publish what the
 * endpoints behind it would refuse — the rule `permitted` keeps for the nav.
 */
export function visibleTabs(
  tabs: readonly PageTab[],
  holds?: (permission: string) => boolean,
): readonly PageTab[] {
  return tabs.filter((tab) => tab.requires === undefined || holds?.(tab.requires) === true);
}

/**
 * The tab an address opens: the one `?tab=` names when this reader is offered
 * it, otherwise the first. An old link to a tab someone may not open lands on
 * the page rather than on nothing.
 */
export function currentTab(
  tabs: readonly PageTab[],
  params: URLSearchParams,
  holds?: (permission: string) => boolean,
): string {
  const shown = visibleTabs(tabs, holds);
  const asked = params.get('tab');
  return shown.find((tab) => tab.id === asked)?.id ?? shown[0]?.id ?? '';
}

/**
 * The tab an address names that this reader may not open, when that tab says
 * so rather than falling back (`refusedByAddress`). The Organisation's history
 * is the case: a link to it shared with a member should tell them it is not
 * theirs, not quietly show them the Overview as if that were what was sent.
 */
export function refusedTab(
  tabs: readonly PageTab[],
  params: URLSearchParams,
  holds?: (permission: string) => boolean,
): PageTab | undefined {
  const asked = tabs.find((tab) => tab.id === params.get('tab'));
  if (asked?.refusedByAddress !== true) return undefined;
  return visibleTabs([asked], holds).length === 0 ? asked : undefined;
}

/** A tab's address on its page. */
export function tabHref(path: string, id: string): string {
  return `${path}?tab=${encodeURIComponent(id)}`;
}

/**
 * The sidebar's Inbox count: what waits on Review plus what waits on Unlisted
 * work. `undefined` for a count that is not this reader's or not read yet, so
 * a reader who may not triage unlisted work counts Review alone — and nothing
 * read at all is no badge rather than a zero that was never measured.
 */
export function inboxCount(
  reviewWaiting: number | undefined,
  unlistedOpen: number | undefined,
): number | undefined {
  if (reviewWaiting === undefined && unlistedOpen === undefined) return undefined;
  return (reviewWaiting ?? 0) + (unlistedOpen ?? 0);
}
