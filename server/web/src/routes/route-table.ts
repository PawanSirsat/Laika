/**
 * Every route in the app, in one table.
 *
 * The sidebar, the router and the document title all read from here, so a route
 * cannot exist without nav treatment being a deliberate choice — which is what
 * stops a screen quietly appearing in the nav, or a nav item pointing nowhere.
 *
 * Screens come from SPEC §11.4.2. Two of its rows are deliberately absent:
 *
 *  - **Calendar** — no decision, no endpoints, no entry in FEATURES.md
 *    (SPEC §14 q10). LAI-019 excludes it by name.
 *  - **Laika Assistant** — listed as "undefined — three questions first"
 *    (§14 q9). A route for a screen with no definition could only render a
 *    "coming soon" placeholder, which LAI-019 forbids.
 *
 * **Task detail** is absent for a different reason: SPEC §11.4.2 calls it a
 * slide-over on the Board, not a nav item, so it belongs to the Board's work.
 */

/**
 * The sidebar's groups, top to bottom (LAI-796, the owner's reference).
 *
 * - **`HOME`** — the reader's own places: *My day* and *Inbox*. No heading;
 *   they lead the rail because they are where a day starts.
 * - **`SPACES`** sits between, and is deliberately not here: its rows are the
 *   projects you opened, built from the project list rather than from routes.
 * - **`ORG`** — what reads across every space or belongs to the organisation:
 *   *Insights*, *Organisation* and *Developer access*, under the heading
 *   *Organisation*.
 *
 * **Fewer places than before, not fewer screens.** Capacity, Review, Usage,
 * Unlisted work, Connect and Tokens each had an entry until LAI-796; they are
 * tabs or sections of the pages above now, and their old addresses redirect
 * (`redirects.ts`). The history of each is in LAI-754, LAI-758, LAI-769 and
 * LAI-622.
 */
