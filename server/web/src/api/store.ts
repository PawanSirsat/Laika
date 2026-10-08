import { createActivityStore } from './activity-store.ts';
import { listProjectActivityPage } from './activity.ts';
import { observeStreams } from './event-stream.ts';
import { sharedCache } from './query-cache.ts';
import { createTaskStore } from './task-store.ts';
import { listTasks } from './tasks.ts';

/**
 * The client store, wired (LAI-724, D-075).
 *
 * Three parts, one owner each:
 *
 * - `query-cache.ts` — every GET; small lists reused for `FRESH_MS` (`client.ts`).
 * - `task-store.ts` — the current project's task set, one walk for every screen.
 * - `activity-store.ts` — the Dashboard's activity window, caught up incrementally.
 *
 * **Live frames reach all three here, and only here** — through
 * `observeStreams`, before any screen's listener sees the frame. A frame marks
 * the project's cached lists stale (lazily: nothing refetches until a screen
 * asks), and asks each store for its one debounced catch-up. Screens no longer
 * re-read on a frame themselves.
 *
 * **Whose data it is** is the session's to say: {@link setStoreUser} runs as
 * the session resolves, and a different user — or none — drops everything.
 */

const PAGE = 200;

/** Keys about one project — never the projects list, which is the org's. */
function projectOf(key: string): string | undefined {
  return /^\/projects\/([^/?]+)/.exec(key)?.[1];
}

export const taskStore = createTaskStore({
  fetchPage: (slug, cursor, signal) =>
    listTasks(slug, cursor === undefined ? { limit: PAGE } : { limit: PAGE, cursor }, signal),
  // Only the current project is held (LAI-724 review, B1): its task set here,
  // and its cached lists in the shared cache.
  onProject: (slug) => {
    const current = encodeURIComponent(slug);
    sharedCache.evict((key) => {
      const project = projectOf(key);
      return project !== undefined && project !== current;
    });
  },
});

export const activityStore = createActivityStore({
  fetchPage: (slug, query, signal) => listProjectActivityPage(slug, query, signal),
});

/**
 * The cached answers a frame about `slug` can have changed: everything under
 * the project, and the projects list (its task and member counts).
 */
/**
 * **And presence** (LAI-724 review, S5). `SpaceLive` re-reads it 1.5 s after a
 * burst, and it is reused for 2 s: without this, a burst just after a read was
 * answered from the cache and the strip stayed as it was.
 */
const PRESENCE = (key: string): boolean => key === '/presence';

function aboutProject(slug: string): (key: string) => boolean {
  const base = `/projects/${encodeURIComponent(slug)}`;
  return (key) =>
    key === '/projects' ||
    key.startsWith('/projects?') ||
    key === base ||
    key.startsWith(`${base}/`) ||
    key.startsWith(`${base}?`);
}

observeStreams({
  frame(slug, frame) {
    if (frame.kind === 'activity') {
      sharedCache.invalidate(aboutProject(slug));
      sharedCache.invalidate(PRESENCE);
      if (frame.type.startsWith('org.')) sharedCache.invalidate((key) => key === '/org');
      taskStore.frame(slug, 'activity');
      activityStore.frame(slug, 'activity');
    } else if (frame.kind === 'gap') {
      sharedCache.invalidate(aboutProject(slug));
      sharedCache.invalidate(PRESENCE);
      taskStore.frame(slug, 'gap');
      activityStore.frame(slug, 'gap');
    }
  },
  closed(slug) {
    // Frames may be missed from here on: whatever is held for the project is
    // revalidated on the next visit rather than trusted.
    sharedCache.invalidate(aboutProject(slug));
    taskStore.frame(slug, 'closed');
    activityStore.frame(slug, 'closed');
  },
});

/**
 * Whose answers the store holds. **Called as the session resolves, before any
 * screen renders**, so the first screen of a session already shares.
 *
 * A different user, or none, drops every cached answer, every task set and
 * every activity window, and aborts every request in flight — an answer to a
 * request made for the previous user is never stored. Signed out, nothing is
 * cached at all.
 */
export function setStoreUser(userId: string | undefined): void {
  if (userId !== undefined && userId === sharedCache.user) return;
  sharedCache.setUser(userId);
  taskStore.reset();
  activityStore.reset();
}
