import { useEffect, useState } from 'react';
import { listPeopleAvailability, type AvailabilitySeen } from '../../../api/availability.ts';

/**
 * Someone else's availability on their profile's head card (D-131, D-137;
 * LAI-1139, LAI-1152): **their row of `GET /people/availability`**, narrowed by
 * the server to what this reader may see. That list logs nothing, so opening a
 * profile is never a look at anyone's time through the pill — the reason
 * `GET /people/:id/load`, which logs, is not read here (D-139 item 8 took
 * Current load and *Show current load* off the profile).
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
): AvailabilitySeen | null | undefined {
  const [seen, setSeen] = useState<AvailabilitySeen | null | undefined>(undefined);
  useEffect(() => {
    setSeen(undefined);
    if (!enabled) return;
    const controller = new AbortController();
    listPeopleAvailability({}, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setSeen(list.data.find((r) => r.user.id === userId)?.availability ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [userId, enabled]);
  return seen;
}
