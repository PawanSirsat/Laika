import { BLOCK_MAX_PX, clampBlockHeight, ZOOM_STEPS, type Zoom } from './timeline-derive.ts';

/**
 * The Timeline's zoom and row height, as the owner asked them to open
 * (2026-10-26): **3× both** — the zoom at three times an hour's 160px, the
 * YOU row's blocks at three times the design's 80px — and each kept in this
 * browser once the person changes it, as the tab is. A private window keeps
 * nothing and opens at the defaults.
 */

export const DEFAULT_ZOOM: Zoom = '3';
export const DEFAULT_BLOCK_PX = BLOCK_MAX_PX;

export const ZOOM_KEY = 'laika.my-day.zoom';
export const ROW_HEIGHT_KEY = 'laika.my-day.row-height';

/** A stored zoom, or the default for anything else. */
export function zoomFrom(stored: string | null): Zoom {
  return stored === 'fit' || (ZOOM_STEPS as readonly string[]).includes(stored ?? '')
    ? (stored as Zoom)
    : DEFAULT_ZOOM;
}

/** A stored row height, held to the grip's range, or the default for anything else. */
export function blockPxFrom(stored: string | null): number {
  const px = Number(stored);
  return stored === null || stored === '' || !Number.isFinite(px)
    ? DEFAULT_BLOCK_PX
    : clampBlockHeight(px);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window keeps nothing; the Timeline still changes.
  }
}

export const readZoom = (): Zoom => zoomFrom(read(ZOOM_KEY));
export const keepZoom = (zoom: Zoom): void => {
  keep(ZOOM_KEY, zoom);
};
export const readBlockPx = (): number => blockPxFrom(read(ROW_HEIGHT_KEY));
export const keepBlockPx = (px: number): void => {
  keep(ROW_HEIGHT_KEY, String(px));
};
