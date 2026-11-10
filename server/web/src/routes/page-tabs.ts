import type { DeveloperAccessMode } from '../api/developer-compat.ts';

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
  readonly requires?: 'audit_log.export' | 'token.list_any' | 'time.report.read';
  /**
   * An address naming this tab, for a reader not offered it, shows the
   * not-allowed state rather than the first tab (LAI-951) — see `refusedTab`.
   */
  readonly refusedByAddress?: true;
  /**
   * A short word drawn after the label — *Preview* on the V3 Developer access
   * tabs while the flag is `preview` (LAI-1048). It is part of the link's
   * text, so a screen reader hears it too.
   */
  readonly badge?: string;
  /**
   * Drawn by its page after the tabs, as a quieter link, rather than as a tab
   * of its own — V3's *Advanced* (LAI-1096), which the owner's design leaves
   * out of its four tabs. **It is still a tab to `currentTab`**, so its
   * address opens it and every link to it keeps working.
   */
  readonly secondary?: true;
}

/**
 * Work handed back for a person, hand-offs between agents that concern them
 * (LAI-550), then work nobody filed (admin-up, §4.14).
 */
export const INBOX_TABS: readonly PageTab[] = [
  { id: 'review', label: 'Review' },
  { id: 'handoffs', label: 'Hand-offs' },
  { id: 'unlisted', label: 'Unlisted work', requires: 'audit_log.export' },
];

/**
 * Who is working on what, then what the agents spent — open to everyone —
 * then where people's time went (D-130, LAI-1138): **Time** is for owners and
 * holders of *See everyone's analytics* (`time.report.read`) and for space
 * admins, whose leading a space the Insights route folds into the same gate;
 * a link to it for anybody else says so rather than opening Capacity.
 */
export const INSIGHTS_TABS: readonly PageTab[] = [
  { id: 'capacity', label: 'Capacity' },
  { id: 'usage', label: 'Usage & cost' },
  { id: 'time', label: 'Time', requires: 'time.report.read', refusedByAddress: true },
];

/**
 * The organisation's register and settings, grouped. **Security is everyone's tokens**, so
 * it is an owner's or an admin's (§3.1 `token.list_any`); everyone else can
 * read the other three, and each section inside them keeps its own gate.
 * **Activity is every space's history** (LAI-951), behind the gate
 * `GET /activity/history` uses, §3.1 `audit_log.export`.
 */
export const ORGANISATION_TABS: readonly PageTab[] = [
  { id: 'overview', label: 'Overview' },
  // Everyone's work across every space (LAI-952), a tab since D-147
  // (LAI-1170): ungated, as the sidebar entry it replaces was — the server
  // decides whose tasks each reader is sent.
  { id: 'work', label: 'Work' },
  { id: 'people', label: 'People' },
  // Who may do what, for everyone: the endpoint is `org.read` (LAI-950).
  { id: 'roles', label: 'Roles & permissions' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'security', label: 'Security', requires: 'token.list_any' },
  { id: 'activity', label: 'Activity', requires: 'audit_log.export', refusedByAddress: true },
];

/**
 * Developer access (LAI-507): connecting an agent — the four-step wizard —
 * then the reader's registered agents (LAI-537, D-114), what is once per
 * project, what the organisation collects from the machine, and the reader's
 * tokens. Nothing is gated: every tab is about the reader. The order is the
 * order a new developer meets them.
 */
export const DEVELOPER_TABS: readonly PageTab[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'agents', label: 'Agents' },
  { id: 'projects', label: 'Projects' },
  { id: 'activity', label: 'Activity' },
  { id: 'tokens', label: 'Tokens' },
];

/**
 * The V3 tabs (plan §B, §C), in the owner's design (LAI-1078): a device is
 * paired once, its coding tools are listed on their own (*Tools*, LAI-1080),
 * and a project is set up on its own. `projects` keeps the classic id, so a
 * link to it means the same place in every mode. **Activity is not a tab of
 * its own here**: *Share local activity* is the second card on Advanced, and
 * `?tab=activity` lands on it (`developerAlias`).
 *
 * **The design has four tabs** (LAI-1096): Advanced is `secondary`, a quieter
 * link at the end of the row, so the four fit a phone's width — and an
 * address naming it still opens it.
 */
