import { useCallback, useSyncExternalStore } from 'react';
import { taskStore } from './store.ts';
import type { TaskSetSnapshot } from './task-store.ts';

/**
 * The project's task set, as every screen but the board reads it (LAI-724).
 *
 * One copy per project for the whole app (`task-store.ts`): the first screen to
 * ask walks it, every other screen — and a revisit — reads the same set, and
 * live frames keep it current in one place. So Calendar, Sprints, Dashboard,
 * Capacity, Activity and Meeting review have live data without a stream of
 * their own — and the Timeline, when the set is already held
 * (`use-timeline.ts`; cold, it reads only the sprints it opens, D-074).
 *
 * `undefined` until there is a project. The board reads the store through
 * `use-board.ts` instead, which adds its filter, its local writes and LAI-708's
 * presenter on top of the same set.
 */
export function useProjectTasks(slug: string | undefined): TaskSetSnapshot | undefined {
  const subscribe = useCallback(
    (onChange: () => void) =>
      slug === undefined ? () => undefined : taskStore.subscribe(slug, onChange),
    [slug],
  );
  return useSyncExternalStore(subscribe, () =>
    slug === undefined ? undefined : taskStore.peek(slug),
  );
}

/** Walk the project's tasks again now — after a write a screen made itself. */
export function reloadProjectTasks(slug: string | undefined): void {
  if (slug !== undefined) taskStore.reload(slug);
}
