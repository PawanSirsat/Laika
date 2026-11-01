import { type WhoLooked } from '../../../api/people-analytics.ts';

/**
 * How far back a look still counts as *looking now* (LAI-529). A viewer's page
 * reads a person's day once, when it opens, so *now* is a window over each
 * viewer's latest look rather than a live feed.
 */
export const LOOKING_WINDOW_MS = 15 * 60_000;

/** One person looking now, at their latest look. */
export interface LookingNow {
  readonly id: string;
  readonly name: string;
  readonly at: number;
}

/**
 * Who looked inside the window ending at `now`, one line a person, the latest
 * look first (LAI-529). A day read and the shared local activity read beside
 * it are two looks and one person.
 */
export function lookingNow(
  rows: readonly WhoLooked[],
  now: number,
  windowMs: number = LOOKING_WINDOW_MS,
): LookingNow[] {
  const since = now - windowMs;
  const byViewer = new Map<string, LookingNow>();
  for (const row of rows) {
    if (row.viewed_at < since) continue;
    const kept = byViewer.get(row.viewer.id);
    if (kept === undefined || row.viewed_at > kept.at) {
      byViewer.set(row.viewer.id, { id: row.viewer.id, name: row.viewer.name, at: row.viewed_at });
    }
  }
  return [...byViewer.values()].sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

/**
 * Whether a newest-first page already reaches back past the window, so no
 * older page can add anyone. An empty page reaches nothing and needs no more.
 */
export function reachesPast(
  rows: readonly WhoLooked[],
  now: number,
  windowMs: number = LOOKING_WINDOW_MS,
): boolean {
  const oldest = rows[rows.length - 1];
  return oldest === undefined || oldest.viewed_at < now - windowMs;
}
