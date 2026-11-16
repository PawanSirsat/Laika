import { useEffect, useState } from 'react';
import { listAllUsers, type OrgUser } from './users.ts';

/** `undefined` while reading or not asked; the active people, sorted by name; `null` if the read failed. */
export type OrgPeople = readonly OrgUser[] | null | undefined;

/** The people as the palette and the chip list them: by name, a copy, the input left alone. */
export function byName(users: readonly OrgUser[]): readonly OrgUser[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The organisation's active people (`GET /users`, every page), for the
 * header's *Viewing* chip and the palette's People group (LAI-1188).
 *
 * **Asked only when `enabled`** — the caller passes the server's answer for
 * *See everyone's analytics* (`people.analytics.read`), so a member's browser
 * never sends the request at all. Concurrent callers share one flight through
 * the client's GET cache.
 */
export function useOrgPeople(enabled: boolean): OrgPeople {
  const [people, setPeople] = useState<OrgPeople>(undefined);
  useEffect(() => {
    if (!enabled) {
      setPeople(undefined);
      return;
    }
    const controller = new AbortController();
    listAllUsers(controller.signal)
      .then(({ users }) => {
        if (!controller.signal.aborted) {
          setPeople(byName(users));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPeople(null);
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);
  return enabled ? people : undefined;
}
