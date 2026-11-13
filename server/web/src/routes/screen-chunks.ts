import { chunksFor, type ScreenChunk } from './route-table.ts';

/**
 * The `import()` behind every screen chunk (LAI-1219), and the one cache of
 * them. `ROUTE_CHUNKS` in `route-table.ts` chooses which chunk a route's
 * screen is in; this file says where that chunk's code lives.
 *
 * A chunk of several modules imports them **together**, so its parts arrive
 * in parallel and never one after another — the bundler may still write them
 * as separate files, which is fine: the waterfall was the cost, not the file
 * count.
 */
const LOADERS = {
  'space-frame': () => import('../components/space/SpaceLayout.tsx'),
  board: () => import('./screens/BoardScreen.tsx'),
  timeline: () => import('./screens/timeline/TimelineScreen.tsx'),
  calendar: () => import('./screens/calendar/CalendarScreen.tsx'),
  sprints: () => import('./screens/sprints/SprintsScreen.tsx'),
  dashboard: () => import('./screens/dashboard/DashboardScreen.tsx'),
  activity: () => import('./screens/activity/ActivityScreen.tsx'),
  'meeting-review': () => import('./screens/meeting-review/MeetingReviewScreen.tsx'),
  projects: () => import('./screens/ProjectsScreen.tsx'),
  'my-day': () => import('./screens/my-day/MyDayScreen.tsx'),
  inbox: async () => {
    const [inbox, review, unlisted] = await Promise.all([
      import('./screens/inbox/InboxScreen.tsx'),
      import('./screens/review/ReviewScreen.tsx'),
      import('./screens/unlisted/UnlistedScreen.tsx'),
    ]);
    return { ...inbox, ...review, ...unlisted };
  },
  insights: async () => {
    const [insights, capacity, usage, time] = await Promise.all([
      import('./screens/insights/InsightsScreen.tsx'),
      import('./screens/capacity/CapacityScreen.tsx'),
      import('./screens/usage/UsageScreen.tsx'),
      import('./screens/insights/TimeTab.tsx'),
    ]);
    return { ...insights, ...capacity, ...usage, ...time };
  },
  organisation: () => import('./screens/organisation/OrganisationScreen.tsx'),
  developer: () => import('./screens/developer/DeveloperScreen.tsx'),
  members: () => import('./screens/MembersScreen.tsx'),
  'space-settings': () => import('./screens/space-settings/SpaceSettingsScreen.tsx'),
  workroom: () => import('./screens/workroom/WorkroomScreen.tsx'),
  profile: () => import('./screens/profile/ProfileScreen.tsx'),
  appearance: () => import('./screens/appearance/AppearanceScreen.tsx'),
  auth: async () => {
    const [login, invite, reset, setup] = await Promise.all([
      import('./screens/LoginRoute.tsx'),
      import('./screens/InviteRoute.tsx'),
      import('./screens/ResetPasswordRoute.tsx'),
      import('./screens/SetupRoute.tsx'),
    ]);
    return { ...login, ...invite, ...reset, ...setup };
  },
  reference: async () => {
    const [tokens, states, documents] = await Promise.all([
      import('../theme/TokenReference.tsx'),
      import('../components/StateGallery.tsx'),
      import('../components/documents/DocumentsTrialRoute.tsx'),
    ]);
    return { ...tokens, ...states, ...documents };
  },
} satisfies Record<ScreenChunk, () => Promise<object>>;

/** Every chunk name with a loader — `screen-chunks.test.ts` holds it to `SCREEN_CHUNKS`. */
export const LOADED_CHUNKS: readonly string[] = Object.keys(LOADERS);

/** What a chunk's loader resolves to: its modules' exports, merged. */
export type ChunkModule<K extends ScreenChunk> = Awaited<ReturnType<(typeof LOADERS)[K]>>;

/**
 * A screen chunk that could not be fetched — offline, or a deploy replaced the
 * file names since this page loaded. The screen boundary offers Try again for
 * this error and for no other: a screen that throws while rendering is a bug,
 * and retrying the import would not fix it.
 */
export class ChunkLoadError extends Error {
  readonly chunk: ScreenChunk;

  constructor(chunk: ScreenChunk, cause: unknown) {
    super(`The ${chunk} screen could not be loaded`, { cause });
    this.name = 'ChunkLoadError';
    this.chunk = chunk;
  }
}

/** In flight or settled; a failure is dropped, so the next ask fetches again. */
const loading = new Map<ScreenChunk, Promise<object>>();
/** Chunks that have arrived, readable without waiting. */
const arrived = new Map<ScreenChunk, object>();

/**
 * A chunk's modules, fetched once. A failed fetch is forgotten rather than
 * cached, which is what lets Try again — or the next hover — ask again.
 */
export function loadChunk<K extends ScreenChunk>(chunk: K): Promise<ChunkModule<K>> {
  let pending = loading.get(chunk);
  if (pending === undefined) {
    pending = (LOADERS[chunk]() as Promise<object>).then(
      (module) => {
        arrived.set(chunk, module);
        return module;
      },
      (error: unknown) => {
        loading.delete(chunk);
        throw new ChunkLoadError(chunk, error);
      },
    );
    loading.set(chunk, pending);
  }
  return pending as Promise<ChunkModule<K>>;
}

/**
 * A chunk's modules if they have already arrived, else `undefined` — so a
 * screen whose chunk a hover or a sibling tab already fetched renders at once
 * rather than suspending for a tick.
 */
export function arrivedChunk<K extends ScreenChunk>(chunk: K): ChunkModule<K> | undefined {
  return arrived.get(chunk) as ChunkModule<K> | undefined;
}

/**
 * Start fetching whatever an address will need, and say nothing if it fails:
 * a warm-up is a guess, and the screen itself reports a chunk that will not
 * load. Takes an href as a link carries it — query and all — or a bare path.
 */
export function preloadPath(href: string): void {
  const path = href.split(/[?#]/, 1)[0] ?? '';
  for (const chunk of chunksFor(path)) {
    loadChunk(chunk).catch(() => undefined);
  }
}

/**
 * Pointer and focus handlers that warm a link's screen (LAI-1219): spread onto
 * a nav link or a tab so the chunk is on its way before the click lands.
 * `pointerdown` as well as hover, because a touch has no hover.
 */
export function preloadOn(href: string): {
  readonly onPointerEnter: () => void;
  readonly onFocus: () => void;
  readonly onPointerDown: () => void;
} {
  const warm = (): void => {
    preloadPath(href);
  };
  return { onPointerEnter: warm, onFocus: warm, onPointerDown: warm };
}
