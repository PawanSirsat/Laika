import { useSyncExternalStore } from 'react';
import { applyFont, readFont, writeFont, type FontId } from './font.ts';

/**
 * One store for the interface font, not one per component (LAI-1125) — the
 * lesson `use-theme.ts` records: per-component state leaves every other
 * reader stale. Nothing computes a colour from the font, but the picker and
 * anything that later measures text must agree on which face is on screen.
 */
let current: FontId = readFont();

const listeners = new Set<() => void>();
let watching = false;

function set(font: FontId): void {
  if (font === current) return;
  current = font;
  applyFont(font);
  for (const listener of listeners) listener();
}

/** A second tab choosing a face should not leave this one in the old one. */
function startWatching(): void {
  if (watching) return;
  watching = true;
  addEventListener('storage', () => {
    set(readFont());
  });
}

function subscribe(listener: () => void): () => void {
  startWatching();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getFont = (): FontId => current;

/** Choose a face: persist it and put it on the document. */
export function chooseFont(font: FontId): void {
  writeFont(font);
  set(font);
}

export interface UseFont {
  readonly font: FontId;
  readonly setFont: (font: FontId) => void;
}

export function useFont(): UseFont {
  const font = useSyncExternalStore(subscribe, getFont);
  return { font, setFont: chooseFont };
}