export const DEVELOPER_V3_TABS: readonly PageTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Project setup' },
  { id: 'devices', label: 'Devices' },
  { id: 'tools', label: 'Tools' },
  { id: 'advanced', label: 'Advanced', secondary: true },
];

/**
 * Where on Advanced `?section=` points (LAI-1078): the *Share local activity*
 * card, which was V3's Activity tab.
 */
export const ADVANCED_ACTIVITY_SECTION = 'activity';

/** The V3 tabs classic does not have — the ones `preview` adds, marked. */
const V3_ONLY = new Set(['overview', 'devices', 'tools', 'advanced']);

/** Whether `id` is a tab only the V3 Developer access has. */
export function isV3OnlyTab(id: string): boolean {
  return V3_ONLY.has(id);
}

/**
 * The Developer access tabs a mode offers. **Preview keeps every classic tab
 * and its order**, Connect still first and so still the default, and adds the
 * V3-only tabs after them, each marked *Preview* — Advanced as a tab like the
 * others, since preview's bar is not the design's.
 */
export function developerTabs(mode: DeveloperAccessMode): readonly PageTab[] {
  if (mode === 'v3') return DEVELOPER_V3_TABS;
  if (mode === 'classic') return DEVELOPER_TABS;
  return [
    ...DEVELOPER_TABS,
    ...DEVELOPER_V3_TABS.filter((tab) => V3_ONLY.has(tab.id)).map(({ id, label }) => ({
      id,
      label,
      badge: 'Preview',
    })),
  ];
}

/**
 * A page's tab row split in two (LAI-1096): the tabs it draws as tabs, then
 * the `secondary` ones it draws after them as quieter links.
 */
export function splitTabs(tabs: readonly PageTab[]): {
  readonly drawn: readonly PageTab[];
  readonly secondary: readonly PageTab[];
} {
  return {
    drawn: tabs.filter((tab) => tab.secondary !== true),
    secondary: tabs.filter((tab) => tab.secondary === true),
  };
}

/**
 * Where an old Developer access address lives in V3 (plan §C) — the new query,
 * or `undefined` when the address needs no change. **Only `v3` moves
 * anything**: `classic` and `preview` keep every old tab where it was.
 *
 * Applied as a `replace`, after `redirects.ts` has already turned `/connect`
 * and `/tokens` into `?tab=connect` and `?tab=tokens`. Every target is a V3
 * id with no alias of its own, so applying it twice changes nothing — there is
 * no loop to fall into.
 *
 * - `connect` is the Overview, unless it carried the wizard's state: `?agent=`
 *   (a tool to set up) or `?step=` (somewhere past choosing it). Then it is
 *   Tools with *Add a tool* open, the tool kept as `tool`.
 * - `agents` is Tools (LAI-1080); `?agent=<id>` names a tool there — its
 *   details — and travels as is. With `?add=device` it is Devices, where that
 *   wizard is.
 * - `devices` with a tool on it moves to Tools (LAI-1080): `?agent=<id>`, or
 *   `?add=tool` with whatever that wizard carried (`device`, `tool`,
 *   `exchange`, `reconnect`). Devices itself, its details and *Add device*
 *   stay.
 * - `tokens` is Advanced.
 * - `activity` is Advanced's *Share local activity* card (LAI-1078):
 *   `?section=activity`, which Advanced scrolls to.
 *
 * Everything else in the query is kept, in its order.
 */
