import { chunksFor, type ScreenChunk } from './route-table.ts';

/**
 * The URL a failed `import()` names. Chromium and Firefox put it in the
 * message; Safari does not, and its retry falls back to a reload (see
 * `ScreenBoundary`).
 */
export function failedModuleUrl(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return /(https?:\/\/[^\s'"]+\.js)\b/.exec(message)?.[1];
}

/**
 * One `import()`, able to be asked again after it failed.
 *
 * **The browser remembers a failed module fetch** — measured in Chromium: the
 * same URL imported again rejects at once, with no request. So the retry asks
 * for the URL the failure named with `?retry=N`, which the module map has not
 * seen. The first attempt never ran, so nothing is evaluated twice.
 */
function retryable<T>(load: () => Promise<T>): () => Promise<T> {
  let failedUrl: string | undefined;
  let attempt = 0;
  return async () => {
    try {
      if (failedUrl === undefined) return await load();
      attempt += 1;
      return (await import(/* @vite-ignore */ `${failedUrl}?retry=${String(attempt)}`)) as T;
    } catch (error) {
      failedUrl = failedModuleUrl(error) ?? failedUrl;
      throw error;
    }
  };
}

/*
 * One per module, each able to retry on its own: in a chunk of several, only
 * the module that failed is asked for again.
 */
const spaceLayout = retryable(() => import('../components/space/SpaceLayout.tsx'));
const boardScreen = retryable(() => import('./screens/BoardScreen.tsx'));
const timelineScreen = retryable(() => import('./screens/timeline/TimelineScreen.tsx'));
const calendarScreen = retryable(() => import('./screens/calendar/CalendarScreen.tsx'));
const sprintsScreen = retryable(() => import('./screens/sprints/SprintsScreen.tsx'));
const dashboardScreen = retryable(() => import('./screens/dashboard/DashboardScreen.tsx'));
const activityScreen = retryable(() => import('./screens/activity/ActivityScreen.tsx'));
const meetingReviewScreen = retryable(
  () => import('./screens/meeting-review/MeetingReviewScreen.tsx'),
);
const projectsScreen = retryable(() => import('./screens/ProjectsScreen.tsx'));
const myDayScreen = retryable(() => import('./screens/my-day/MyDayScreen.tsx'));
const inboxScreen = retryable(() => import('./screens/inbox/InboxScreen.tsx'));
const reviewScreen = retryable(() => import('./screens/review/ReviewScreen.tsx'));
const unlistedScreen = retryable(() => import('./screens/unlisted/UnlistedScreen.tsx'));
const insightsScreen = retryable(() => import('./screens/insights/InsightsScreen.tsx'));
const capacityScreen = retryable(() => import('./screens/capacity/CapacityScreen.tsx'));
const usageScreen = retryable(() => import('./screens/usage/UsageScreen.tsx'));
const timeTab = retryable(() => import('./screens/insights/TimeTab.tsx'));
const organisationScreen = retryable(() => import('./screens/organisation/OrganisationScreen.tsx'));
const developerScreen = retryable(() => import('./screens/developer/DeveloperScreen.tsx'));
const membersScreen = retryable(() => import('./screens/MembersScreen.tsx'));
const spaceSettingsScreen = retryable(
  () => import('./screens/space-settings/SpaceSettingsScreen.tsx'),
);
const workroomScreen = retryable(() => import('./screens/workroom/WorkroomScreen.tsx'));
const profileScreen = retryable(() => import('./screens/profile/ProfileScreen.tsx'));
const appearanceScreen = retryable(() => import('./screens/appearance/AppearanceScreen.tsx'));
const loginRoute = retryable(() => import('./screens/LoginRoute.tsx'));
const inviteRoute = retryable(() => import('./screens/InviteRoute.tsx'));
const resetPasswordRoute = retryable(() => import('./screens/ResetPasswordRoute.tsx'));
const setupRoute = retryable(() => import('./screens/SetupRoute.tsx'));
const tokenReference = retryable(() => import('../theme/TokenReference.tsx'));
const stateGallery = retryable(() => import('../components/StateGallery.tsx'));
const documentsTrialRoute = retryable(
  () => import('../components/documents/DocumentsTrialRoute.tsx'),
);

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
  'space-frame': spaceLayout,
  board: boardScreen,
  timeline: timelineScreen,
  calendar: calendarScreen,
  sprints: sprintsScreen,
  dashboard: dashboardScreen,
  activity: activityScreen,
  'meeting-review': meetingReviewScreen,
  projects: projectsScreen,
  'my-day': myDayScreen,
  inbox: async () => {
    const [inbox, review, unlisted] = await Promise.all([
      inboxScreen(),
      reviewScreen(),
      unlistedScreen(),
    ]);
    return { ...inbox, ...review, ...unlisted };
  },
  insights: async () => {
    const [insights, capacity, usage, time] = await Promise.all([
      insightsScreen(),
      capacityScreen(),
      usageScreen(),
      timeTab(),
    ]);
    return { ...insights, ...capacity, ...usage, ...time };
  },
  organisation: organisationScreen,
  developer: developerScreen,
  members: membersScreen,
  'space-settings': spaceSettingsScreen,
  workroom: workroomScreen,
  profile: profileScreen,
  appearance: appearanceScreen,
  auth: async () => {
    const [login, invite, reset, setup] = await Promise.all([
      loginRoute(),
      inviteRoute(),
      resetPasswordRoute(),
      setupRoute(),
    ]);
    return { ...login, ...invite, ...reset, ...setup };
  },
  reference: async () => {
    const [tokens, states, documents] = await Promise.all([
      tokenReference(),
      stateGallery(),
      documentsTrialRoute(),
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

/**
 * Bumped by Try again (`retryScreens`). A screen whose chunk failed makes a
 * fresh `lazy` only once this has moved: React re-renders a failed lazy on its
 * own, and fetching again on every such render would loop — the failure is
 * the user's to retry, not the renderer's.
 */
let retries = 0;

/** Try again: let screens whose chunk failed ask for it once more. */
export function retryScreens(): void {
  retries += 1;
}

/** How many times Try again has been pressed in this page's life. */
export function retryCount(): number {
  return retries;
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
