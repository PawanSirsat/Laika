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

/** The three sidebar groups, in the order `docs/design/README.md` fixes. */
export const NAV_GROUPS = ['WORK', 'REVIEW', 'SETTINGS'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

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
  /** Which phase brings it to life, so an empty state can say what it waits on. */
  readonly phase: string;
}

export const ROUTES: readonly Route[] = [
  // WORK
  { path: '/board', label: 'Board', group: 'WORK', phase: 'Phase 2' },
  { path: '/timeline', label: 'Timeline', group: 'WORK', phase: 'Phase 2.5' },
  { path: '/sprints', label: 'Sprints', group: 'WORK', phase: 'Phase 2' },
  { path: '/capacity', label: 'Capacity', group: 'WORK', phase: 'Phase 5' },

  // REVIEW
  { path: '/dashboard', label: 'Dashboard', group: 'REVIEW', phase: 'Phase 5' },
  { path: '/meeting-review', label: 'Meeting review', group: 'REVIEW', phase: 'Phase 6' },

  // SETTINGS
  { path: '/tokens', label: 'Tokens', group: 'SETTINGS', phase: 'Phase 3' },
  { path: '/organisation', label: 'Organisation', group: 'SETTINGS', phase: 'Phase 1' },

  // Routed, but not nav destinations.
  { path: '/projects', label: 'Projects', group: null, phase: 'Phase 2' },
  { public: true, path: '/login', label: 'Sign in', group: null, phase: 'Phase 1' },
  { public: true, path: '/invite', label: 'Accept invite', group: null, phase: 'Phase 2' },
  { public: true, path: '/first-boot', label: 'First boot', group: null, phase: 'Phase 1' },

  // The LAI-018 and LAI-020 reference pages. Kept reachable — both tasks
  // required them — but out of the product nav, since they are not product.
  { public: true, path: '/design/tokens', label: 'Design tokens', group: null, phase: 'reference' },
  { public: true, path: '/design/states', label: 'States', group: null, phase: 'reference' },
];

export const DEFAULT_PATH = '/board';

/** Exact match only. No params yet — the first is `/projects/:slug` in Phase 2. */
export function matchRoute(path: string): Route | undefined {
  const normalised = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return ROUTES.find((r) => r.path === normalised);
}

/** Routes reachable without signing in. */
export function isPublic(route: Route | undefined): boolean {
  return route?.public === true;
}

export function routesInGroup(group: NavGroup): readonly Route[] {
  return ROUTES.filter((r) => r.group === group);
}