export const NAV_GROUPS = ['HOME', 'ORG'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/** The heading above a group, or `null` for none. */
export const GROUP_TITLES: Readonly<Record<NavGroup, string | null>> = {
  HOME: null,
  ORG: 'Organisation',
};

/** The glyph a sidebar entry wears, in the rail and beside its label. */
export const NAV_ICONS = ['day', 'inbox', 'insights', 'organisation', 'developer'] as const;
export type NavIconName = (typeof NAV_ICONS)[number];

export interface Route {
  readonly path: string;
  /**
   * Requires a signed-in user. Everything is protected except the pre-auth
   * screens — a default of "protected" means forgetting to mark a route leaves
   * it closed rather than open.
   */
  readonly public?: true;
  /** Sidebar label and document title. */
  readonly label: string;
  /**
   * Which sidebar group it appears in. `null` means the route exists but is not
   * a nav destination — pre-auth screens, org-level pickers, and the design
   * reference pages.
   *
   * There is deliberately no `SYSTEM` group: the prototype has one so every
   * screen is reachable in a single file, and CLAUDE.md §5.1 says not to ship
   * it.
   */
  readonly group: NavGroup | null;
  /**
   * The screen draws its own chrome — Laika mark, wordmark **and** theme
   * control — so the shell adds no header at all.
   *
   * First boot is a full-page design (`6a`) whose left rail runs the height of
   * the page and carries all three. Letting the shell add its header put a
   * second wordmark above the rail and a bar across the top the design does not
   * have.
   *
   * Absent means "the shell provides the chrome", which is the safe default: a
   * new route gets the brand and the theme control rather than losing them.
   * Anything setting this **must** render both — `shell-chrome.test.ts` checks.
   */
  readonly ownsChrome?: true;
  /**
   * The destination is not about one project, so a nav link to it drops
   * `?project=` (LAI-423).
   *
   * **Marked as the exception, because carrying the project is the default.**
   * A new route that forgets this keeps the reader's context and ignores a
   * param it does not read — harmless. The opposite default loses the context
   * silently, which is the defect this flag exists because of.
   */
  readonly orgLevel?: true;
  /**
   * A permission the reader must hold for this entry to appear at all.
   *
   * **Absent, not disabled** (LAI-082): a disabled entry still advertises a
   * screen that cannot open, and every endpoint behind one answers `403`. The
   * value names a policy action rather than a role, so the client mirrors
   * `policy/can.ts` at one remove instead of hard-coding "admin" beside a rule
   * that could change.
   */
  readonly requires?: 'audit_log.export' | 'profile.read';
  /**
   * How far this route actually is, which is what decides whether it appears in
   * the nav (LAI-082).
   *
   * - `ready` — a real screen, wired to real endpoints.
   * - `building` — a registered shell someone is filling in right now (D-028).
   * - absent — no screen. The route still resolves, so a direct URL renders the
   *   placeholder, but **it is not offered in the nav**.
   *
   * The default is the hidden one on purpose. Seven of eight sidebar entries
   * were dead links because visibility was the default and hiding took an act
   * of memory; this way a screen has to earn its place by having been built.
   */
  readonly status?: 'ready' | 'building';
  /** Which phase brings it to life, so an empty state can say what it waits on. */
  readonly phase: string;
  /**
   * The icon for the collapsed rail (LAI-796), which replaced LAI-249's two
   * letters: the owner asked for a rail of icons. Only grouped routes need one
   * — nothing else renders in the rail.
   */
  readonly icon?: NavIconName;
  /**
   * The sidebar entry this page belongs under, when it is not one itself: the
   * Connect wizard is reached from Developer access and lights it.
   */
  readonly section?: string;
}

export const ROUTES: readonly Route[] = [
  // WORK
  {
    path: '/board',
    label: 'Board',
    group: null /* a space tab */,
    status: 'ready',
    phase: 'Phase 2',
  },
  {
    path: '/list',
    label: 'List',
    group: null /* a space tab */,
    status: 'ready',
    phase: 'Phase 2',
  },
  {
    path: '/timeline',
    label: 'Timeline',
    group: null /* a space tab */,
    status: 'building',
    phase: 'Phase 2.5',
  },
  {
    path: '/calendar',
    label: 'Calendar',
    group: null /* a space tab */,
    status: 'ready',
    phase: 'Phase 2.5',
  },
  {
    path: '/sprints',
    label: 'Sprints',
    group: null /* a space tab */,
    status: 'building',
    phase: 'Phase 2',
  },
  {
    path: '/projects',
    label: 'Projects',
    group: null /* reached as "More spaces" in the SPACES section */,
    status: 'ready',
    phase: 'Phase 2',
  },

  // REVIEW
  {
    path: '/dashboard',
    label: 'Dashboard',
    group: null /* a space tab */,
    status: 'building',
    phase: 'Phase 5',
  },
  /*
   * **The board's rail, promoted to a tab** (the owner's updated design).
   *
   * Space-scoped: the stream, the sessions and the stale list are all about
   * *this* space, so the tab carries `?project=` like every other.
   */
  {
    path: '/activity',
    label: 'Activity',
    group: null /* a space tab */,
    status: 'ready',
    phase: 'Phase 5',
  },
  {
    path: '/meeting-review',
    label: 'Meeting review',
    group: null /* a space tab */,
    // Offered now that there is a screen behind it (LAI-455) — the same rule
    // that gave `Tokens` and `Capacity` their places back.
    status: 'ready',
    phase: 'Phase 6',
  },

  /*
   * **The reader's own places, at the top of the rail** (LAI-796).
   *
   * *My day* moved up from under the person's name (LAI-787 put it there):
   * the owner's reference leads the rail with it. It is still about whoever
   * is signed in and nobody else — every signed-in person has one.
   */
  {
    orgLevel: true,
    path: '/my-day',
    label: 'My day',
    group: 'HOME',
    status: 'ready',
    phase: 'Phase 8',
    icon: 'day',
  },
  /*
   * **Inbox** (LAI-796): the two queues a person works through, as tabs —
   * *Review*, work agents handed back for a person (D-082, LAI-758), and
   * *Unlisted work*, work nobody filed (§4.14, admin-up, LAI-754). Not gated:
   * everyone signed in has a review queue; the Unlisted tab keeps its gate.
   * Its count is the two counts added.
   */
  {
    orgLevel: true,
    path: '/inbox',
    label: 'Inbox',
    group: 'HOME',
    status: 'ready',
    phase: 'Phase 5',
    icon: 'inbox',
  },
  /*
   * **Insights** (LAI-796): *Capacity* (LAI-754) and *Usage & cost* (D-084,
   * LAI-769), the two pages that read across every space, as tabs. Not gated —
   * the server decides what each reader is sent, as it did on both pages.
   */
  {
    orgLevel: true,
    path: '/insights',
    label: 'Insights',
    group: 'ORG',
    status: 'ready',
    phase: 'Phase 5',
    icon: 'insights',
  },
  {
    orgLevel: true,
    path: '/organisation',
    label: 'Organisation',
    group: 'ORG',
    phase: 'Phase 1',
    status: 'ready',
    icon: 'organisation',
  },
  /*
   * **Developer access** (LAI-796): connecting an agent and the reader's own
   * tokens on one page — what Connect (LAI-622) and Tokens were. The full
   * Connect wizard, every agent and every step, keeps its own address below
   * and is opened from here.
   */
  {
    orgLevel: true,
    path: '/developer',
    label: 'Developer access',
    group: 'ORG',
    status: 'ready',
    phase: 'Phase 4',
    icon: 'developer',
  },
  {
    orgLevel: true,
    path: '/developer/connect',
    label: 'Connect an agent',
    group: null /* opened from Developer access */,
    section: '/developer',
    status: 'ready',
    phase: 'Phase 4',
  },

  /*
   * **One member's profile** (LAI-743, D-078) — `?user=` names who.
   *
   * Owners and admins only: the server answers `profile.read` to nobody else,
   * and a token never. Reached from a person, not from the nav — a name on
   * Organisation's member list, a *Work by person* row, a Capacity card — and
   * those links are drawn only for a reader who may open it.
   */
  {
    orgLevel: true,
    requires: 'profile.read',
    path: '/people',
    label: 'Member profile',
    group: null,
    status: 'ready',
    phase: 'Phase 7',
  },

  // Routed and reachable by URL, but not offered in the nav: no screen behind
  // them yet, so an entry would be a dead link. They come back the moment they
  // have a `status`.

  // Reached from a project rather than the nav.
  { path: '/members', label: 'Members', group: null, status: 'ready', phase: 'Phase 2' },
  { public: true, path: '/login', label: 'Sign in', group: null, phase: 'Phase 1' },
  { public: true, path: '/invite', label: 'Accept invite', group: null, phase: 'Phase 2' },
  {
    public: true,
    path: '/setup',
    label: 'First boot',
    group: null,
    ownsChrome: true,
    phase: 'Phase 1',
  },

  // The LAI-018 and LAI-020 reference pages. Kept reachable — both tasks
  // required them — but out of the product nav, since they are not product.
  { public: true, path: '/design/tokens', label: 'Design tokens', group: null, phase: 'reference' },
  { public: true, path: '/design/states', label: 'States', group: null, phase: 'reference' },
];

/**
 * The views that live **inside** a space, in the order the tab bar shows them,
 * **in two groups** (LAI-796, the owner's reference): the four ways of looking
 * at the work — Board, List, Timeline, Calendar — then the four about how it is
 * going — Sprints, Dashboard, Activity, Meeting review. The bar draws a
 * hairline between the groups.
 *
 * The design's own strip, **without Capacity** since LAI-754: the owner moved
 * it out of the space as one page across every space, so a tab offering it
 * from inside one space would be a second answer to the same question.
 *
 * **Activity is a tab** (the owner's updated design, 2026-09-18). It carries
 * what used to be the board's right rail — the live stream, the agent
 * sessions and what has gone quiet.
 */
export const SPACE_TAB_GROUPS: readonly (readonly string[])[] = [
  ['/board', '/list', '/timeline', '/calendar'],
  ['/sprints', '/dashboard', '/activity', '/meeting-review'],
];

/** Every tab, in order — the groups above, flattened. */
export const SPACE_TAB_PATHS: readonly string[] = SPACE_TAB_GROUPS.flat();

function tabRoute(path: string): Route {
  const route = ROUTES.find((r) => r.path === path);
  if (route === undefined) {
    throw new Error(`SPACE_TAB_GROUPS names ${path}, which is not in ROUTES`);
  }
  return route;
}

function offered(route: Route, holds?: (permission: string) => boolean): boolean {
  return isShipped(route) && (route.requires === undefined || (holds?.(route.requires) ?? true));
}

/**
 * The tabs, resolved against `ROUTES` so a renamed or deleted path cannot leave
 * a tab pointing at nothing.
 */
export function spaceTabs(holds?: (permission: string) => boolean): readonly Route[] {
  return spaceTabGroups(holds).flat();
}

/** The tabs in their groups, an empty group dropped so no hairline hangs alone. */
export function spaceTabGroups(
  holds?: (permission: string) => boolean,
): readonly (readonly Route[])[] {
  return SPACE_TAB_GROUPS.map((group) =>
    group.map(tabRoute).filter((route) => offered(route, holds)),
  ).filter((group) => group.length > 0);
}

export const DEFAULT_PATH = '/board';

/**
 * The sidebar entry a path lights: its own, or the one its route names as its
 * `section` (the Connect wizard lights Developer access).
 */
export function navSection(path: string): string {
  return matchRoute(path)?.section ?? path;
}

/** Exact match only. No params yet — the first is `/projects/:slug` in Phase 2. */
export function matchRoute(path: string): Route | undefined {
  const normalised = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return ROUTES.find((r) => r.path === normalised);
}

/** Routes reachable without signing in. */
export function isPublic(route: Route | undefined): boolean {
  return route?.public === true;
}

/**
 * Does this route get a nav entry?
 *
 * One rule, read by the sidebar and by the test that guards it. A route with no
 * `status` has no screen behind it, so offering it in the nav is offering a dead
 * link — which is exactly what shipped: seven of eight destinations were empty
 * placeholders and nothing in the code could tell.
 */
export function isShipped(route: Route): boolean {
  return route.status !== undefined;
}

/**
 * Does the reader hold what this entry requires?
 *
 * An entry with no `requires` is open to anyone signed in. `holds` is supplied
 * by the caller — the shell knows the actor, this table does not. **Omitting it
 * hides every gated entry**: a caller that forgets to say who is asking must
 * not publish what the endpoints behind it would refuse (`nav-truth.test.ts`).
 *
 * Exported so the gate can be tested on a fixture route (LAI-484). Since
 * LAI-796 no grouped route is gated — Unlisted work is a tab of Inbox, gated
 * there by `page-tabs.ts` through the same predicate.
 */
export function permitted(route: Route, holds?: (permission: string) => boolean): boolean {
  if (route.requires === undefined) return true;
  return holds?.(route.requires) === true;
}

/** Nav entries for a group — shipped routes the reader may actually open. */
export function routesInGroup(
  group: NavGroup,
  holds?: (permission: string) => boolean,
): readonly Route[] {
  return ROUTES.filter((r) => r.group === group && isShipped(r) && permitted(r, holds));
}

/** Every route offered in the nav, in table order. */
export function navRoutes(holds?: (permission: string) => boolean): readonly Route[] {
  return ROUTES.filter((r) => r.group !== null && isShipped(r) && permitted(r, holds));
}