export function developerAlias(
  mode: DeveloperAccessMode,
  params: URLSearchParams,
): URLSearchParams | undefined {
  if (mode !== 'v3') return undefined;
  const tab = params.get('tab');
  if (
    tab !== 'connect' &&
    tab !== 'agents' &&
    tab !== 'devices' &&
    tab !== 'tokens' &&
    tab !== 'activity'
  ) {
    return undefined;
  }

  const next = new URLSearchParams();
  const rest = [...params].filter(([key]) => key !== 'tab');
  const add = params.get('add');
  const agent = params.get('agent');

  if (tab === 'agents') {
    next.set('tab', add === 'device' ? 'devices' : 'tools');
    for (const [key, value] of rest) next.append(key, value);
    return next;
  }
  if (tab === 'devices') {
    const tool = add === 'tool' || (add === null && agent !== null && agent !== '');
    if (!tool) return undefined;
    next.set('tab', 'tools');
    for (const [key, value] of rest) next.append(key, value);
    return next;
  }
  if (tab === 'tokens') {
    next.set('tab', 'advanced');
    for (const [key, value] of rest) next.append(key, value);
    return next;
  }
  if (tab === 'activity') {
    next.set('tab', 'advanced');
    next.set('section', ADVANCED_ACTIVITY_SECTION);
    for (const [key, value] of rest) if (key !== 'section') next.append(key, value);
    return next;
  }

  const wizard = (agent !== null && agent !== '') || params.has('step');
  if (!wizard) {
    next.set('tab', 'overview');
    for (const [key, value] of rest) next.append(key, value);
    return next;
  }
  next.set('tab', 'tools');
  next.set('add', 'tool');
  if (agent !== null && agent !== '') next.set('tool', agent);
  for (const [key, value] of rest) {
    // The wizard's own two are spent: the tool travels as `tool`, and V3's
    // Add a tool has no numbered steps to land on.
    if (key === 'agent' || key === 'step' || key === 'add' || key === 'tool') continue;
    next.append(key, value);
  }
  return next;
}

/**
 * Where pages outside Developer access link into it (LAI-1058, plan §B.7),
 * per mode. A mode not yet known reads as `classic`, as an unreadable
 * manifest does (plan §I).
 */
export const DEVELOPER_ACTIVITY_HREF = '/developer?tab=activity';

/** The reader's own tokens: Tokens in classic, Advanced in preview and v3. */
export function ownTokensHref(mode: DeveloperAccessMode | undefined): string {
  return mode === 'preview' || mode === 'v3' ? '/developer?tab=advanced' : '/developer?tab=tokens';
}

export interface ProjectSetupLink {
  readonly href: string;
  /** Names the tab as this mode's bar does. */
  readonly label: string;
  /** Whether per-tool project grants are set there — V3's Project setup only. */
  readonly perTool: boolean;
}

/**
 * Where a repository is set up for a tool. Classic's tab is *Projects*;
 * preview's new flow is one query away from it (LAI-1052); v3's tab is
 * *Project setup*.
 */
export function projectSetupLink(mode: DeveloperAccessMode | undefined): ProjectSetupLink {
  if (mode === 'v3') {
    return {
      href: '/developer?tab=projects',
      label: 'Developer access · Project setup',
      perTool: true,
    };
  }
  if (mode === 'preview') {
    return {
      href: '/developer?tab=projects&setup=v3',
      label: 'Developer access · Project setup',
      perTool: true,
    };
  }
  return { href: '/developer?tab=projects', label: 'Developer access · Projects', perTool: false };
}

/**
 * A space's settings (D-103, LAI-977), in the owner's order. Every reader of
 * the space sees all four — read only without `project.settings.edit` — so
 * none is gated here; the controls inside each are.
 */
export const SPACE_SETTINGS_TABS: readonly PageTab[] = [
  { id: 'general', label: 'General' },
  { id: 'members', label: 'Members' },
  { id: 'access', label: 'Access' },
  { id: 'danger', label: 'Danger zone' },
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
 * The sidebar's Inbox count: what waits on Review, on Hand-offs (LAI-550) and
 * on Unlisted work. `undefined` for a count that is not this reader's or not
 * read yet, so a reader who may not triage unlisted work counts the others
 * alone — and nothing read at all is no badge rather than a zero that was
 * never measured.
 */
export function inboxCount(
  reviewWaiting: number | undefined,
  unlistedOpen: number | undefined,
  handoffsWaiting?: number,
): number | undefined {
  if (reviewWaiting === undefined && unlistedOpen === undefined && handoffsWaiting === undefined) {
    return undefined;
  }
  return (reviewWaiting ?? 0) + (unlistedOpen ?? 0) + (handoffsWaiting ?? 0);
}
