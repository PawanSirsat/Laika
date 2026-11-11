import type { TimeEntry, TimeRevision } from '../../../api/time.ts';
import { duration } from './format.ts';

/*
 * An entry's HISTORY rows in words (LAI-515), and who made each one when it
 * was somebody else (D-143, LAI-1165). Pure, so the words are tested without
 * a browser.
 */

/**
 * Who made a revision, by name, when it was not the person whose entry it is
 * (D-143) — an owner or admin, or whoever pulled from Solidtime. An import's
 * first revision is Solidtime's, so it names nobody.
 */
export function revisionBy(
  r: TimeRevision,
  source: TimeEntry['source'],
  first: boolean,
  personId: string | undefined,
): string | undefined {
  if (personId === undefined || r.changed_by === personId) return undefined;
  if (source === 'import' && (r.change === 'created' || first)) return undefined;
  return r.changed_by_name ?? 'someone else';
}

/**
 * What a revision did, in the design's words — and, when it was not the
 * person's own (D-143), who did it: *Changed by Pawan Sirsat*. `personId` is
 * whose entry it is.
 */
export function revisionWords(
  r: TimeRevision,
  source: TimeEntry['source'],
  first: boolean,
  personId?: string,
): string {
  const by = revisionBy(r, source, first, personId);
  if (r.change === 'deleted') return by === undefined ? 'Deleted' : `Deleted by ${by}`;
  if (r.change === 'created' || first) {
    return source === 'import'
      ? 'Imported from Solidtime'
      : by !== undefined
        ? `Added by ${by} · ${duration(r.minutes)}`
        : source === 'manual'
          ? `Added by hand · ${duration(r.minutes)}`
          : `Confirmed · ${duration(r.minutes)}`;
  }
  return by === undefined
    ? `Edited · ${duration(r.minutes)}`
    : `Changed by ${by} · ${duration(r.minutes)}`;
}
