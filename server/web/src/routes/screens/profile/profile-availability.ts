import { useEffect, useState } from 'react';
import {
  getPersonLoad,
  listPeopleAvailability,
  type AvailabilitySeen,
} from '../../../api/availability.ts';

/**
 * Someone else's availability on their profile's head card (D-131, D-137;
 * LAI-1139, LAI-1152, LAI-1159). **Never the whole list for a reader it logs
 * for.** For a holder of *See everyone's analytics* `GET /people/availability`
 * writes a `time` look at **every person it lists** (`listPeopleAvailability`,
 * server `people-load.ts`), so reading it to draw one pill told the whole
 * organisation they had been looked at (LAI-1159). Such a reader reads only
 * this person: `GET /people/:id/load`, whose one `time` look (day null) is the
 * look opening their profile already writes (D-139 item 4), so D-135's
 * ten-minute dedupe makes it no second row. A reader without that grant cannot
 * read the load, and the list the server serves them is narrowed and logs
 * nothing, so they keep their row of the list.
 *
 * Your own is not read here: the head card's *My availability* button reads
 * and saves `/me/availability` through the shared store, so the pill and the
 * line under it follow a save.
 */

/** Whether to read the row: not for yourself, and nothing before `/me` has answered. */
export function readsSharedRow(userId: string | undefined, meId: string | undefined): boolean {
  return userId !== undefined && userId !== '' && meId !== undefined && userId !== meId;
}

/**
 * Their row's availability: `undefined` while reading or when it failed,
 * `null` when the list has no row for them — nothing is drawn for either.
 */
export function useSharedRow(
  userId: string,
  enabled: boolean,
  /** The reader holds *See everyone's analytics*: read this person's load, never the list. */
  oneOnly: boolean,
): AvailabilitySeen | null | undefined {
  const [seen, setSeen] = useState<AvailabilitySeen | null | undefined>(undefined);
  useEffect(() => {
    setSeen(undefined);
    if (!enabled) return;
    const controller = new AbortController();
    const read: Promise<AvailabilitySeen | null> = oneOnly
      ? getPersonLoad(userId, controller.signal).then((load) => load.availability)
      : listPeopleAvailability({}, controller.signal).then(
          (list) => list.data.find((r) => r.user.id === userId)?.availability ?? null,
        );
    read
      .then((seen) => {
        if (!controller.signal.aborted) setSeen(seen);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [userId, enabled, oneOnly]);
  return seen;
}
