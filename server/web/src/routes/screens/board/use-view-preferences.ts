import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  STORAGE_KEY,
  writePreferences,
  type ViewPreferences,
} from './view-preferences.ts';

/**
 * The board's display preferences, shared by every consumer (LAI-266).
 *
 * **A module-level store with `useSyncExternalStore`, not `useState`**, copying
 * `use-theme.ts` — and for the bug its docblock records rather than for
 * symmetry. With `useState`, every caller holds its own copy: the settings
 * panel toggles a field, its own state updates, and the board beside it goes on
 * rendering the old one until something unrelated re-renders it. Panel-plus-board
 * is exactly that two-consumer shape.
 *
 * The `storage` listener is what keeps two tabs agreeing. It fires per changed
 * key, which is the reason `view-preferences.ts` keeps every project under one.
 */

const listeners = new Set<() => void>();
const cache = new Map<string, ViewPreferences>();

function read(slug: string): ViewPreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFERENCES;

  const hit = cache.get(slug);
  if (hit !== undefined) return hit;

  const fresh = readPreferences(slug);
  cache.set(slug, fresh);
  return fresh;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    // Another tab wrote. Drop what we held rather than trying to merge.
    cache.clear();
    emit();
  };

  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export interface UseViewPreferences {
  readonly preferences: ViewPreferences;
  readonly set: (next: ViewPreferences) => void;
  readonly reset: () => void;
}

export function useViewPreferences(slug: string | undefined): UseViewPreferences {
  const key = slug ?? '';

  const preferences = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => DEFAULT_PREFERENCES,
  );

  const set = useCallback(
    (next: ViewPreferences) => {
      if (slug === undefined) return;
      cache.set(slug, next);
      writePreferences(slug, next);
      emit();
    },
    [slug],
  );

  const reset = useCallback(() => {
    if (slug === undefined) return;
    cache.set(slug, DEFAULT_PREFERENCES);
    writePreferences(slug, DEFAULT_PREFERENCES);
    emit();
  }, [slug]);

  return { preferences, set, reset };
}
