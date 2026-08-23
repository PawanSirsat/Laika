import { useCallback, useEffect, useState } from 'react';
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
 * Read and set the theme.
 *
 * State is seeded from storage rather than a constant, so the first render
 * already matches what `initTheme()` put on the document — seeding to 'light'
 * would make React briefly disagree with the DOM.
 */
export function useTheme(): UseTheme {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readPreference());
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readPreference()));

  const setPreference = useCallback((next: ThemePreference): void => {
    writePreference(next);
    setPreferenceState(next);
    const resolved = resolveTheme(next);
    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  // Follow the OS while no explicit choice is stored.
  useEffect(() => watchSystemTheme(setTheme), []);

  // Keep the document in step with the resolved theme, including the OS-driven
  // changes above which bypass setPreference.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // A second tab switching theme should not leave this one stale.
  useEffect(() => {
    const onStorage = (): void => {
      const stored = readPreference();
      setPreferenceState(stored);
      setTheme(resolveTheme(stored, systemTheme()));
    };
    addEventListener('storage', onStorage);
    return () => {
      removeEventListener('storage', onStorage);
    };
  }, []);

  return { theme, preference, setPreference };
}
