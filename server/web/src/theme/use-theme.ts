import { useCallback, useSyncExternalStore } from 'react';
import {
  applyTheme,
  readPreference,
  resolveTheme,
  systemTheme,
  watchSystemTheme,
  writePreference,
  type Theme,
  type ThemePreference,
} from './theme.ts';

export interface UseTheme {
  /** The theme actually on screen. */
  readonly theme: Theme;
  /** What the user asked for — `system` until they choose. */
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
}

/**
 * One store, not one per component.
 *
 * This was `useState` inside the hook, which meant every caller held its own
 * copy. Toggling the theme updated the toggle's copy and put `.dk` on the
 * document, so everything coloured by CSS variables changed and the bug looked
 * like it did not exist. Anything that computes a colour **in JavaScript** from
 * `theme` — every `avatarColor()` call — kept rendering the old theme's palette
 * until something else happened to re-render it. In dark mode that is pale
 * chips with dark text, which is exactly what a reader sees and a screenshot of
 * the light theme does not.
 *
 * `useSyncExternalStore` over a module-level store fixes it for every consumer
 * at once and keeps the hook's signature, so no call site changes.
 */
let currentPreference: ThemePreference = readPreference();
let currentTheme: Theme = resolveTheme(currentPreference);

const listeners = new Set<() => void>();
let watching = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function set(preference: ThemePreference, theme: Theme): void {
  if (preference === currentPreference && theme === currentTheme) return;
  currentPreference = preference;
  currentTheme = theme;
  applyTheme(theme);
  emit();
}

/**
 * Attached on first subscription rather than at module load, so importing this
 * module never touches `matchMedia` or `addEventListener`. Never detached: the
 * store outlives every component, and tearing down on the last unsubscribe
 * would drop OS changes during a moment when nothing happens to be mounted.
 */
function startWatching(): void {
  if (watching) return;
  watching = true;

  // Follow the OS while no explicit choice is stored.
  watchSystemTheme((theme) => {
    set(currentPreference, theme);
  });

  // A second tab switching theme should not leave this one stale.
  addEventListener('storage', () => {
    const stored = readPreference();
    set(stored, resolveTheme(stored, systemTheme()));
  });
}

function subscribe(listener: () => void): () => void {
  startWatching();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getTheme = (): Theme => currentTheme;
const getPreference = (): ThemePreference => currentPreference;

/**
 * Read and set the theme.
 *
 * The snapshot is seeded from storage rather than a constant, so the first
 * render already matches what `initTheme()` put on the document — seeding to
 * 'light' would make React briefly disagree with the DOM.
 */
export function useTheme(): UseTheme {
  const theme = useSyncExternalStore(subscribe, getTheme);
  const preference = useSyncExternalStore(subscribe, getPreference);

  const setPreference = useCallback((next: ThemePreference): void => {
    writePreference(next);
    set(next, resolveTheme(next));
  }, []);

  return { theme, preference, setPreference };
}
